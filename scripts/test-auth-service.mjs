import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAuthService, PERMISSION_IDS } from "../server/auth.mjs";

const tempRoot = await mkdtemp(join(tmpdir(), "ecom-auth-test-"));
const storePath = join(tempRoot, "auth-store.json");

async function rejectsCode(operation, code) {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}

try {
  const auth = createAuthService({ storePath, sessionTtlMs: 60_000 });
  await auth.init();

  assert.deepEqual(await auth.status(), { configured: false, userCount: 0 });
  await rejectsCode(
    () => auth.bootstrap({ name: "", email: "not-an-email", phone: "123", password: "short" }),
    "validation_error",
  );

  const bootstrap = await auth.bootstrap({
    name: "系统管理员",
    email: "Admin@Example.com",
    phone: "+86 138-0000-0000",
    password: "AdminPass2026!",
  });
  assert.equal(bootstrap.user.email, "admin@example.com");
  assert.equal(bootstrap.user.phone, "+8613800000000");
  assert.equal(bootstrap.user.role, "admin");
  assert.deepEqual(bootstrap.user.permissions, PERMISSION_IDS);
  assert.ok(bootstrap.token.length >= 32);
  assert.equal((await auth.authenticate(bootstrap.token))?.id, bootstrap.user.id);
  await rejectsCode(
    () => auth.bootstrap({ name: "另一位管理员", email: "other@example.com", phone: "13811112222", password: "OtherPass2026!" }),
    "already_configured",
  );

  await rejectsCode(
    () => auth.login({ email: "admin@example.com", phone: "+8613800000001", password: "AdminPass2026!" }),
    "invalid_credentials",
  );
  await rejectsCode(
    () => auth.login({ email: "admin@example.com", phone: "+8613800000000", password: "WrongPass2026!" }),
    "invalid_credentials",
  );
  const login = await auth.login({
    email: "ADMIN@EXAMPLE.COM",
    phone: "+86 138 0000 0000",
    password: "AdminPass2026!",
  });
  assert.equal(login.user.id, bootstrap.user.id);

  const analyst = await auth.createUser(bootstrap.user, {
    name: "经营分析",
    email: "analyst@example.com",
    phone: "13900000000",
    password: "AnalystPass2026!",
    role: "user",
    permissions: ["dashboard.view", "analytics.view"],
  });
  assert.deepEqual(analyst.permissions, ["dashboard.view", "analytics.view"]);
  assert.equal((await auth.listUsers(bootstrap.user)).length, 2);
  await rejectsCode(() => auth.listUsers(analyst), "forbidden");
  await rejectsCode(
    () => auth.createUser(bootstrap.user, {
      name: "重复邮箱",
      email: "ANALYST@example.com",
      phone: "13900000001",
      password: "AnotherPass2026!",
      permissions: [],
    }),
    "email_conflict",
  );

  const updated = await auth.updateUser(bootstrap.user, analyst.id, {
    permissions: ["dashboard.view", "products.view"],
    active: false,
  });
  assert.equal(updated.active, false);
  assert.deepEqual(updated.permissions, ["dashboard.view", "products.view"]);
  await rejectsCode(
    () => auth.login({ email: analyst.email, phone: analyst.phone, password: "AnalystPass2026!" }),
    "invalid_credentials",
  );
  await rejectsCode(
    () => auth.updateUser(bootstrap.user, bootstrap.user.id, { active: false }),
    "last_admin",
  );

  await auth.logout(login.token);
  assert.equal(await auth.authenticate(login.token), null);

  const stored = await import("node:fs/promises").then(({ readFile }) => readFile(storePath, "utf8"));
  assert.ok(!stored.includes("AdminPass2026!"));
  assert.ok(!stored.includes(bootstrap.token));
  console.log("auth service ok: bootstrap, dual-identifier login, sessions and per-user permissions");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
