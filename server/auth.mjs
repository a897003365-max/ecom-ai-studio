import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export const PERMISSIONS = [
  { id: "dashboard.view", group: "工作台", label: "查看工作台", description: "查看经营摘要与待办概览" },
  { id: "assets.view", group: "商品资产", label: "查看商品资产", description: "查看素材完整度与商品资产" },
  { id: "content.view", group: "内容生产", label: "查看文案与分镜", description: "查看文案、分镜与质检结果" },
  { id: "content.manage", group: "内容生产", label: "执行内容任务", description: "创建文案、分镜与质检任务" },
  { id: "images.view", group: "图片处理", label: "查看图片任务", description: "查看图片处理结果与状态" },
  { id: "images.manage", group: "图片处理", label: "执行图片任务", description: "创建与重试图片处理任务" },
  { id: "analytics.view", group: "运营分析", label: "查看运营数据", description: "查看钉钉与本地数仓经营指标" },
  { id: "analytics.manage", group: "运营分析", label: "同步运营数据", description: "触发运营数据与数仓同步" },
  { id: "intelligence.view", group: "竞品情报", label: "查看竞品情报", description: "查看 TOP100、品牌榜与洞察" },
  { id: "intelligence.manage", group: "竞品情报", label: "执行竞品分析", description: "启动视觉分析与竞品处理任务" },
  { id: "tasks.view", group: "任务队列", label: "查看任务队列", description: "查看任务与运行历史" },
  { id: "tasks.manage", group: "任务队列", label: "管理任务队列", description: "创建、重试、确认与取消任务" },
  { id: "products.view", group: "商品管理", label: "查看商品管理", description: "查看商品经营与投放数据" },
  { id: "settings.view", group: "系统设置", label: "查看系统设置", description: "查看连接、同步与安全状态" },
  { id: "settings.manage", group: "系统设置", label: "管理系统设置", description: "同步数据源与上传本地数据" },
  { id: "admin.users", group: "权限管理", label: "管理用户权限", description: "创建、停用用户并配置访问权限" },
];

export const PERMISSION_IDS = PERMISSIONS.map((permission) => permission.id);
const permissionIdSet = new Set(PERMISSION_IDS);

export class AuthError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function validationError(details) {
  return new AuthError(422, "validation_error", "请检查账号信息后重试", details);
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePhone(value) {
  const raw = String(value ?? "").trim();
  const digits = raw.startsWith("+") ? `+${raw.slice(1).replace(/\D/g, "")}` : raw.replace(/\D/g, "");
  return digits;
}

function normalizePermissions(value) {
  if (!Array.isArray(value)) return [];
  const selected = new Set(value.filter((permission) => permissionIdSet.has(permission) && permission !== "admin.users"));
  return PERMISSION_IDS.filter((permission) => selected.has(permission));
}

function validateAccountInput(input, { passwordRequired = true } = {}) {
  const details = [];
  const name = String(input.name ?? "").trim();
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const password = String(input.password ?? "");
  if (!name || name.length > 80) details.push({ field: "name", message: "姓名需为 1-80 个字符" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) details.push({ field: "email", message: "请输入有效邮箱" });
  if (!/^\+?\d{7,15}$/.test(phone)) details.push({ field: "phone", message: "请输入 7-15 位有效手机号" });
  if (passwordRequired && (password.length < 10 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password))) {
    details.push({ field: "password", message: "密码需为 10-128 位，且同时包含字母和数字" });
  }
  if (details.length) throw validationError(details);
  return { name, email, phone, password };
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

async function verifyPassword(password, storedHash) {
  const [algorithm, saltText, hashText] = String(storedHash ?? "").split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltText, "base64url"), expected.length));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("base64url");
}

