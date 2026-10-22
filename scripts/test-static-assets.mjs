import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer, get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { test } from "node:test";
import { compressAssets } from "./compress-assets.mjs";
import { createProductionHandler } from "../server/static-assets.mjs";

test("build variants preserve content, encoding quality and cache policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "product-static-test-"));
  const dist = join(root, "dist");
  await mkdir(join(dist, "assets"), { recursive: true });
  const body = "const item = '商品数据';\n".repeat(300);
  await writeFile(join(dist, "assets", "app-hash.js"), body);
  await writeFile(join(dist, "index.html"), "<h1>App</h1>");
  await writeFile(join(root, "private.txt"), "outside");
  await compressAssets(dist);
  const handler = createProductionHandler(dist, { ".js": "text/javascript", ".html": "text/html" });
  const server = createServer((req, res) => handler(res, req.url));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = (path, encoding) => new Promise((resolve, reject) => {
    get({ hostname: "127.0.0.1", port: server.address().port, path, headers: { "Accept-Encoding": encoding } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ headers: response.headers, body: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
  try {
    for (const [accept, encoding, decode] of [["br, gzip", "br", brotliDecompressSync], ["br;q=0,gzip;q=1", "gzip", gunzipSync], ["gzip;q=1,br;q=.5", "gzip", gunzipSync], ["identity", undefined, (x) => x]]) {
      const result = await request("/assets/app-hash.js", accept);
      assert.equal(result.headers["content-encoding"], encoding);
      assert.equal(decode(result.body).toString(), body);
      assert.equal(result.headers.vary, "Accept-Encoding");
      assert.match(result.headers["cache-control"], /immutable/);
    }
    const html = await request("/", "br");
    assert.equal(html.headers["cache-control"], "no-cache");
    assert.equal((await request("/../private.txt", "identity")).body.toString(), "<h1>App</h1>");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
