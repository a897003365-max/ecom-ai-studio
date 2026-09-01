import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import { extname, join, normalize } from "node:path";
import "dotenv/config";
import { createServer as createViteServer } from "vite";
import { AuthError, createAuthService, PERMISSIONS } from "./auth.mjs";
import { getAnalytics, invalidateAnalyticsCache, prewarmAnalyticsCache } from "./analytics-cache.mjs";
import { handleArkCall } from "./arkProxy.mjs";
import { parseDingTalkFile } from "./dingtalk.mjs";
import { checkDingTalkApi, syncDingTalkApi } from "./dingtalk-api.mjs";
import { acquireDingTalkLock } from "./dingtalk-lock.mjs";
import { checkFeishu, sheetInventory, syncFeishu } from "./feishu.mjs";
import { buildDashboardDataStatus } from "./dashboard-status.mjs";
import { checkWarehouse, queryProductsOnDemand, readWarehouseSnapshot, syncWarehouse, warehouseSnapshotMtime } from "./warehouse.mjs";
import { searchSite } from "./search-service.mjs";
import { fetchCompetitorPrices, fetchProducts } from "./yudao-client.mjs";
import { getPipelineState, hasSourceXlsx, saveSourceFile, sourceXlsxInfo, startAnalysisPipeline, requestCancel, visionProviderInfo } from "./intelligence-pipeline.mjs";
import { generateIntelligenceReport, reportArtifactPath } from "./intelligence-report.mjs";
import { hasVisionKey } from "./vision-client.mjs";
import {
  beginSync,
  dataDir,
  finishSync,
  getTask,
  latestUpload,
  latestSnapshot,
  latestSnapshotMeta,
  listSyncRuns,
  listTasks,
  listUploads,
  recordUpload,
  updateUploadStatus,
  updateTaskAction,
  upsertTask,
} from "./storage.mjs";
import { getAnalysis, getAnalysisStatus, getCrawlStatus, listAnalyses, listCrawledNotes, startAnalysis, startCrawl } from "./sentiment.mjs";
import { fetchRelatedKeywords } from "./workflow-proxy.mjs";
import { getWorkflowStatus, queueWorkflowEnvelope, workflowEnvelopePaths } from "./workflow.mjs";
import { requiredTaskPermission } from "./task-permissions.mjs";

const production = process.argv.includes("--production");
const host = process.env.HOST || "127.0.0.1";
const preferredPort = Number(process.env.PORT || 5173);
const distDir = join(process.cwd(), "dist");
const uploadDir = join(dataDir, "uploads");
mkdirSync(uploadDir, { recursive: true });

const configuredSessionTtlHours = Number(process.env.AUTH_SESSION_TTL_HOURS || 12);
const sessionTtlHours = Number.isFinite(configuredSessionTtlHours) && configuredSessionTtlHours > 0 && configuredSessionTtlHours <= 24 * 30
  ? configuredSessionTtlHours
  : 12;
const authService = createAuthService({
  storePath: process.env.AUTH_STORE_PATH || join(dataDir, "auth", "auth-store.json"),
  sessionTtlMs: sessionTtlHours * 60 * 60 * 1000,
});
await authService.init();

const authEnforcementEnabled = process.env.AUTH_ENFORCEMENT_ENABLED === "1";
const localAccessTimestamp = new Date().toISOString();
const localAccessUser = Object.freeze({
  id: "local-access-mode",
  name: "本地免登录",
  email: "local-access@localhost",
  phone: "",
  role: "admin",
  permissions: PERMISSIONS.map((permission) => permission.id),
  active: true,
  createdAt: localAccessTimestamp,
  updatedAt: localAccessTimestamp,
});

const sessionCookieName = "ecom_session";
const loginAttempts = new Map();
const loginRateLimiter = {
  limit: 5,
  windowMs: 15 * 60 * 1000,
  check(key) {
    const now = Date.now();
    const record = loginAttempts.get(key);
    if (!record || record.resetAt <= now) return;
    if (record.count >= this.limit) {
      const retryAfter = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      throw new AuthError(429, "rate_limit_exceeded", `登录尝试过多，请在 ${retryAfter} 秒后重试`, { retryAfter });
    }
  },
  fail(key) {
    const now = Date.now();
    const record = loginAttempts.get(key);
    if (!record || record.resetAt <= now) loginAttempts.set(key, { count: 1, resetAt: now + this.windowMs });
    else record.count += 1;
  },
  success(key) {
    loginAttempts.delete(key);
  },
};

// API 级限流：防单 IP 暴力探测/DoS（登录另有 loginRateLimiter 限 5 次/15 分钟）
const apiHits = new Map();
const apiRateLimiter = {
  limit: 120,
  windowMs: 60 * 1000,
  check(key) {
    const now = Date.now();
    const record = apiHits.get(key);
    if (!record || record.resetAt <= now) {
      apiHits.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    record.count += 1;
    if (record.count > this.limit) {
      const retryAfter = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      throw new AuthError(429, "rate_limit_exceeded", `请求过于频繁，请在 ${retryAfter} 秒后重试`, { retryAfter });
    }
  },
};

function clientIp(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return process.env.AUTH_TRUST_PROXY === "1" && forwarded ? forwarded : (request.socket.remoteAddress || "local");
}

const uploadPolicy = [
  {
    id: "local-direct",
    category: "本地直连，不上传",
    tone: "green",
    items: ["DuckDB 本地数仓", "Parquet 增量分区（数量随快照变化）", "E:/Github/.claude 工作流与 Agent", "本地脚本和素材目录"],
    reason: "源文件与明细留在本机，网页只读取聚合结果和运行状态。",
  },
  {
    id: "sanitized-upload",
    category: "需要上传或导出后接入",
    tone: "orange",
    items: ["离线历史 Excel/CSV", "平台后台手工导出的投放明细", "素材与内容映射表", "异常文件修复后重载"],
    reason: "文件只进入本机 local-data 或数仓分区，不上传到外部服务。",
  },
  {
    id: "aggregate-sync",
    category: "授权后聚合同步",
    tone: "blue",
    items: ["飞书媒介日报汇总", "飞书种草笔记聚合指标", "钉钉经营指标快照", "任务和同步历史"],
    reason: "只保存看板所需聚合值，不保存原始链接、联系人或买家信息。",
  },
  {
    id: "never-upload",
    category: "禁止上传到网页",
    tone: "red",
    items: ["手机号与个人联系方式", "买家 ID/地址/电话/订单备注", "App Secret、Access Token、Cookie", "带 xsec_token 的发布或主页链接", "客服明细和源文件路径"],
    reason: "这些字段与经营看板无关，且包含个人信息或访问凭据。",
  },
];

function sendJson(response, status, payload, headers = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const outHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  };
  // 大响应按 Accept-Encoding 协商压缩（2.8MB analytics -> ~300KB）
  const acceptEncoding = String(response.req?.headers?.["accept-encoding"] || "").toLowerCase();
  const useBr = acceptEncoding.includes("br") && body.length > 1024;
  const useGzip = !useBr && acceptEncoding.includes("gzip") && body.length > 1024;
  if (useBr) {
    outHeaders["Content-Encoding"] = "br";
    response.writeHead(status, outHeaders);
    // 默认 quality 11 在 4MB 看板响应上同步耗时 ~5s（阻塞事件循环）；降至 6 后 ~50ms，体积仅大 ~25%。
    response.end(brotliCompressSync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 6 } }));
    return;
  }
  if (useGzip) {
    outHeaders["Content-Encoding"] = "gzip";
    response.writeHead(status, outHeaders);
    response.end(gzipSync(body));
    return;
  }
  response.writeHead(status, outHeaders);
  response.end(body);
}

