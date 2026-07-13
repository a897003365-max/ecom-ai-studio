import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { createServer as createViteServer } from "vite";
import { parseDingTalkFile } from "./dingtalk.mjs";
import { checkDingTalkApi, filterDingTalkSnapshot, syncDingTalkApi } from "./dingtalk-api.mjs";
import { checkFeishu, sheetInventory, syncFeishu } from "./feishu.mjs";
import { checkWarehouse, readWarehouseSnapshot, syncWarehouse } from "./warehouse.mjs";
import {
  beginSync,
  dataDir,
  finishSync,
  latestUpload,
  latestSnapshot,
  listSyncRuns,
  listTasks,
  listUploads,
  recordUpload,
  updateUploadStatus,
  updateTaskAction,
  upsertTask,
} from "./storage.mjs";
import { getWorkflowStatus, queueWorkflowEnvelope } from "./workflow.mjs";

const production = process.argv.includes("--production");
const host = process.env.HOST || "127.0.0.1";
const preferredPort = Number(process.env.PORT || 5173);
const distDir = join(process.cwd(), "dist");
const uploadDir = join(dataDir, "uploads");
mkdirSync(uploadDir, { recursive: true });

const uploadPolicy = [
  {
    id: "local-direct",
    category: "本地直连，不上传",
    tone: "green",
    items: ["DuckDB 本地数仓", "3,828 个 Parquet 增量分区", "E:/Github/.claude 工作流与 Agent", "本地脚本和素材目录"],
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

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
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

async function getDataSources() {
  const warehouse = await checkWarehouse();
  const { snapshot: warehouseSnapshot, ...warehouseStatus } = warehouse;
  const feishu = await checkFeishu();
  const dingtalk = checkDingTalkApi();
  const workflow = await getWorkflowStatus();
  const feishuSnapshot = latestSnapshot("feishu");
  const dingtalkSnapshot = latestSnapshot("dingtalk");
  const dingtalkUpload = latestUpload("dingtalk_operations");

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
        status: dingtalkSnapshot ? "connected" : dingtalk.configured ? "ready" : dingtalkUpload?.status === "parse_failed" ? "offline" : dingtalkUpload ? "ready" : "auth_required",
        statusLabel: dingtalkSnapshot ? "已只读同步" : dingtalk.configured ? "定时同步就绪" : dingtalkUpload?.status === "parse_failed" ? "解析失败" : dingtalkUpload ? "等待同步" : "等待配置/导入",
        detail: dingtalkSnapshot
          ? `${dingtalkSnapshot.snapshot.inventory?.length ?? 0} 个工作表，仅保存渠道、店铺、日期和经营指标聚合；每日 ${dingtalk.schedule.join(" / ")}`
          : dingtalk.configured
            ? `HTTP Sheet API 只读连接；每日 ${dingtalk.schedule.join(" / ")} 自动同步`
            : "也可导入 CSV/XLSX/JSON，由本机自动解析。",
        lastSync: dingtalkSnapshot?.finishedAt ?? null,
        records: dingtalkSnapshot?.recordCount ?? 0,
        location: dingtalk.configured ? "钉钉共享表 -> local-data 脱敏快照" : "钉钉本地导出",
        schedule: dingtalk.schedule,
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

async function syncSource(sourceId) {
  const run = beginSync(sourceId);
  try {
    let snapshot;
    if (sourceId === "warehouse") snapshot = await syncWarehouse();
    else if (sourceId === "feishu") snapshot = await syncFeishu();
    else if (sourceId === "dingtalk") {
      const api = checkDingTalkApi();
      if (api.configured) {
        snapshot = await syncDingTalkApi();
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
    return { runId: run.id, snapshot };
  } catch (error) {
    finishSync(run.id, { status: "failed", detail: errorMessage(error) });
    throw error;
  }
}

async function handleApi(request, response, url) {
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/health") {
    return sendJson(response, 200, { ok: true, mode: production ? "production" : "development", time: new Date().toISOString() });
  }
  if (request.method === "GET" && path === "/api/data-sources") {
    return sendJson(response, 200, await getDataSources());
  }
  if (request.method === "GET" && path === "/api/analytics") {
    const dingtalkSnapshot = latestSnapshot("dingtalk")?.snapshot ?? null;
    const dingtalk = dingtalkSnapshot
      ? filterDingTalkSnapshot(dingtalkSnapshot, {
        start: url.searchParams.get("start") || undefined,
        end: url.searchParams.get("end") || undefined,
      })
      : null;
    return sendJson(response, 200, {
      warehouse: await readWarehouseSnapshot(),
      feishu: latestSnapshot("feishu")?.snapshot ?? null,
      dingtalk,
      history: listSyncRuns(12),
    });
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
  if (request.method === "GET" && path === "/api/workflows") {
    return sendJson(response, 200, { workflow: await getWorkflowStatus() });
  }
  if (request.method === "POST" && path === "/api/workflows/douyin-ecom-copy/run") {
    const body = await readJson(request);
    const now = new Date().toISOString();
    const task = {
      id: body.id || localTaskId("workflow"),
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
    const allowedTypes = new Set(["content_generate", "script_generate", "quality_check"]);
    if (!allowedTypes.has(task.type)) return sendJson(response, 400, { error: "该端口只接受文案、分镜或质检任务" });
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
    const stored = upsertTask(task);
    const workflow = await queueWorkflowEnvelope(stored);
    return sendJson(response, 201, { task: stored, workflow });
  }
  const taskActionMatch = path.match(/^\/api\/tasks\/([^/]+)\/actions$/);
  if (request.method === "POST" && taskActionMatch) {
    const body = await readJson(request);
    const task = updateTaskAction(decodeURIComponent(taskActionMatch[1]), body.action);
    return task ? sendJson(response, 200, { task }) : sendJson(response, 404, { error: "任务不存在" });
  }
  if (request.method === "GET" && path === "/api/history") {
    return sendJson(response, 200, { syncRuns: listSyncRuns(), uploads: listUploads(), tasks: listTasks(30) });
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
};

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
    watch: { ignored: ["**/local-data/**", "**/migration/**"] },
  },
  appType: "spa",
});

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host || `${host}:${preferredPort}`}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
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
