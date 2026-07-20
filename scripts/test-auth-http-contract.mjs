import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const server = readFileSync(resolve(root, "server/index.mjs"), "utf8");
const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
const loginPage = readFileSync(resolve(root, "src/pages/LoginPage.tsx"), "utf8");
const accessPage = readFileSync(resolve(root, "src/pages/AccessManagementPage.tsx"), "utf8");

for (const route of [
  "/api/auth/status",
  "/api/auth/bootstrap",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/admin/users",
]) {
  assert.ok(server.includes(route), `缺少认证接口：${route}`);
}
assert.ok(server.includes("HttpOnly"), "会话 Cookie 必须设置 HttpOnly");
assert.ok(server.includes("SameSite=Strict"), "会话 Cookie 必须设置 SameSite=Strict");
assert.ok(server.includes("requireApiPermission"), "业务 API 必须执行服务端权限校验");
assert.ok(server.includes("loginRateLimiter"), "登录接口必须配置限流");
assert.ok(server.includes("AUTH_ENFORCEMENT_ENABLED"), "必须提供上线时启用登录拦截的环境变量");
assert.ok(server.includes("authEnforcementEnabled"), "服务端必须按开关决定是否执行认证拦截");
assert.ok(app.includes("LoginPage"), "应用入口必须保留登录页");
assert.ok(app.includes("enforcementEnabled"), "前端必须按服务端状态决定是否显示登录页");
assert.ok(app.includes("allowedNavItems"), "导航必须按用户权限过滤");
assert.ok(loginPage.includes('type="email"'), "登录表单必须使用邮箱字段");
assert.ok(loginPage.includes('type="tel"'), "登录表单必须使用手机号字段");
assert.ok(accessPage.includes("permissions"), "管理员页必须支持逐项编辑权限");
assert.ok(accessPage.includes("active"), "管理员页必须支持停用账号");

console.log("auth http/ui contract ok: protected API, secure cookie, login and access management");