// 内容哈希 ETag：用响应体 SHA-1 作 ETag，命中 If-None-Match 直接 304。
// 选内容哈希而非 mtime 指纹：analytics-cache 的 SWR 会在 sync 后先返回旧值再后台刷新，
// 内容哈希随实际值变化，刷新完成后 ETag 自然改变，客户端能拿到新值；指纹法则会把旧值永久钉住。
function sendJsonCached(response, payload) {
  const body = JSON.stringify(payload);
  const etag = `"${createHash("sha1").update(body).digest("base64url").slice(0, 20)}"`;
  if (response.req?.headers?.["if-none-match"] === etag) {
    response.writeHead(304, { ETag: etag, "Cache-Control": "no-cache" });
    response.end();
    return;
  }
  return sendJson(response, 200, body, { ETag: etag, "Cache-Control": "no-cache" });
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return separator < 0 ? [part, ""] : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      }),
  );
}

function getSessionToken(request) {
  return parseCookies(request)[sessionCookieName] || "";
}

async function requestUser(request) {
  const sessionUser = await authService.authenticate(getSessionToken(request));
  return sessionUser || (authEnforcementEnabled ? null : localAccessUser);
}

function sessionCookie(request, token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const secure = process.env.AUTH_SECURE_COOKIE === "1" || forwardedProto === "https";
  return `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function clearedSessionCookie(request) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const secure = process.env.AUTH_SECURE_COOKIE === "1" || forwardedProto === "https";
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

function sendAuthError(response, error) {
  const status = error instanceof AuthError ? error.status : 500;
  const headers = error?.code === "rate_limit_exceeded" && error.details?.retryAfter
    ? { "Retry-After": String(error.details.retryAfter) }
    : {};
  return sendJson(response, status, {
    error: {
      code: error instanceof AuthError ? error.code : "internal_error",
      message: error instanceof AuthError ? error.message : "认证服务暂时不可用",
      ...(error instanceof AuthError && error.details ? { details: error.details } : {}),
    },
  }, headers);
}

// 安全响应头：防点击劫持/类型嗅探/协议降级；CSP 基线兼容 Vite dev（上线可收紧 script-src）
function applySecurityHeaders(response, request) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  if (process.env.AUTH_SECURE_COOKIE === "1" || forwardedProto === "https") {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  response.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "));
}

function requestIdentity(request, body = {}) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const address = process.env.AUTH_TRUST_PROXY === "1" && forwarded
    ? forwarded
    : request.socket.remoteAddress || "local";
  return `${address}:${String(body.email || "").trim().toLowerCase()}:${String(body.phone || "").replace(/\D/g, "")}`;
}

function requiredPermissionForApi(method, path) {
  if (path.startsWith("/api/admin/")) return "admin.users";
  if (path === "/api/data-sources") return ["settings.view", "dashboard.view"];
  if (path === "/api/history") return "settings.view";
  if (path === "/api/uploads" || /^\/api\/sync\/(warehouse|feishu|dingtalk)$/.test(path)) return "settings.manage";
  if (path === "/api/ark/call") return "content.manage";
  if (path === "/api/analytics") return "analytics.view";
  if (path === "/api/search") return ["analytics.view", "products.view"];
  if (path === "/api/sync/analytics") return "analytics.manage";
  if (path === "/api/products") return "products.view";
  if (path === "/api/masterdata/competitor-prices") return "intelligence.view";
  if (path === "/api/masterdata/products") return "products.view";
  if (path.startsWith("/api/workflows")) return method === "GET" ? "content.view" : "content.manage";
  if (path.startsWith("/api/tasks")) return method === "GET"
    ? ["tasks.view", "content.view", "images.view", "intelligence.view"]
    : null;
  if (path.startsWith("/api/intelligence")) return method === "GET" ? "intelligence.view" : "intelligence.manage";
  if (path.startsWith("/api/sentiment")) return method === "GET" ? "intelligence.view" : "intelligence.manage";
  return "dashboard.view";
}

function requireApiPermission(user, method, path) {
  const required = requiredPermissionForApi(method, path);
  if (!required) return;
  const permissions = Array.isArray(required) ? required : [required];
  if (user.role !== "admin" && !permissions.some((permission) => user.permissions.includes(permission))) {
    throw new AuthError(403, "forbidden", "当前账号无权执行此操作", { permissions });
  }
}

function requireTaskPermission(user, task) {
  const permission = requiredTaskPermission(task?.type);
  if (user.role !== "admin" && !user.permissions.includes(permission)) {
    throw new AuthError(403, "forbidden", "当前账号无权操作该任务类型", { permissions: [permission], taskType: task.type });
  }
}

async function readJson(request, maxBytes = 15 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("请求体超过 15 MB 限制");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function safeFileName(name) {
  return String(name || "upload.dat").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 160);
}

function errorMessage(error) {
  const message = error instanceof Error ? error.message : "未知错误";
  return message
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted-url]")
    .replace(/(access_token|xsec_token|app_secret|cookie)=([^\s&]+)/gi, "$1=[redacted]")
    .slice(0, 2000);
}

function localTaskId(prefix = "task") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTaskId(value) {
  return workflowEnvelopePaths(value).taskId;
}

function hasCurrentProductManagementMetrics(productManagement) {
  const kpis = productManagement?.kpis;
  return Boolean(
    kpis
    && typeof kpis === "object"
    && Object.hasOwn(kpis, "totalReceivedAmount")
    && Object.hasOwn(kpis, "collectionRate")
    && !Object.hasOwn(kpis, "totalShippedAmount")
    && !Object.hasOwn(kpis, "totalShippedUnits")
    && Array.isArray(productManagement?.fulfillmentByProduct)
    && productManagement?.monthlyComparison?.currentPeriod
    && Array.isArray(productManagement?.previousDailyTrend),
  );
}

function dingtalkAutomationStatus() {
  const runs = listSyncRuns(60).filter((run) => run.sourceId === "dingtalk");
  const latest = runs[0] ?? null;
  const lastSuccess = runs.find((run) => run.status === "success") ?? null;
  const lastFailure = runs.find((run) => run.status === "failed") ?? null;
  const ageMs = latest?.startedAt ? Date.now() - Date.parse(latest.startedAt) : Number.POSITIVE_INFINITY;
  const stale = latest?.status === "running" && ageMs > 2 * 60 * 60 * 1000;
  let state = "unknown";
  let statusLabel = "尚无运行记录";
  if (stale) {
    state = "stale";
    statusLabel = "运行记录超时";
  } else if (latest?.status === "running") {
    state = "running";
    statusLabel = "无人值守同步中";
  } else if (latest?.status === "failed") {
    state = lastSuccess ? "degraded" : "failed";
    statusLabel = lastSuccess ? "上次失败，沿用上一份快照" : "同步失败";
  } else if (latest?.status === "success") {
    state = "healthy";
    statusLabel = "无人值守正常";
  }
  return {
    enabled: checkDingTalkApi().configured,
    unattended: true,
    state,
    statusLabel,
    schedule: checkDingTalkApi().schedule,
    lastAttemptAt: latest?.startedAt ?? null,
    lastSuccessAt: lastSuccess?.finishedAt ?? null,
    lastFailureAt: lastFailure?.finishedAt ?? null,
    lastFailure: lastFailure?.detail ?? null,
    staleAfterMinutes: 120,
  };
}

async function getDataSources() {
  const warehouse = await checkWarehouse();
  const { snapshot: warehouseSnapshot, ...warehouseStatus } = warehouse;
  const feishu = await checkFeishu();
  const dingtalk = checkDingTalkApi();
  const workflow = await getWorkflowStatus();
  const feishuSnapshot = latestSnapshot("feishu");
  const dingtalkSnapshot = latestSnapshot("dingtalk");
  const dingtalkUpload = latestUpload("dingtalk_operations");
  const dingtalkAutomation = dingtalkAutomationStatus();

  return {
    sources: [
      {
        id: "warehouse",
        name: "本地经营数据仓库",
        kind: "local_direct",
        status: warehouse.available ? "connected" : warehouse.configured ? "ready" : "offline",
        statusLabel: warehouse.syncing ? "同步中" : warehouse.available ? `${warehouse.completedQueries}/${warehouse.queryCount} 查询` : "等待初始化",
        detail: `${warehouse.sourceFileCount} 个源文件，${warehouse.partitionCount} 个 Parquet 分区，${warehouse.failedPartitionCount} 个异常`,
        lastSync: warehouseSnapshot?.refreshedAt ?? null,
        records: warehouse.rowCount,
        location: "local-data/warehouse/ecom.duckdb",
      },
      {
        id: "feishu",
        name: "飞书共享表",
        kind: "authorized_aggregate",
        status: feishu.available ? (feishuSnapshot ? "connected" : "ready") : "auth_required",
        statusLabel: feishu.available ? (feishuSnapshot ? "已同步" : "可同步") : "需要授权",
        detail: feishu.available ? `${sheetInventory.length} 个业务工作表，仅保存聚合数据` : feishu.error,
        lastSync: feishuSnapshot?.finishedAt ?? null,
        records: feishuSnapshot?.recordCount ?? 0,
        location: "飞书用户身份只读",
      },
      {
        id: "dingtalk",
        name: "钉钉运营数据表",
        kind: dingtalk.configured ? "scheduled_read_only" : "upload_or_auth",
        status: dingtalkAutomation.state === "degraded" ? "cached" : dingtalkSnapshot ? "connected" : dingtalk.configured ? "ready" : dingtalkUpload?.status === "parse_failed" ? "offline" : dingtalkUpload ? "ready" : "auth_required",
        statusLabel: dingtalkSnapshot ? dingtalkAutomation.statusLabel : dingtalk.configured ? "定时同步就绪" : dingtalkUpload?.status === "parse_failed" ? "解析失败" : dingtalkUpload ? "等待同步" : "等待配置/导入",
        detail: dingtalkSnapshot
          ? `${dingtalkSnapshot.snapshot.inventory?.length ?? 0} 个工作表，仅保存渠道、店铺、日期和经营指标聚合；每日 ${dingtalk.schedule.join(" / ")}`
          : dingtalk.configured
            ? `HTTP Sheet API 只读连接；每日 ${dingtalk.schedule.join(" / ")} 自动同步`
            : "也可导入 CSV/XLSX/JSON，由本机自动解析。",
        lastSync: dingtalkSnapshot?.finishedAt ?? null,
        records: dingtalkSnapshot?.recordCount ?? 0,
        location: dingtalk.configured ? "钉钉共享表 -> local-data 脱敏快照" : "钉钉本地导出",
        schedule: dingtalk.schedule,
        automation: dingtalkAutomation,
        writeEnabled: false,
      },
      {
        id: "workflow",
        name: "Claude Code 内容生产工作流",
        kind: "local_direct",
        status: workflow.status === "ready" ? "connected" : "incomplete",
        statusLabel: workflow.status === "ready" ? `${workflow.readyCount}/${workflow.expectedCount} Agent 就绪` : "配置不完整",
        detail: `网页任务写入本地执行队列：${workflow.executionPort}`,
        lastSync: null,
        records: workflow.readyCount,
        location: workflow.localRoot,
      },
    ],
    warehouse: warehouseStatus,
    workflow,
    uploadPolicy,
    uploads: listUploads(),
  };
}

let activeDingTalkSync = null;

async function syncSource(sourceId) {
  if (sourceId === "dingtalk" && activeDingTalkSync) return activeDingTalkSync;

  const operation = (async () => {
    const run = beginSync(sourceId);
    try {
      let snapshot;
      if (sourceId === "warehouse") snapshot = await syncWarehouse();
      else if (sourceId === "feishu") snapshot = await syncFeishu();
      else if (sourceId === "dingtalk") {
        const api = checkDingTalkApi();
        if (api.configured) {
          const lock = await acquireDingTalkLock("dashboard-server");
          if (!lock) throw new Error("钉钉同步已在运行，本次请求未执行，请稍后重试");
          try {
            snapshot = await syncDingTalkApi();
          } finally {
            await lock.release();
          }
        } else {
          const upload = latestUpload("dingtalk_operations");
          if (!upload) throw new Error("钉钉只读连接尚未配置，且没有可用的 CSV/XLSX/JSON 导出文件");
          snapshot = await parseDingTalkFile({ filePath: upload.storagePath, fileName: upload.fileName });
          updateUploadStatus(upload.id, "parsed");
        }
      } else throw new Error(`不支持的数据源：${sourceId}`);
      const recordCount = snapshot.recordCount ?? 0;
      const detailBySource = {
        warehouse: "本地源文件已完成增量同步，DuckDB 聚合快照已更新",
        feishu: "两份飞书工作簿已完成脱敏聚合",
        dingtalk: snapshot.source === "dingtalk_api" ? "钉钉共享表已完成只读同步与脱敏聚合" : "钉钉导出文件已完成本机解析与脱敏聚合",
      };
      finishSync(run.id, {
        status: "success",
        recordCount,
        detail: detailBySource[sourceId],
        snapshot,
      });
      // 数据更新后标记 analytics 缓存 stale 并后台异步刷新（不阻塞调用方）
      invalidateAnalyticsCache();
      return { runId: run.id, snapshot };
    } catch (error) {
      finishSync(run.id, { status: "failed", detail: errorMessage(error) });
      throw error;
    }
  })();

  if (sourceId !== "dingtalk") return operation;
  activeDingTalkSync = operation;
  try {
    return await operation;
  } finally {
    if (activeDingTalkSync === operation) activeDingTalkSync = null;
  }
}

function dashboardDataStatus({ dingtalk, warehouse }) {
  return buildDashboardDataStatus({
    dingtalk: dingtalk
      ? {
        completedThrough: dingtalk.reporting?.completedThrough || dingtalk.period?.end,
        quality: { anomalyCount: dingtalk.quality?.anomalyCount || 0 },
      }
      : null,
    warehouse: warehouse
      ? {
        periodEnd: warehouse.powerbiPages?.period?.end || warehouse.period?.end,
        quality: warehouse.quality,
      }
      : null,
  });
}

let activeDashboardSync = null;

async function syncDashboardSources() {
  if (activeDashboardSync) return activeDashboardSync;
  activeDashboardSync = (async () => {
    const results = await Promise.allSettled([syncSource("dingtalk"), syncSource("warehouse")]);
    const [dingtalkResult, warehouseResult] = results;
    const dingtalk = dingtalkResult.status === "fulfilled"
      ? dingtalkResult.value.snapshot
      : latestSnapshot("dingtalk")?.snapshot ?? null;
    const warehouse = warehouseResult.status === "fulfilled"
      ? warehouseResult.value.snapshot
      : await readWarehouseSnapshot();
    const runs = [];
    if (dingtalkResult.status === "fulfilled") runs.push({ runId: dingtalkResult.value.runId, sourceId: "dingtalk", recordCount: dingtalkResult.value.snapshot.recordCount ?? 0 });
    if (warehouseResult.status === "fulfilled") runs.push({ runId: warehouseResult.value.runId, sourceId: "warehouse", recordCount: warehouseResult.value.snapshot.recordCount ?? 0 });
    const failures = results
      .map((result, index) => result.status === "rejected" ? { sourceId: index === 0 ? "dingtalk" : "warehouse", detail: errorMessage(result.reason) } : null)
      .filter(Boolean);
    return {
      status: failures.length ? (runs.length ? "partial" : "failed") : "success",
      runs,
      failures,
      detail: "钉钉经营数据 + 本地数仓（含 PowerBI 独有模块）",
      dataStatus: dashboardDataStatus({ dingtalk, warehouse }),
    };
  })();
  try {
    return await activeDashboardSync;
  } finally {
    activeDashboardSync = null;
  }
}

async function handleAuthApi(request, response, url) {
  const path = url.pathname;
  try {
    if (request.method === "GET" && path === "/api/auth/status") {
      const status = await authService.status();
      const user = await requestUser(request);
      return sendJson(response, 200, {
        ...status,
        enforcementEnabled: authEnforcementEnabled,
        user,
        permissionCatalog: user ? PERMISSIONS : [],
      });
    }
    if (request.method === "POST" && path === "/api/auth/bootstrap") {
      const body = await readJson(request, 64 * 1024);
      const identity = requestIdentity(request, body);
      loginRateLimiter.check(identity);
      try {
        const session = await authService.bootstrap(body);
        loginRateLimiter.success(identity);
        return sendJson(response, 201, { user: session.user, expiresAt: session.expiresAt }, {
          "Set-Cookie": sessionCookie(request, session.token, session.expiresAt),
          Location: `/api/admin/users/${session.user.id}`,
        });
      } catch (error) {
        loginRateLimiter.fail(identity);
        throw error;
      }
    }
    if (request.method === "POST" && path === "/api/auth/login") {
      const body = await readJson(request, 64 * 1024);
      const identity = requestIdentity(request, body);
      loginRateLimiter.check(identity);
      try {
        const session = await authService.login(body);
        loginRateLimiter.success(identity);
        return sendJson(response, 200, { user: session.user, expiresAt: session.expiresAt }, {
          "Set-Cookie": sessionCookie(request, session.token, session.expiresAt),
        });
      } catch (error) {
        loginRateLimiter.fail(identity);
        throw error;
      }
    }
    if (request.method === "POST" && path === "/api/auth/logout") {
      await authService.logout(getSessionToken(request));
      return sendJson(response, 200, { ok: true }, { "Set-Cookie": clearedSessionCookie(request) });
    }
    return sendJson(response, 404, { error: { code: "not_found", message: "认证接口不存在" } });
  } catch (error) {
    if (error instanceof SyntaxError) return sendAuthError(response, new AuthError(400, "invalid_json", "请求内容不是有效 JSON"));
    return sendAuthError(response, error);
  }
}

async function handleAdminApi(request, response, url, user) {
  const path = url.pathname;
  try {
    if (request.method === "GET" && path === "/api/admin/users") {
      return sendJson(response, 200, { users: await authService.listUsers(user), permissionCatalog: PERMISSIONS });
    }
    if (request.method === "POST" && path === "/api/admin/users") {
      const created = await authService.createUser(user, await readJson(request, 64 * 1024));
      return sendJson(response, 201, { user: created }, { Location: `/api/admin/users/${created.id}` });
    }
    const userMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (request.method === "PATCH" && userMatch) {
      const updated = await authService.updateUser(user, decodeURIComponent(userMatch[1]), await readJson(request, 64 * 1024));
      return sendJson(response, 200, { user: updated });
    }
    return sendJson(response, 404, { error: { code: "not_found", message: "管理接口不存在" } });
  } catch (error) {
    if (error instanceof SyntaxError) return sendAuthError(response, new AuthError(400, "invalid_json", "请求内容不是有效 JSON"));
    return sendAuthError(response, error);
  }
}

async function handleApi(request, response, url) {
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/health") {
    return sendJson(response, 200, { ok: true, mode: production ? "production" : "development", time: new Date().toISOString(), dingtalk: dingtalkAutomationStatus() });
  }
  // API 级限流：单 IP 120 次/分钟，超限返回 429
  try {
    apiRateLimiter.check(clientIp(request));
  } catch (error) {
    return sendAuthError(response, error);
  }
  if (path.startsWith("/api/auth/")) return handleAuthApi(request, response, url);

  const currentUser = await requestUser(request);
  if (!currentUser) return sendAuthError(response, new AuthError(401, "authentication_required", "请先登录后再访问"));
  try {
    requireApiPermission(currentUser, request.method || "GET", path);
  } catch (error) {
    return sendAuthError(response, error);
  }
  if (path.startsWith("/api/admin/")) return handleAdminApi(request, response, url, currentUser);

  if (request.method === "GET" && path === "/api/data-sources") {
    return sendJson(response, 200, await getDataSources());
  }
  if (request.method === "GET" && path === "/api/analytics") {
    const start = url.searchParams.get("start") || undefined;
    const end = url.searchParams.get("end") || undefined;
    const { value } = await getAnalytics(start, end);
    return sendJsonCached(response, value);
  }
  if (request.method === "POST" && path === "/api/search") {
    let body;
    try {
      body = await readJson(request, 8 * 1024);
    } catch {
      return sendJson(response, 400, { error: { code: "invalid_json", message: "请求内容不是有效 JSON" } });
    }
    const query = String(body.query ?? "").trim();
    const mode = body.mode === "suggest" ? "suggest" : "answer";
    const limit = Number.isInteger(body.limit) ? Math.min(10, Math.max(1, body.limit)) : 8;
    if (query.length < 1 || query.length > 200) {
      return sendJson(response, 400, { error: { code: "invalid_query", message: "查询长度需为 1–200 个字符" } });
    }
    const dingtalkSnapshot = latestSnapshot("dingtalk")?.snapshot ?? null;
    const warehouseSnapshot = await readWarehouseSnapshot();
    const context = {
      dingtalk: dingtalkSnapshot,
      dingtalkMeta: latestSnapshotMeta("dingtalk"),
      warehouse: warehouseSnapshot,
      warehouseMtime: warehouseSnapshotMtime(),
      warehouseRefreshedAt: warehouseSnapshot?.refreshedAt ?? null,
    };
    const result = await searchSite({ query, mode, limit, user: currentUser, permissions: currentUser.permissions }, context);
    return sendJson(response, 200, result);
  }
  if (request.method === "GET" && path === "/api/products") {
    const start = url.searchParams.get("start") || undefined;
    const end = url.searchParams.get("end") || undefined;
    const statuses = url.searchParams.getAll("status");
    const channels = url.searchParams.getAll("channel");
    const storeShortNames = url.searchParams.getAll("storeShortName");
    // 用快照 refreshedAt（随 sync 变化）而非 new Date()，保证相同数据响应体一致，ETag 可命中 304
    const snapshot = await readWarehouseSnapshot();
    const refreshedAt = snapshot?.refreshedAt ?? null;
    if (start || end || statuses.length || channels.length || storeShortNames.length) {
      try {
        const onDemand = await queryProductsOnDemand({ start, end, statuses, channels, storeShortNames });
        return sendJsonCached(response, {
          productManagement: onDemand.productManagement,
          refreshedAt,
          status: "ok",
          filtered: { start: start ?? null, end: end ?? null, statuses, channels, storeShortNames },
        });
      } catch (error) {
        return sendJson(response, 200, {
          productManagement: null,
          refreshedAt: null,
          status: "stale",
          error: error instanceof Error ? error.message : "按条件查询失败",
        });
      }
    }
    const cachedProductManagement = snapshot?.productManagement ?? null;
    if (hasCurrentProductManagementMetrics(cachedProductManagement)) {
      return sendJsonCached(response, {
        productManagement: cachedProductManagement,
        refreshedAt,
        status: "ok",
      });
    }
    try {
      const onDemand = await queryProductsOnDemand({ statuses: [], channels: [], storeShortNames: [] });
      const productManagement = hasCurrentProductManagementMetrics(onDemand?.productManagement)
        ? onDemand.productManagement
        : null;
      return sendJsonCached(response, {
        productManagement,
        refreshedAt: productManagement ? refreshedAt : null,
        status: productManagement ? "ok" : "stale",
        ...(productManagement ? {} : { error: "商品管理快照缺少当前口径字段" }),
      });
    } catch (error) {
      return sendJson(response, 200, {
        productManagement: null,
        refreshedAt: null,
        status: "stale",
        error: error instanceof Error ? error.message : "商品管理口径重算失败",
      });
    }
  }
  // yudao 业务管理后台只读代理：不可达/未配置/报错时降级返回空列表，不把异常抛给前端
  if (request.method === "GET" && (path === "/api/masterdata/competitor-prices" || path === "/api/masterdata/products")) {
    const fetcher = path === "/api/masterdata/competitor-prices" ? fetchCompetitorPrices : fetchProducts;
    try {
      const { items, total } = await fetcher();
      return sendJson(response, 200, { items, total, degraded: false, source: "yudao", fetchedAt: new Date().toISOString() });
    } catch (error) {
      const reason = errorMessage(error);
      console.error(`[yudao] ${path} 降级：${reason}`);
      return sendJson(response, 200, { items: [], total: 0, degraded: true, reason });
    }
  }
  if (request.method === "POST" && path === "/api/sync/analytics") {
    return sendJson(response, 200, await syncDashboardSources());
  }
  if (request.method === "POST" && path === "/api/sync/warehouse") {
    return sendJson(response, 200, await syncSource("warehouse"));
  }
  if (request.method === "POST" && path === "/api/sync/feishu") {
    return sendJson(response, 200, await syncSource("feishu"));
  }
  if (request.method === "POST" && path === "/api/sync/dingtalk") {
    return sendJson(response, 200, await syncSource("dingtalk"));
  }
  if (path === "/api/ark/call") {
    return handleArkCall(request, response);
  }
  if (request.method === "GET" && path === "/api/workflows") {
    return sendJson(response, 200, { workflow: await getWorkflowStatus() });
  }
  if (request.method === "POST" && path === "/api/workflows/douyin-ecom-copy/run") {
    const body = await readJson(request);
    const now = new Date().toISOString();
    let taskId;
    try {
      taskId = normalizeTaskId(body.id || localTaskId("workflow"));
    } catch (error) {
      return sendJson(response, 400, { error: errorMessage(error) });
    }
    const task = {
      id: taskId,
      name: body.name || "抖音电商文案与分镜工作流",
      type: body.type || "content_generate",
      module: "内容生产",
      batch: body.batch || `WEB-${Date.now()}`,
      progress: 0,
      successCount: 0,
      failedCount: 0,
      waitingConfirmCount: Number(body.waitingConfirmCount || 0),
      status: "waiting",
      startedAt: now,
      updatedAt: now,
      logEntry: `logs/workflow/${body.batch || "web"}.log`,
      timeline: ["网页提交本地工作流", "已写入 Claude Code 执行入口", "等待本地 worker"],
      inputFiles: Array.isArray(body.inputFiles) ? body.inputFiles : [],
      outputFiles: [],
      failureReason: "-",
    };
    const allowedTypes = new Set(["content_generate", "script_generate", "quality_check", "export_package"]);
    if (!allowedTypes.has(task.type)) return sendJson(response, 400, { error: "该端口只接受文案、分镜、质检或导出任务" });
    const stored = upsertTask(task);
    const workflow = await queueWorkflowEnvelope(stored);
    return sendJson(response, 202, { task: stored, workflow, executionMode: "local_queue" });
  }
  if (request.method === "GET" && path === "/api/tasks") {
    return sendJson(response, 200, { tasks: listTasks() });
  }
  if (request.method === "POST" && path === "/api/tasks") {
    const task = await readJson(request);
    if (!task.id || !task.type) return sendJson(response, 400, { error: "任务缺少 id 或 type" });
    let taskId;
    try {
      taskId = normalizeTaskId(task.id);
    } catch (error) {
      return sendJson(response, 400, { error: errorMessage(error) });
    }
    try {
      requireTaskPermission(currentUser, task);
    } catch (error) {
      return error instanceof AuthError
        ? sendAuthError(response, error)
        : sendJson(response, 400, { error: errorMessage(error) });
    }
    const stored = upsertTask({ ...task, id: taskId });
    const workflow = await queueWorkflowEnvelope(stored);
    return sendJson(response, 201, { task: stored, workflow });
  }
  const taskActionMatch = path.match(/^\/api\/tasks\/([^/]+)\/actions$/);
  if (request.method === "POST" && taskActionMatch) {
    const body = await readJson(request);
    let taskId;
    try {
      taskId = normalizeTaskId(decodeURIComponent(taskActionMatch[1]));
    } catch (error) {
      return sendJson(response, 400, { error: errorMessage(error) });
    }
    const existing = getTask(taskId);
    if (!existing) return sendJson(response, 404, { error: "任务不存在" });
    try {
      requireTaskPermission(currentUser, existing);
    } catch (error) {
      return error instanceof AuthError
        ? sendAuthError(response, error)
        : sendJson(response, 400, { error: errorMessage(error) });
    }
    const task = updateTaskAction(taskId, body.action);
    return sendJson(response, 200, { task });
  }
  if (request.method === "GET" && path === "/api/history") {
    return sendJson(response, 200, { syncRuns: listSyncRuns(), uploads: listUploads(), tasks: listTasks(30) });
  }
  if (request.method === "GET" && path === "/api/intelligence/periods") {
    return sendJson(response, 200, { periods: listIntelligencePeriods() });
  }
  // 竞品价格趋势：聚合 price-snapshots/<period>.json 中同一商品的多期快照。
  // 快照文件由抓取流程按周期落盘（scripts/export-price-snapshots.mjs 负责首期导出）。
  if (request.method === "GET" && path === "/api/intelligence/price-trend") {
    const id = String(url.searchParams.get("id") || "").trim();
    if (!id) return sendJson(response, 400, { error: "缺少 id 参数" });
    const snapshotsDir = join(intelligenceDir, "price-snapshots");
    let files = [];
    try {
      files = readdirSync(snapshotsDir).filter((f) => f.endsWith(".json")).sort();
    } catch {
      files = [];
    }
    const parsePriceNum = (text) => {
      const m = String(text ?? "").replace(/,/g, "").match(/[\d.]+/);
      return m ? parseFloat(m[0]) : null;
    };
    const points = [];
    let productName = null;
    for (const f of files) {
      try {
        const snap = JSON.parse(readFileSync(join(snapshotsDir, f), "utf8"));
        const period = snap.period || f.replace(/\.json$/, "");
        const item = (Array.isArray(snap.items) ? snap.items : []).find((it) => it && it.id === id);
        if (!item) continue;
        if (!productName) productName = item.productName || null;
        // 优先返回当期留档图（/competitor-images/ 子路径），否则回退快照里的 alicdn 白名单链接
        let imageUrl = null;
        if (typeof item.imageFile === "string" && /^[A-Za-z0-9/_-]+$/.test(item.imageFile)) {
          imageUrl = `/competitor-images/${item.imageFile}`;
        } else if (typeof item.mainImage === "string" && item.mainImage.startsWith("http")) {
          imageUrl = item.mainImage;
        }
        points.push({
          period,
          price: parsePriceNum(item.couponPrice),
          rawPrice: item.couponPrice ?? null,
          originalPrice: parsePriceNum(item.originalPrice),
          low30d: parsePriceNum(item.low30d),
          imageUrl,
        });
      } catch {
        // 单个坏快照跳过，不影响整体趋势
      }
    }
    return sendJson(response, 200, { id, productName, points, snapshots: files.length });
  }
  if (request.method === "GET" && path === "/api/intelligence/top100") {
    return serveIntelligenceJson(response, "top100.json", url.searchParams.get("period"));
  }
  if (request.method === "GET" && path === "/api/intelligence/brand-ranking") {
    return serveIntelligenceJson(response, "brand-ranking.json", url.searchParams.get("period"));
  }
  if (request.method === "GET" && path === "/api/intelligence/insights") {
    return serveIntelligenceJson(response, "insights.json", url.searchParams.get("period"));
  }
  if (request.method === "GET" && path === "/api/intelligence/analyze-status") {
    return sendJson(response, 200, {
      state: getPipelineState(),
      hasSourceXlsx: hasSourceXlsx(),
      hasVisionKey: hasVisionKey(),
      sourceInfo: sourceXlsxInfo(),
      visionProviders: visionProviderInfo(),
    });
  }
  // 解析失败清单（含 LLM 原始返回片段），诊断哪些图片的输出无法解析为结构化字段
  if (request.method === "GET" && path === "/api/intelligence/parse-failures") {
    const safePeriod = String(url.searchParams.get("period") || "").replace(/[^0-9A-Za-z~_|-]/g, "");
    if (!safePeriod) return sendJson(response, 400, { error: "缺少 period 参数" });
    const fp = join(intelligenceDir, "analysis-cache", safePeriod, "pipeline-parse-failures.json");
    if (!existsSync(fp)) return sendJson(response, 200, { period: safePeriod, failures: [] });
    try {
      return sendJson(response, 200, { period: safePeriod, failures: JSON.parse(readFileSync(fp, "utf8")) });
    } catch (error) {
      return sendJson(response, 500, { error: errorMessage(error) });
    }
  }
  // 竞品原始表上传：接收 application/octet-stream 原始二进制，
  // 立即校验格式（缺列会明确报出缺哪列），通过后按周期存到 sources/<period>.xlsx
  if (request.method === "POST" && path === "/api/intelligence/upload-source") {
    const MAX_SOURCE_BYTES = 60 * 1024 * 1024;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_SOURCE_BYTES) throw new Error("源表超过 60 MB 限制");
        chunks.push(chunk);
      }
      if (!size) return sendJson(response, 400, { error: "文件内容为空" });
      const buffer = Buffer.concat(chunks);
      // xlsx = zip，校验 PK 头防止误传别的格式
      if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
        return sendJson(response, 400, { error: "不是有效的 xlsx 文件（缺少 PK 头）" });
      }
      const result = await saveSourceFile(buffer);
      if (!result.ok) {
        // 格式校验失败：明确告诉前端缺哪列
        return sendJson(response, 422, {
          error: `文件格式不符合要求：${result.error}`,
          missing: result.missing || [],
          headers: result.headers || [],
        });
      }
      return sendJson(response, 201, {
        ok: true,
        period: result.period,
        slug: result.slug,
        rowCount: result.rowCount,
      });
    } catch (error) {
      return sendJson(response, 400, { error: errorMessage(error) });
    }
  }
  // 取消正在进行的分析（已完成部分保留，可断点续跑）
  if (request.method === "POST" && path === "/api/intelligence/analyze-cancel") {
    const ok = requestCancel();
    return sendJson(response, ok ? 202 : 409, {
      cancelled: ok,
      message: ok ? "已请求取消，当前图片处理完后停止" : "当前没有正在运行的分析任务",
    });
  }
  // 同源只读报告产物：HTML 预览内联，PDF/Markdown 作为附件下载。
  if (request.method === "GET" && path.startsWith("/api/intelligence/reports/")) {
    const artifact = path.slice("/api/intelligence/reports/".length);
    const match = artifact.match(/^([0-9A-Za-z_~-]+)(?:\.(html|pdf|md))?$/);
    if (!match) return sendJson(response, 400, { error: "报告地址不合法" });
    const format = match[2] || "html";
    const filePath = reportArtifactPath(match[1], format);
    if (!existsSync(filePath)) return sendJson(response, 404, { error: "报告产物不存在或尚未生成" });
    const contentTypes = {
      html: "text/html; charset=utf-8",
      pdf: "application/pdf",
      md: "text/markdown; charset=utf-8",
    };
    const headers = {
      "Content-Type": contentTypes[format],
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
      "X-Frame-Options": "SAMEORIGIN",
    };
    if (format !== "html") {
      const fileName = `竞品情报_TOP100_${match[1]}.${format}`;
      headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
    }
    response.writeHead(200, headers);
    createReadStream(filePath).pipe(response);
    return;
  }
  // 生成分析报告：完整 TOP100 + 同周期价格快照，输出 HTML/PDF/Markdown 元数据。
  if (request.method === "POST" && path === "/api/intelligence/report") {
    try {
      const body = await readJson(request).catch(() => ({}));
      const report = await generateIntelligenceReport({ period: body?.period, priceSnapshot: body?.priceSnapshot });
      return sendJson(response, 200, report);
    } catch (error) {
      return sendJson(response, 400, { error: errorMessage(error) });
    }
  }
  if (request.method === "POST" && path === "/api/intelligence/analyze-source") {
    try {
      const body = await readJson(request).catch(() => ({}));
      const useMock = body?.mock === true;
      await startAnalysisPipeline({ mock: useMock, force: body?.force === true, period: body?.period });
      return sendJson(response, 202, {
        state: getPipelineState(),
        message: "分析任务已启动",
      });
    } catch (error) {
      return sendJson(response, 400, { error: errorMessage(error) });
    }
  }
  // 小红书舆情分析（服务端统一引擎：抓取 / 分析 / 历史报告）
  if (request.method === "GET" && path === "/api/sentiment/crawled") {
    return sendJson(response, 200, { notes: listCrawledNotes() });
  }
  if (request.method === "POST" && path === "/api/sentiment/related-keywords") {
    try {
      const body = await readJson(request);
      const keyword = typeof body?.keyword === "string" ? body.keyword.trim() : "";
      if (!keyword) return sendJson(response, 400, { error: "关键词不能为空" });
      const items = await fetchRelatedKeywords(keyword);
      return sendJson(response, 200, { items });
    } catch (error) {
      return sendJson(response, 500, { error: errorMessage(error) });
    }
  }
  if (request.method === "POST" && path === "/api/sentiment/crawl") {
    try {
      const body = await readJson(request);
      const keywords = Array.isArray(body?.keywords) ? body.keywords : body?.keyword ? [body.keyword] : [];
      const result = startCrawl(keywords);
      return sendJson(response, 202, result);
    } catch (error) {
      return sendJson(response, 409, { error: errorMessage(error) });
    }
  }
  if (request.method === "GET" && path === "/api/sentiment/crawl/status") {
    return sendJson(response, 200, getCrawlStatus());
  }
  if (request.method === "GET" && path === "/api/sentiment/status") {
    return sendJson(response, 200, getAnalysisStatus());
  }
  if (request.method === "POST" && path === "/api/sentiment/analyze") {
    try {
      const body = await readJson(request);
      const started = startAnalysis({
        keyword: typeof body?.keyword === "string" ? body.keyword : "",
        dateFrom: typeof body?.dateFrom === "string" ? body.dateFrom : "",
        dateTo: typeof body?.dateTo === "string" ? body.dateTo : "",
      });
      return sendJson(response, 202, started);
    } catch (error) {
      return sendJson(response, 409, { error: errorMessage(error) });
    }
  }
  if (request.method === "GET" && path === "/api/sentiment/analyses") {
    return sendJson(response, 200, { items: listAnalyses() });
  }
  if (request.method === "GET" && path.startsWith("/api/sentiment/analyses/")) {
    const id = decodeURIComponent(path.slice("/api/sentiment/analyses/".length));
    const report = getAnalysis(id);
    if (!report) return sendJson(response, 404, { error: "分析报告不存在" });
    return sendJson(response, 200, report);
  }
  if (request.method === "POST" && path === "/api/uploads") {
    const body = await readJson(request);
    const fileName = safeFileName(body.fileName);
    const extension = extname(fileName).toLowerCase();
    if (![".csv", ".xlsx", ".json"].includes(extension)) {
      return sendJson(response, 400, { error: "仅支持 CSV、XLSX、JSON" });
    }
    const buffer = Buffer.from(String(body.contentBase64 ?? ""), "base64");
    if (!buffer.length) return sendJson(response, 400, { error: "文件内容为空" });
    const storageName = `${Date.now()}-${fileName}`;
    const storagePath = join(uploadDir, storageName);
    await mkdir(uploadDir, { recursive: true });
    await writeFile(storagePath, buffer);
    const category = String(body.category || "manual_import");
    let upload = recordUpload({
      fileName,
      category,
      sizeBytes: buffer.length,
      storagePath,
    });
    if (category === "dingtalk_operations") {
      const run = beginSync("dingtalk");
      try {
        const snapshot = await parseDingTalkFile({ filePath: storagePath, fileName });
        finishSync(run.id, {
          status: "success",
          recordCount: snapshot.recordCount,
          detail: "钉钉导出文件已完成本机解析与脱敏聚合",
          snapshot,
        });
        upload = updateUploadStatus(upload.id, "parsed") ?? upload;
        return sendJson(response, 201, { upload, runId: run.id, snapshot });
      } catch (error) {
        const detail = errorMessage(error);
        finishSync(run.id, { status: "failed", detail });
        upload = updateUploadStatus(upload.id, "parse_failed") ?? upload;
        return sendJson(response, 422, { error: detail, upload });
      }
    }
    return sendJson(response, 201, { upload });
  }
  return sendJson(response, 404, { error: "API 路径不存在" });
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const intelligenceDir = join(dataDir, "intelligence");
const intelligenceImagesDir = join(intelligenceDir, "images");

function serveCompetitorImage(response, fileName) {
  // 支持周期子路径：<slug>/<filename>（周期隔离的图片目录 images/<slug>/）
  const decoded = String(fileName);
  const parts = decoded.split("/").filter(Boolean).map((p) => safeFileName(p));
  const filePath = normalize(join(intelligenceImagesDir, ...parts));
  if (!filePath.startsWith(intelligenceImagesDir) || !existsSync(filePath)) {
    return sendJson(response, 404, { error: "图片不存在" });
  }
  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": "public, max-age=86400",
  });
  createReadStream(filePath).pipe(response);
}

function serveIntelligenceJson(response, name, period) {
  // 周期快照：?period=2026-08-25 读 top100-<period>.json；不带 period 读最新
  let filePath = join(intelligenceDir, name);
  if (period) {
    const safePeriod = String(period).replace(/[^0-9A-Za-z~_|-]/g, "");
    const snapshotPath = join(intelligenceDir, name.replace(/\.json$/, `-${safePeriod}.json`));
    if (existsSync(snapshotPath)) {
      filePath = snapshotPath;
    } else {
      return sendJson(response, 404, { error: `周期 ${safePeriod} 的 ${name} 不存在`, availablePeriods: listIntelligencePeriods() });
    }
  }
  if (!existsSync(filePath)) {
    return sendJson(response, 404, { error: `${name} 尚未生成，请先运行 node scripts/build-intelligence-dataset.mjs` });
  }
  try {
    const payload = JSON.parse(readFileSync(filePath, "utf8"));
    return sendJson(response, 200, payload);
  } catch (error) {
    return sendJson(response, 500, { error: errorMessage(error) });
  }
}

// 扫描 intelligence 目录里的周期快照文件（top100-<period>.json），返回可用周期列表
function listIntelligencePeriods() {
  try {
    const files = readdirSync(intelligenceDir);
    const periods = new Set();
    for (const f of files) {
      const m = f.match(/^top100-(.+)\.json$/);
      if (m) periods.add(m[1]);
    }
    return [...periods].sort().reverse();
  } catch {
    return [];
  }
}

function serveProduction(response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const normalizedPath = normalize(join(distDir, requested));
  const filePath = normalizedPath.startsWith(distDir) && existsSync(normalizedPath) ? normalizedPath : join(distDir, "index.html");
  response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream" });
  createReadStream(filePath).pipe(response);
}

const vite = production ? null : await createViteServer({
  server: {
    middlewareMode: true,
    allowedHosts: true,
    watch: { ignored: ["**/local-data/**", "**/migration/**"] },
  },
  appType: "spa",
});

const server = createServer(async (request, response) => {
  try {
    applySecurityHeaders(response, request);
    const url = new URL(request.url ?? "/", `http://${request.headers.host || `${host}:${preferredPort}`}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/competitor-images/")) {
      const currentUser = await requestUser(request);
      if (!currentUser) return sendAuthError(response, new AuthError(401, "authentication_required", "请先登录后再访问"));
      try {
        requireApiPermission(currentUser, "GET", "/api/intelligence/images");
      } catch (error) {
        return sendAuthError(response, error);
      }
      const fileName = decodeURIComponent(url.pathname.slice("/competitor-images/".length));
      return serveCompetitorImage(response, fileName);
    }
    if (vite) {
      vite.middlewares(request, response, (error) => {
        if (error) sendJson(response, 500, { error: errorMessage(error) });
      });
      return;
    }
    serveProduction(response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { error: errorMessage(error) });
  }
});

async function listen(port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

let activePort = preferredPort;
while (true) {
  try {
    await listen(activePort);
    break;
  } catch (error) {
    if (error?.code !== "EADDRINUSE" || activePort >= preferredPort + 10) throw error;
    activePort += 1;
  }
}

console.log(`Ecom AI Studio local service: http://${host}:${activePort}`);
console.log(`Mode: ${production ? "production" : "development"}; API and UI share one port.`);

// 启动后后台异步预热 analytics 缓存，不阻塞端口监听；首请求若未就绪则等待 single-flight
prewarmAnalyticsCache();
console.log("Analytics cache prewarm started in background.");

// restart-trigger: 1787733992
// Wed Aug 26 21:34:07     2026 touch
// touch 1787751473
