import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const tempRoot = await mkdtemp(join(tmpdir(), "ecom-auth-http-"));
const port = 5400 + Math.floor(Math.random() * 250);
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server/index.mjs", "--production"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    DATA_DIR: join(tempRoot, "local-data"),
    AUTH_STORE_PATH: join(tempRoot, "auth-store.json"),
    AUTH_ENFORCEMENT_ENABLED: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
child.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
child.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`认证测试服务提前退出：${serverOutput.slice(-1000)}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`认证测试服务启动超时：${serverOutput.slice(-1000)}`);
}

async function request(path, { cookie, ...init } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json();
  return { response, payload };
}

function responseCookie(response) {
  const header = response.headers.getSetCookie?.()[0] || response.headers.get("set-cookie") || "";
  return { header, cookie: header.split(";")[0] };
}

try {
  await waitForServer();

  const anonymous = await request("/api/data-sources");
  assert.equal(anonymous.response.status, 401);
  assert.equal(anonymous.payload.error.code, "authentication_required");

  const initial = await request("/api/auth/status");
  assert.equal(initial.response.status, 200);
  assert.equal(initial.payload.configured, false);

  const bootstrap = await request("/api/auth/bootstrap", {
    method: "POST",
    body: JSON.stringify({
      name: "E2E 管理员",
      email: "admin.e2e@example.com",
      phone: "13800000000",
      password: "AdminE2E2026!",
    }),
  });
  assert.equal(bootstrap.response.status, 201);
  const adminSession = responseCookie(bootstrap.response);
  assert.match(adminSession.header, /HttpOnly/i);
  assert.match(adminSession.header, /SameSite=Strict/i);

  const usersCreate = await request("/api/admin/users", {
    method: "POST",
    cookie: adminSession.cookie,
    body: JSON.stringify({
      name: "只读分析员",
      email: "viewer.e2e@example.com",
      phone: "13900000000",
      password: "ViewerE2E2026!",
      role: "user",
      permissions: ["dashboard.view", "analytics.view"],
    }),
  });
  assert.equal(usersCreate.response.status, 201);
  assert.deepEqual(usersCreate.payload.user.permissions, ["dashboard.view", "analytics.view"]);

  const contentUserCreate = await request("/api/admin/users", {
    method: "POST",
    cookie: adminSession.cookie,
    body: JSON.stringify({
      name: "内容执行员",
      email: "content.e2e@example.com",
      phone: "13600000000",
      password: "ContentE2E2026!",
      role: "user",
      permissions: ["content.view", "content.manage"],
    }),
  });
  assert.equal(contentUserCreate.response.status, 201);

  const logout = await request("/api/auth/logout", { method: "POST", cookie: adminSession.cookie });
  assert.equal(logout.response.status, 200);
  const oldSession = await request("/api/admin/users", { cookie: adminSession.cookie });
  assert.equal(oldSession.response.status, 401);

  const viewerLogin = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "viewer.e2e@example.com", phone: "13900000000", password: "ViewerE2E2026!" }),
  });
  assert.equal(viewerLogin.response.status, 200);
  const viewerSession = responseCookie(viewerLogin.response).cookie;
  const analytics = await request("/api/analytics", { cookie: viewerSession });
  assert.equal(analytics.response.status, 200);
  const dashboardSources = await request("/api/data-sources", { cookie: viewerSession });
  assert.equal(dashboardSources.response.status, 200);
  const forbiddenSettings = await request("/api/history", { cookie: viewerSession });
  assert.equal(forbiddenSettings.response.status, 403);
  assert.equal(forbiddenSettings.payload.error.details.permissions?.[0] || forbiddenSettings.payload.error.details.permission, "settings.view");
  const forbiddenUsers = await request("/api/admin/users", { cookie: viewerSession });
  assert.equal(forbiddenUsers.response.status, 403);

  const contentLogin = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "content.e2e@example.com", phone: "13600000000", password: "ContentE2E2026!" }),
  });
  assert.equal(contentLogin.response.status, 200);
  const contentSession = responseCookie(contentLogin.response).cookie;
  const forbiddenImageTask = await request("/api/tasks", {
    method: "POST",
    cookie: contentSession,
    body: JSON.stringify({ id: "e2e-image-denied", type: "image_process" }),
  });
  assert.equal(forbiddenImageTask.response.status, 403);
  assert.deepEqual(forbiddenImageTask.payload.error.details.permissions, ["images.manage"]);

  const invalidTaskId = await request("/api/tasks", {
    method: "POST",
    cookie: contentSession,
    body: JSON.stringify({ id: "..\\..\\escape", type: "content_generate" }),
  });
  assert.equal(invalidTaskId.response.status, 400);

  const contentTask = await request("/api/tasks", {
    method: "POST",
    cookie: contentSession,
    body: JSON.stringify({ id: "e2e-content-allowed", type: "content_generate", batch: "E2E", inputFiles: [] }),
  });
  assert.equal(contentTask.response.status, 201);
  assert.equal(contentTask.payload.workflow.taskId, "e2e-content-allowed");

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const failed = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "unknown@example.com", phone: "13700000000", password: "WrongPassword2026!" }),
    });
    assert.equal(failed.response.status, 401);
  }
  const limited = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "unknown@example.com", phone: "13700000000", password: "WrongPassword2026!" }),
  });
  assert.equal(limited.response.status, 429);
  assert.ok(Number(limited.response.headers.get("retry-after")) > 0);

  console.log("auth http e2e ok: gate, secure session, task-type authorization, path validation, logout and rate limiting");
} finally {
  child.kill();
  await new Promise((resolveExit) => child.once("exit", resolveExit));
  await rm(tempRoot, { recursive: true, force: true });
}
