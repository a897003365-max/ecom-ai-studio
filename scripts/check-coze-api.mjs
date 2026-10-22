// 每日 Coze API 连通性检查（计划任务专用）：
//  探针 = 真实「关键词搜索工作流」：用 source-config 的 genericWorkflowId + 一个话题词，POST /v1/workflow/stream_run。
//    这不只是网络连通性，还能验证：端点可达 + token 有效 + 搜索工作流本体可运行 + Coze 侧小红书 cookie 未失效。
//  触发告警的失败：网络不可达 / 鉴权失败 / 上游 5xx / 工作流返回 cookie 失效或 false / 返回结构异常。
//  连通时静默，仅写日志。注意：本探针会真实运行一次关键词搜索（消耗 Coze 配额 + 发起一次小红书搜索）。
//  配置来源（.env → local-data/source-config.json）：
//    Coze token        ：COZE_TOKEN，缺省 source-config.json 的 coze.token
//    搜索工作流 id     ：COZE_GENERIC_WORKFLOW_ID，缺省 source-config.json 的 coze.genericWorkflowId
//    探针输入话题词     ：COZE_HEALTH_PROBE_KEYWORD，缺省「麻大师」
//    飞书 webhook      ：URL = FEISHU_COZE_WEBHOOK_URL（缺省回退 FEISHU_JUSHUITAN_WEBHOOK_URL）
//    （可选）签名       ：SECRET = FEISHU_COZE_WEBHOOK_SECRET（缺省回退 FEISHU_JUSHUITAN_WEBHOOK_SECRET）；
//                         仅当机器人开启「加签」时才填，无签名（自定义关键词/IP白名单）模式只填 URL。
//  --test 参数：跳过探针，直接向飞书发一条测试告警并打印返回码（用于验证 webhook 已接通）。
import { request } from "node:https";
import { createHmac } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// 若 .env 存在则加载（允许把 COZE_TOKEN / FEISHU_COZE_* 放 .env）
if (process.loadEnvFile) {
  try {
    process.loadEnvFile(join(process.cwd(), ".env"));
  } catch {
    // .env 不存在，忽略
  }
}

const COZE_ENDPOINT = "https://api.coze.cn/v1/workflow/stream_run";
const PROBE_KEYWORD = process.env.COZE_HEALTH_PROBE_KEYWORD?.trim() || "麻大师";
const PROBE_TIMEOUT_MS = 120_000;
const LOG_FILE = join(process.cwd(), "logs", "coze-api-health.log");

function now() {
  return new Date();
}

