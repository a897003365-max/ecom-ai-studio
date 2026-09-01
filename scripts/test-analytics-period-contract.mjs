import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const tempRoot = await mkdtemp(join(tmpdir(), "ecom-analytics-period-"));
const port = 5650 + Math.floor(Math.random() * 250);
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server/index.mjs", "--production"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    AUTH_ENFORCEMENT_ENABLED: "0",
    AUTH_STORE_PATH: join(tempRoot, "auth-store.json"),
    HOST: "127.0.0.1",
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
child.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
child.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`分析测试服务提前退出：${serverOutput.slice(-1000)}`);
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`分析测试服务启动超时：${serverOutput.slice(-1000)}`);
}

try {
  await waitForServer();
  const start = "2026-07-10";
  const end = "2026-07-16";
  const response = await fetch(`${baseUrl}/api/analytics?start=${start}&end=${end}`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  const productManagement = payload.warehouse?.productManagement ?? null;
  assert.ok(
    !productManagement || (productManagement.period?.start === start && productManagement.period?.end === end),
    "商品经营数据必须与全渠道页面筛选期一致，或在无法按期聚合时明确为空",
  );
  console.log("analytics period contract: ok");
} finally {
  child.kill();
  await new Promise((resolveExit) => child.once("exit", resolveExit));
  await rm(tempRoot, { recursive: true, force: true });
}
