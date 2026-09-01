const explicitUrl = process.env.ECOM_STUDIO_URL;
let sessionCookie = "";

async function findService() {
  const candidates = explicitUrl
    ? [explicitUrl]
    : Array.from({ length: 11 }, (_, index) => `http://127.0.0.1:${5173 + index}`);
  for (const baseUrl of candidates) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      const payload = await response.json();
      if (response.ok && payload.ok) return baseUrl;
    } catch {
      // Continue to the next local port.
    }
  }
  throw new Error("未找到运行中的 ecom AI Studio 本地服务");
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(`${path}: ${message || response.status}`);
  }
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get("set-cookie");
  if (setCookie) sessionCookie = setCookie.split(";")[0];
  return payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const baseUrl = await findService();
const authStatus = await json(baseUrl, "/api/auth/status");
let canCheckProtectedData = Boolean(authStatus.user);
if (!authStatus.user) {
  const email = process.env.ECOM_STUDIO_SMOKE_EMAIL;
  const phone = process.env.ECOM_STUDIO_SMOKE_PHONE;
  const password = process.env.ECOM_STUDIO_SMOKE_PASSWORD;
  if (!email || !phone || !password) {
    const protectedProbe = await fetch(`${baseUrl}/api/analytics`);
    assert(protectedProbe.status === 401, "未登录的业务 API 未返回 401");
    console.log(`smoke auth gate ok: ${baseUrl}`);
    console.log("protected data checks skipped: set ECOM_STUDIO_SMOKE_EMAIL/PHONE/PASSWORD for an isolated test account");
  } else {
    await json(baseUrl, authStatus.configured ? "/api/auth/login" : "/api/auth/bootstrap", {
      method: "POST",
      body: JSON.stringify({ name: "Smoke 管理员", email, phone, password }),
    });
    canCheckProtectedData = true;
  }
}
if (canCheckProtectedData) {
const sources = await json(baseUrl, "/api/data-sources");
const analytics = await json(baseUrl, "/api/analytics");
const filteredAnalytics = await json(baseUrl, "/api/analytics?start=2026-07-10&end=2026-07-10");
const workflows = await json(baseUrl, "/api/workflows");

assert(sources.warehouse?.available, "本地 DuckDB / Parquet 数仓不可用");
assert(sources.sources.some((source) => source.id === "warehouse" && source.status === "connected"), "本地数仓连接状态异常");
assert(sources.sources.some((source) => source.id === "dingtalk" && source.status === "connected"), "钉钉只读聚合快照未就绪");
assert(sources.sources.some((source) => source.id === "feishu" && source.status === "connected"), "飞书聚合快照未就绪");
assert(workflows.workflow.readyCount === workflows.workflow.expectedCount, "Claude Code Agent 配置不完整");
assert(analytics.warehouse?.recordCount > 0, "本地数仓 PowerBI 独有数据目录为空");
assert(analytics.warehouse?.scope === "powerbi_unique_only", "本地数仓未启用 PowerBI 独有数据边界");
assert(analytics.warehouse?.quality?.queryCount === 25, "本地数仓独有查询数量异常");
assert(analytics.warehouse?.quality?.excludedQueryCount === 2, "本地数仓重叠排除数量异常");
assert(
  analytics.warehouse?.overlapPolicy?.excludedQueries?.some((item) => item.query === "00-月表汇总"),
  "全渠道日经营汇总未从本地数仓排除",
);
assert(
  analytics.warehouse?.overlapPolicy?.excludedQueries?.some((item) => item.query === "03-1-各渠道目标金额"),
  "月度渠道目标未从本地数仓排除",
);
assert(analytics.dingtalk?.recordCount > 0, "钉钉同步快照为空");
assert(["green", "orange"].includes(analytics.dataStatus?.tone), "运营看板数据完整性状态缺失");
assert(typeof analytics.dataStatus?.expectedDate === "string", "运营看板 T-1 检查日期缺失");
assert(filteredAnalytics.dingtalk?.period?.start === "2026-07-10", "日期筛选未更新钉钉开始日期");
assert(filteredAnalytics.dingtalk?.period?.end === "2026-07-10", "日期筛选未更新钉钉结束日期");
assert(filteredAnalytics.dingtalk?.daily?.length === 1, "日期筛选未联动经营趋势");
assert(filteredAnalytics.dingtalk?.platforms?.length > 0, "日期筛选后渠道汇总为空");
assert(filteredAnalytics.dingtalk?.stores?.length > 0, "日期筛选后店铺汇总为空");
assert(filteredAnalytics.dingtalk?.reporting?.monthlyOverview?.daily?.length > 0, "月度 MTD 渠道回款趋势为空");
assert(filteredAnalytics.dingtalk?.reporting?.monthlyOverview?.metrics?.target > 0, "销售目标未进入月度经营概览");
assert(filteredAnalytics.dingtalk?.reporting?.latestComparison?.channels?.length > 0, "最新渠道日环比为空");
assert(filteredAnalytics.dingtalk?.reporting?.latestComparison?.stores?.length > 0, "最新店铺日环比为空");
assert(analytics.feishu?.content?.processedRows > 0, "飞书内容快照为空");

const serialized = JSON.stringify(analytics);
assert(!serialized.includes("xsec_token="), "聚合快照包含访问令牌");
const remoteUrls = serialized.match(/https?:\/\/[^"\s]+/g) || [];
assert(
  remoteUrls.every((url) => /^https:\/\/img\.alicdn\.com\//i.test(url)),
  "聚合快照包含未允许的原始链接",
);

console.log(`smoke ok: ${baseUrl}`);
console.log(`warehouse rows: ${analytics.warehouse.recordCount}`);
console.log(`dingtalk rows: ${analytics.dingtalk.recordCount}`);
console.log(`feishu rows: ${analytics.feishu.content.processedRows}`);
console.log(`workflow agents: ${workflows.workflow.readyCount}/${workflows.workflow.expectedCount}`);
}