function formatTime(d) {
  return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 8)}`;
}

function log(msg) {
  const line = `${formatTime(now())} ${msg}`;
  console.log(line);
  try {
    mkdirSync(join(process.cwd(), "logs"), { recursive: true });
    appendFileSync(LOG_FILE, line + "\n", "utf8");
  } catch {
    // 日志不可写不阻断检查
  }
}

function readJsonConfig() {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "local-data", "source-config.json"), "utf8"));
  } catch {
    return {};
  }
}

function cozeToken() {
  return (process.env.COZE_TOKEN?.trim() || readJsonConfig()?.coze?.token?.trim() || "").trim();
}

function searchWorkflowId() {
  return (process.env.COZE_GENERIC_WORKFLOW_ID?.trim() || readJsonConfig()?.coze?.genericWorkflowId?.trim() || "").trim();
}

// 与 sentiment.mjs 同判：# 工作流 cookie 失效的统一信号：msg 字段以 "false" 开头或 cookie_status === false
function isFalseMsg(s) {
  return typeof s === "string" && s.trim().startsWith("false");
}

// 真实搜索工作流调用：POST stream_run { workflow_id, parameters:{ input: 话题词 } }，解析 SSE 文本。
// 返回 { status, output }；网络/非 2xx 以 status 反映，SSE 文本在 output。
function runKeywordSearch(token, workflowId) {
  return new Promise((resolve) => {
    const target = new URL(COZE_ENDPOINT);
    const payload = JSON.stringify({ workflow_id: workflowId, parameters: { input: PROBE_KEYWORD } });
    const req = request(
      {
        hostname: target.hostname,
        path: target.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Authorization: `Bearer ${token}`,
        },
        timeout: PROBE_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          let body = "";
          try {
            body = Buffer.concat(chunks).toString("utf8");
          } catch {
            body = "";
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
        res.on("error", (e) => resolve({ status: 0, body: e instanceof Error ? e.message : String(e) }));
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (e) => resolve({ status: 0, body: e instanceof Error ? e.message : String(e) }));
    req.write(payload);
    req.end();
  });
}

// 复用 workflow-proxy 的 SSE 提取思路：取终态 data 串或拼 content 增量
function extractStreamText(rawBody) {
  const dataLines = rawBody
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  let assembled = "";
  let finalData = null;
  for (const line of dataLines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed === "string") {
      assembled += parsed;
      continue;
    }
    if (typeof parsed.content === "string") assembled += parsed.content;
    if (typeof parsed.message === "string" && !parsed.content) assembled += parsed.message;
    if (typeof parsed.data === "string") finalData = parsed.data;
    else if (parsed.data && typeof parsed.data.data === "string") finalData = parsed.data.data;
    else if (parsed.data && typeof parsed.data.output === "string") finalData = parsed.data.output;
  }
  const text = (finalData && finalData.trim()) || assembled.trim();
  return text || null;
}

// 探测并判定：
//   无响应/超时                → 网络不可达（告警）
//   401/403                    → 鉴权失败（告警）
//   >=500                      → 上游异常（告警）
//   200 但 cookie/false/结构异常 → 工作流异常：Coze 侧 cookie 失效或返回 false（告警）
//   200 且解析到 note.notes    → 连通 + 工作流正常（静默），返回笔记数作为健康度
function classify(res) {
  if (!res || res.status === 0) {
    return { ok: false, type: "网络不可达", detail: String(res?.body ?? "无响应（DNS/连接/超时）") };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, type: "鉴权失败", detail: `HTTP ${res.status}：Coze Token 无效或已过期` };
  }
  if (res.status >= 500) {
    return { ok: false, type: "上游异常", detail: `HTTP ${res.status}：${res.body.slice(0, 160)}` };
  }
  if (res.status !== 200) {
    return { ok: false, type: "异常响应", detail: `HTTP ${res.status}：${res.body.slice(0, 160)}` };
  }

  // HTTP 200：进一步看工作流到底返回了什么
  const output = extractStreamText(res.body);
  if (!output) {
    return { ok: false, type: "工作流异常", detail: "搜索工作流未返回任何可解析结果" };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(output);
  } catch {
    parsed = null;
  }
  if (parsed && (isFalseMsg(parsed?.a_msg) || isFalseMsg(parsed?.msg) || parsed?.note?.cookie_status === false)) {
    return { ok: false, type: "工作流异常", detail: "搜索工作流返回 false：Coze 侧小红书 cookie 失效或需重新授权" };
  }
  const notes = Array.isArray(parsed?.note?.notes) ? parsed.note.notes : [];
  if (!Array.isArray(parsed?.note?.notes)) {
    return { ok: false, type: "工作流异常", detail: `搜索工作流返回结构异常：${output.slice(0, 160)}` };
  }
  return { ok: true, type: "连通", detail: `HTTP 200 · 话题「${PROBE_KEYWORD}」返回 ${notes.length} 条笔记` };
}

// 飞书自定义机器人：无签名（自定义关键词/IP 白名单）发明文；填了 SECRET 则走 HMAC-SHA256 加签。
async function sendFeishu(text) {
  const url = process.env.FEISHU_COZE_WEBHOOK_URL?.trim() || process.env.FEISHU_JUSHUITAN_WEBHOOK_URL?.trim();
  const secret = process.env.FEISHU_COZE_WEBHOOK_SECRET?.trim() || process.env.FEISHU_JUSHUITAN_WEBHOOK_SECRET?.trim();
  if (!url) {
    log("飞书 webhook 未配置（FEISHU_COZE_WEBHOOK_URL 或 FEISHU_JUSHUITAN_WEBHOOK_URL），本次不发送告警");
    return false;
  }
  const body = { msg_type: "text", content: { text } };
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    body.timestamp = timestamp;
    body.sign = createHmac("sha256", `${timestamp}\n${secret}`).digest("base64");
  }
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    const ok = result?.StatusCode === 0 || result?.code === 0;
    log(`飞书告警 ${ok ? "发送成功" : `发送失败 code=${result?.code ?? "?"} ${result?.msg ?? ""}`}`);
    return ok;
  } catch (error) {
    log(`飞书告警发送异常：${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function main() {
  const isTest = process.argv.includes("--test");
  if (isTest) {
    log("测试模式：直接发送验证告警到飞书 webhook（不探测 Coze）");
    const ok = await sendFeishu(`[Coze API 连通性检查 · 测试] ${formatTime(now())}\n这是一条验证飞书 webhook 已接通的测试告警，收到即代表配置生效。`);
    process.exitCode = ok ? 0 : 1;
    return;
  }

  const token = cozeToken();
  const workflowId = searchWorkflowId();
  if (!token) {
    log("检查失败：未配置 Coze token（source-config.json 的 coze.token 或 COZE_TOKEN），视为不连通");
    await sendFeishu(`[Coze API 连通性检查 · FAIL]\n时间：${formatTime(now())}\n类型：未配置\n详情：服务端无 Coze Token，小红书舆情抓取不可用，请尽快配置后重跑本检查。`);
    process.exitCode = 1;
    return;
  }
  if (!workflowId) {
    log("检查失败：未配置关键词搜索工作流 id（source-config.json 的 coze.genericWorkflowId 或 COZE_GENERIC_WORKFLOW_ID）");
    await sendFeishu(`[Coze API 连通性检查 · FAIL]\n时间：${formatTime(now())}\n类型：未配置\n详情：缺少关键词搜索工作流 id，小红书舆情抓取不可用。`);
    process.exitCode = 1;
    return;
  }

  log(`开始探测：话题「${PROBE_KEYWORD}」→ 搜索工作流 ${workflowId.slice(0, 8)}…`);
  const res = await runKeywordSearch(token, workflowId);
  const verdict = classify(res);
  if (verdict.ok) {
    log(`检查通过：${verdict.type}（${verdict.detail}）`);
    return;
  }

  log(`检查失败：${verdict.type}（${verdict.detail}）`);
  await sendFeishu(`[Coze API 连通性检查 · FAIL]\n时间：${formatTime(now())}\n类型：${verdict.type}\n详情：${verdict.detail}\n影响：小红书舆情抓取（关键词搜索）不可用，请及时排查。`);
  process.exitCode = 1;
}

await main();