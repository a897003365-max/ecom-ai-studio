import { readdir, readFile, writeFile } from "node:fs/promises";
import { brotliCompress, constants, gzip } from "node:zlib";
import { promisify } from "node:util";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const compressible = new Set([".js", ".css", ".html", ".json", ".svg", ".txt", ".map"]);

export async function compressAssets(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { count += await compressAssets(path); continue; }
    if (!compressible.has(extname(entry.name))) continue;
    const body = await readFile(path);
    if (body.length <= 1024) continue;
    const [br, gz] = await Promise.all([
      brotli(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }),
      gzipAsync(body, { level: 9 }),
    ]);
    await Promise.all([writeFile(`${path}.br`, br), writeFile(`${path}.gz`, gz)]);
    count += 1;
  }
  return count;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Precompressed ${await compressAssets(resolve(process.argv[2] || "dist"))} static assets`);
}