function publicUser(user) {
  const permissions = user.role === "admin" ? PERMISSION_IDS : normalizePermissions(user.permissions);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    permissions,
    active: user.active,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function createAuthService({ storePath, sessionTtlMs = 12 * 60 * 60 * 1000, now = () => Date.now() }) {
  if (!storePath) throw new Error("Auth storePath is required");
  let state = { version: 1, users: [], sessions: [] };
  let initialized = false;
  let writeQueue = Promise.resolve();
  let operationQueue = Promise.resolve();

  function exclusive(operation) {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.catch(() => undefined);
    return result;
  }

  async function persist() {
    const payload = `${JSON.stringify(state, null, 2)}\n`;
    writeQueue = writeQueue.then(async () => {
      await mkdir(dirname(storePath), { recursive: true });
      const temporaryPath = `${storePath}.${process.pid}.${randomBytes(5).toString("hex")}.tmp`;
      await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, storePath);
    });
    return writeQueue;
  }

  async function init() {
    if (initialized) return;
    try {
      const parsed = JSON.parse(await readFile(storePath, "utf8"));
      if (!Array.isArray(parsed.users) || !Array.isArray(parsed.sessions)) throw new Error("账号库结构无效");
      state = { version: 1, users: parsed.users, sessions: parsed.sessions };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await persist();
    }
    initialized = true;
  }

  function ensureInitialized() {
    if (!initialized) throw new Error("Auth service must be initialized before use");
  }

  function requireCurrentAdmin(actor) {
    const current = state.users.find((user) => user.id === actor?.id && user.active && user.role === "admin");
    if (!current) throw new AuthError(403, "forbidden", "当前账号无权管理用户");
    return current;
  }

  async function status() {
    ensureInitialized();
    return { configured: state.users.length > 0, userCount: state.users.length };
  }

  function ensureUnique(email, phone, excludedUserId = null) {
    if (state.users.some((user) => user.id !== excludedUserId && user.email === email)) {
      throw new AuthError(409, "email_conflict", "该邮箱已绑定其他账号");
    }
    if (state.users.some((user) => user.id !== excludedUserId && user.phone === phone)) {
      throw new AuthError(409, "phone_conflict", "该手机号已绑定其他账号");
    }
  }

  async function createSession(user) {
    const token = randomBytes(32).toString("base64url");
    const createdAt = new Date(now()).toISOString();
    const expiresAt = new Date(now() + sessionTtlMs).toISOString();
    state.sessions = state.sessions.filter((session) => Date.parse(session.expiresAt) > now());
    state.sessions.push({ id: randomUUID(), tokenHash: hashToken(token), userId: user.id, createdAt, expiresAt });
    await persist();
    return { user: publicUser(user), token, expiresAt };
  }

  async function bootstrap(input) {
    ensureInitialized();
    if (state.users.length) throw new AuthError(409, "already_configured", "系统已完成管理员初始化");
    const account = validateAccountInput(input);
    const timestamp = new Date(now()).toISOString();
    const user = {
      id: randomUUID(),
      name: account.name,
      email: account.email,
      phone: account.phone,
      passwordHash: await hashPassword(account.password),
      role: "admin",
      permissions: PERMISSION_IDS,
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    state.users.push(user);
    return createSession(user);
  }

  async function login(input) {
    ensureInitialized();
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    const password = String(input.password ?? "");
    const user = state.users.find((candidate) => candidate.email === email && candidate.phone === phone && candidate.active);
    const passwordMatches = user
      ? await verifyPassword(password, user.passwordHash)
      : await hashPassword(password || randomBytes(12).toString("base64url")).then(() => false);
    if (!user || !passwordMatches) throw new AuthError(401, "invalid_credentials", "邮箱、手机号或密码不正确");
    return createSession(user);
  }

  async function authenticate(token) {
    ensureInitialized();
    if (!token) return null;
    const tokenHash = hashToken(token);
    const session = state.sessions.find((candidate) => candidate.tokenHash === tokenHash && Date.parse(candidate.expiresAt) > now());
    if (!session) return null;
    const user = state.users.find((candidate) => candidate.id === session.userId && candidate.active);
    return user ? publicUser(user) : null;
  }

  async function logout(token) {
    ensureInitialized();
    if (!token) return;
    const tokenHash = hashToken(token);
    const nextSessions = state.sessions.filter((session) => session.tokenHash !== tokenHash);
    if (nextSessions.length !== state.sessions.length) {
      state.sessions = nextSessions;
      await persist();
    }
  }

  async function listUsers(actor) {
    ensureInitialized();
    requireCurrentAdmin(actor);
    return state.users.map(publicUser).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async function createUser(actor, input) {
    ensureInitialized();
    requireCurrentAdmin(actor);
    const account = validateAccountInput(input);
    ensureUnique(account.email, account.phone);
    const role = input.role === "admin" ? "admin" : "user";
    const timestamp = new Date(now()).toISOString();
    const user = {
      id: randomUUID(),
      name: account.name,
      email: account.email,
      phone: account.phone,
      passwordHash: await hashPassword(account.password),
      role,
      permissions: role === "admin" ? PERMISSION_IDS : normalizePermissions(input.permissions),
      active: input.active !== false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    state.users.push(user);
    await persist();
    return publicUser(user);
  }

  async function updateUser(actor, userId, patch) {
    ensureInitialized();
    requireCurrentAdmin(actor);
    const user = state.users.find((candidate) => candidate.id === userId);
    if (!user) throw new AuthError(404, "user_not_found", "用户不存在");

    const next = { ...user };
    if (patch.name !== undefined) {
      next.name = String(patch.name).trim();
      if (!next.name || next.name.length > 80) throw validationError([{ field: "name", message: "姓名需为 1-80 个字符" }]);
    }
    if (patch.email !== undefined) {
      next.email = normalizeEmail(patch.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) throw validationError([{ field: "email", message: "请输入有效邮箱" }]);
    }
    if (patch.phone !== undefined) {
      next.phone = normalizePhone(patch.phone);
      if (!/^\+?\d{7,15}$/.test(next.phone)) throw validationError([{ field: "phone", message: "请输入有效手机号" }]);
    }
    ensureUnique(next.email, next.phone, user.id);
    if (patch.role !== undefined) next.role = patch.role === "admin" ? "admin" : "user";
    if (patch.active !== undefined) next.active = Boolean(patch.active);

    const wouldRemoveActiveAdmin = user.role === "admin" && user.active && (next.role !== "admin" || !next.active);
    if (wouldRemoveActiveAdmin) {
      const otherActiveAdmins = state.users.filter((candidate) => candidate.id !== user.id && candidate.role === "admin" && candidate.active);
      if (!otherActiveAdmins.length) throw new AuthError(409, "last_admin", "必须至少保留一名启用中的管理员");
    }

    next.permissions = next.role === "admin" ? PERMISSION_IDS : normalizePermissions(patch.permissions ?? next.permissions);
    if (patch.password !== undefined && String(patch.password).length) {
      const password = String(patch.password);
      if (password.length < 10 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        throw validationError([{ field: "password", message: "密码需为 10-128 位，且同时包含字母和数字" }]);
      }
      next.passwordHash = await hashPassword(password);
      state.sessions = state.sessions.filter((session) => session.userId !== user.id);
    }
    next.updatedAt = new Date(now()).toISOString();
    Object.assign(user, next);
    if (!user.active) state.sessions = state.sessions.filter((session) => session.userId !== user.id);
    await persist();
    return publicUser(user);
  }

  return {
    init,
    status,
    authenticate,
    listUsers,
    bootstrap: (input) => exclusive(() => bootstrap(input)),
    login: (input) => exclusive(() => login(input)),
    logout: (token) => exclusive(() => logout(token)),
    createUser: (actor, input) => exclusive(() => createUser(actor, input)),
    updateUser: (actor, userId, patch) => exclusive(() => updateUser(actor, userId, patch)),
  };
}
