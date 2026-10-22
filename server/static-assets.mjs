import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

function acceptedEncodings(header) {
  const qualities = new Map(String(header || "").toLowerCase().split(",").map((part) => {
    const [name, ...parameters] = part.trim().split(";");
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    return [name, quality ? Number(quality.trim().slice(2)) : 1];
  }));
  return ["br", "gzip"]
    .map((name) => ({ name, quality: qualities.get(name) ?? qualities.get("*") ?? 0 }))
    .filter(({ quality }) => Number.isFinite(quality) && quality > 0)
    .sort((a, b) => b.quality - a.quality);
}

/** Serve immutable build variants; compression only happens during the build. */
export function createProductionHandler(directory, mimeTypes) {
  const root = resolve(directory);
  return function serveProduction(response, pathname) {
    const candidate = resolve(root, pathname.replace(/^\/+/, "") || "index.html");
    const within = relative(root, candidate);
    const contained = within !== ".." && !within.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(within);
    const filePath = contained && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, "index.html");
    const ext = extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": mimeTypes[ext] ?? "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
      "Vary": "Accept-Encoding",
    };
    let selected = filePath;
    for (const { name } of acceptedEncodings(response.req?.headers?.["accept-encoding"])) {
      const variant = `${filePath}.${name === "gzip" ? "gz" : "br"}`;
      if (existsSync(variant)) { selected = variant; headers["Content-Encoding"] = name; break; }
    }
    headers["Content-Length"] = statSync(selected).size;
    response.writeHead(200, headers);
    if (response.req?.method === "HEAD") { response.end(); return; }
    createReadStream(selected).on("error", () => response.destroy()).pipe(response);
  };
}
