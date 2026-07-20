import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readLocalEnv } from "../server/local-env.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(projectRoot, "dist");
assert.ok(existsSync(distDir), "请先运行 npm run build 生成 dist");

const forbiddenMarkers = [
  "DINGTALK_APP_KEY",
  "DINGTALK_APP_SECRET",
  "DINGTALK_WORKBOOK_ID",
  "DINGTALK_OPERATOR_ID",
  "accessToken",
  "appSecret",
  "x-acs-dingtalk-access-token",
  "api.dingtalk.com",
  "operatorId",
  "workbookId",
];
const secretValues = [
  "DINGTALK_APP_KEY",
  "DINGTALK_APP_SECRET",
  "DINGTALK_WORKBOOK_ID",
  "DINGTALK_OPERATOR_ID",
].map((name) => readLocalEnv(name)).filter((value) => value.length >= 8);

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(fullPath));
    else if (/\.(?:html|js|css|json|map)$/i.test(entry.name)) files.push(fullPath);
  }
  return files;
}

const exposed = [];
for (const filePath of filesUnder(distDir)) {
  const body = readFileSync(filePath, "utf8");
  for (const marker of forbiddenMarkers) {
    if (body.includes(marker)) exposed.push(`${filePath}: marker ${marker}`);
  }
  for (const value of secretValues) {
    if (body.includes(value)) exposed.push(`${filePath}: configured value`);
  }
}

assert.deepEqual(exposed, [], `公域构建产物包含钉钉敏感信息：${exposed.join("; ")}`);
console.log(`public surface ok: ${filesUnder(distDir).length} files scanned`);
