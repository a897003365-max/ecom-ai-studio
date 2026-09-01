/**
 * yudao-client.mjs
 *
 * yudao-boot-mini（业务管理后台）只读 API 客户端封装
 * 特性：
 *   - 登录获取 accessToken，内存缓存并在过期前 60 秒主动重登
 *   - 请求遇 HTTP 401 / code==401 时强制重登并重试一次
 *   - 每次请求 5 秒超时（AbortController）
 *   - 分页接口自动翻页拉全量（pageSize=100，最多 10 页防御）
 *   - 未配置 YUDAO_USERNAME / YUDAO_PASSWORD 时直接抛错，由路由层降级
 *
 * 输出：yudao VO 原始 camelCase 对象数组
 */

const REQUEST_TIMEOUT_MS = 5000;
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

let cachedToken = null;
let loginPromise = null;

function getConfig() {
  return {
    baseUrl: (process.env.YUDAO_BASE_URL || "http://127.0.0.1:48080").replace(/\/+$/, ""),
    username: process.env.YUDAO_USERNAME || "",
    password: process.env.YUDAO_PASSWORD || "",
    tenantId: process.env.YUDAO_TENANT_ID || "1",
  };
}

async function fetchJson(url, { method = "GET", headers = {}, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    return { status: response.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

// yudao 的 Jackson 配置把日期序列化为 epoch 毫秒，兼容数字与 ISO 字符串两种形态
function parseExpiresTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function login() {
  const config = getConfig();
  if (!config.username || !config.password) {
    throw new Error("yudao 未配置 YUDAO_USERNAME/YUDAO_PASSWORD");
  }
  const { status, payload } = await fetchJson(`${config.baseUrl}/admin-api/system/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "tenant-id": config.tenantId },
    body: JSON.stringify({ username: config.username, password: config.password }),
  });
  if (status !== 200 || payload?.code !== 0 || !payload?.data?.accessToken) {
    throw new Error(`yudao 登录失败：HTTP ${status} code=${payload?.code ?? "无响应"} ${payload?.msg ?? ""}`.trim());
  }
  cachedToken = { token: payload.data.accessToken, expiresAt: parseExpiresTime(payload.data.expiresTime) };
  return cachedToken;
}

// 并发请求共享同一次登录，避免重复打登录接口
async function ensureToken({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt - TOKEN_EXPIRY_BUFFER_MS > Date.now()) {
    return cachedToken.token;
  }
  if (!loginPromise) {
    loginPromise = login().finally(() => {
      loginPromise = null;
    });
  }
  const session = await loginPromise;
  return session.token;
}

async function getPage(path, pageNo, { retried = false } = {}) {
  const config = getConfig();
  const token = await ensureToken({ forceRefresh: retried });
  const separator = path.includes("?") ? "&" : "?";
  const url = `${config.baseUrl}${path}${separator}pageNo=${pageNo}&pageSize=${PAGE_SIZE}`;
  const { status, payload } = await fetchJson(url, {
    headers: { Authorization: `Bearer ${token}`, "tenant-id": config.tenantId },
  });
  if (status === 401 || payload?.code === 401) {
    if (retried) throw new Error(`yudao 访问令牌失效，重登后仍被拒绝（${path}）`);
    return getPage(path, pageNo, { retried: true });
  }
  if (status !== 200 || payload?.code !== 0) {
    throw new Error(`yudao 请求失败：HTTP ${status} code=${payload?.code ?? "无响应"} ${payload?.msg ?? ""}（${path}）`.trim());
  }
  return payload.data ?? {};
}

// 自动翻页拉全量，最多 MAX_PAGES 页防御
async function fetchAllPages(path) {
  const items = [];
  let total = 0;
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
    const data = await getPage(path, pageNo);
    const list = Array.isArray(data.list) ? data.list : [];
    total = Number(data.total) || items.length + list.length;
    items.push(...list);
    if (items.length >= total || list.length < PAGE_SIZE) break;
  }
  return { items, total };
}

export function fetchCompetitorPrices() {
  return fetchAllPages("/admin-api/ecom/competitor-price/page");
}

export function fetchProducts() {
  return fetchAllPages("/admin-api/ecom/product/page");
}
