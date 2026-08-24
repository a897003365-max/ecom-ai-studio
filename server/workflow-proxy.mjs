// Coze 工作流通用代理：读取 source-config.json 中的 token 和 workflow_id，
// 接收前端输入文本，调用 Coze stream_run API，解析 SSE 返回文本结果。
// 复用 sentiment.mjs 的 httpsPostStream + extractStreamText 模式。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import https from "node:https";

const COZE_TIMEOUT_MS = 120_000;

function readLocalSourceConfig() {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "local-data", "source-config.json"), "utf8"));
  } catch {
    return {};
  }
}

function cozeConfig() {
  const sourceConfig = readLocalSourceConfig();
  return {
    token: process.env.COZE_TOKEN?.trim() || sourceConfig.coze?.token,
    workflowId: process.env.COZE_GENERIC_WORKFLOW_ID?.trim() || sourceConfig.coze?.genericWorkflowId,
  };
}

function httpsPostStream(url, body, headers) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: target.hostname,
        path: target.pathname + target.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers,
        },
        timeout: COZE_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Coze 请求超时")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// Coze stream_run 返回 SSE（event:/data: 行）；宽容解析：
// 优先取终态 data 字符串，否则拼接所有 content 增量。
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
  if (!text) return null;
  return text;
}

/**
 * 调用 Coze workflow stream_run，返回 { output, raw } 或抛出错误。
 * @param {string} input - 用户输入文本
 * @returns {Promise<{ output: string, raw: string }>}
 */
export async function runWorkflow(input) {
  const { token, workflowId } = cozeConfig();
  if (!token || !workflowId) {
    throw new Error("未配置 Coze token / workflow id（local-data/source-config.json 的 coze 节点）");
  }
  if (!input || !input.trim()) {
    throw new Error("输入文本不能为空");
  }
  const res = await httpsPostStream(
    "https://api.coze.cn/v1/workflow/stream_run",
    { workflow_id: workflowId, parameters: { input } },
    { Authorization: `Bearer ${token}` },
  );
  if (res.status === 401 || res.status === 403) throw new Error("Coze 鉴权失败，请检查 token");
  if (res.status === 4100 || res.body.includes('"code":4100')) throw new Error("Coze 鉴权失败（code 4100），token 无效或已过期");
  if (res.status !== 200) throw new Error(`Coze 上游返回 ${res.status}：${res.body.slice(0, 200)}`);
  const text = extractStreamText(res.body);
  if (!text) throw new Error("Coze 返回为空，无法解析结果");
  return { output: text, raw: res.body };
}

function cozeNoteDetailConfig() {
  const sourceConfig = readLocalSourceConfig();
  return {
    token: process.env.COZE_TOKEN?.trim() || sourceConfig.coze?.token,
    workflowId: process.env.COZE_NOTE_DETAIL_WORKFLOW_ID?.trim() || sourceConfig.coze?.noteDetailWorkflowId,
  };
}

function cozeKeywordTopicsConfig() {
  const sourceConfig = readLocalSourceConfig();
  return {
    token: process.env.COZE_TOKEN?.trim() || sourceConfig.coze?.token,
    workflowId: process.env.COZE_KEYWORD_TOPICS_WORKFLOW_ID?.trim() || sourceConfig.coze?.keywordTopicsWorkflowId,
  };
}

/**
 * 调用相关关键词工作流，返回 [{ name, viewNum }]。
 * 上游返回体：{ msg, note: { topic_list: [{ name, view_num, ... }] } }
 * @param {string} keyword - 用户输入的种子关键词
 * @returns {Promise<Array<{ name: string, viewNum: number }>>}
 */
export async function fetchRelatedKeywords(keyword) {
  const { token, workflowId } = cozeKeywordTopicsConfig();
  if (!token || !workflowId) {
    throw new Error("未配置 Coze token / keywordTopicsWorkflowId");
  }
  if (!keyword || !keyword.trim()) {
    throw new Error("关键词不能为空");
  }
  const res = await httpsPostStream(
    "https://api.coze.cn/v1/workflow/stream_run",
    { workflow_id: workflowId, parameters: { input: keyword.trim() } },
    { Authorization: `Bearer ${token}` },
  );
  if (res.status === 401 || res.status === 403) throw new Error("Coze 鉴权失败");
  if (res.status !== 200) throw new Error(`Coze 上游返回 ${res.status}：${res.body.slice(0, 200)}`);
  const text = extractStreamText(res.body);
  if (!text) throw new Error("Coze 返回为空，无法解析相关关键词");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const topics = parsed?.note?.topic_list;
  if (!Array.isArray(topics)) return [];
  const seen = new Set();
  const items = [];
  for (const topic of topics) {
    const name = typeof topic?.name === "string" ? topic.name.trim() : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const viewNum = Number(String(topic.view_num ?? "").replace(/[^\d]/g, ""));
    items.push({ name, viewNum: Number.isFinite(viewNum) && viewNum > 0 ? viewNum : 0 });
    if (items.length >= 20) break;
  }
  return items;
}

// 详情工作流（coze.noteDetailWorkflowId）返回结构：
// { a_msg, author: { author_info: { red_id, nick_name, fans, follows, desc, ... } },
//   n_msg, note: { cookie_status, note: { note_display_title, note_desc, note_create_time, note_tags, note_ip_location, ... } } }
function parseNoteDetail(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    const note = parsed?.note?.note ?? parsed?.note ?? parsed;
    const authorInfo = parsed?.author?.author_info ?? null;
    return { note, authorInfo };
  } catch {
    return { note: null, authorInfo: null };
  }
}

function formatNoteBody(rawText) {
  const { note, authorInfo } = parseNoteDetail(rawText);
  if (!note) return rawText;
  const lines = [];
  if (note.note_display_title) lines.push(`标题：${note.note_display_title}`);
  const author = authorInfo?.nick_name || note.author_nick_name;
  if (author) lines.push(`作者：${author}`);
  if (authorInfo?.red_id) lines.push(`小红书号：${authorInfo.red_id}`);
  if (authorInfo?.fans) lines.push(`粉丝：${authorInfo.fans}`);
  if (note.note_create_time) lines.push(`发布时间：${note.note_create_time}`);
  const ip = note.note_ip_location || authorInfo?.author_ip_location;
  if (ip) lines.push(`IP 属地：${ip}`);
  if (note.note_desc) lines.push(`正文：${note.note_desc}`);
  if (Array.isArray(note.note_tags) && note.note_tags.length) lines.push(`标签：${note.note_tags.join("、")}`);
  const body = lines.join("\n").trim();
  return body || rawText;
}

function extractPublishTime(rawText) {
  const { note } = parseNoteDetail(rawText);
  return typeof note?.note_create_time === "string" && note.note_create_time ? note.note_create_time : null;
}

function extractRedId(rawText) {
  const { authorInfo } = parseNoteDetail(rawText);
  return typeof authorInfo?.red_id === "string" && authorInfo.red_id ? authorInfo.red_id : null;
}

function extractFans(rawText) {
  const { authorInfo } = parseNoteDetail(rawText);
  if (!authorInfo) return null;
  const fans = Number(String(authorInfo.fans ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(fans) && fans > 0 ? fans : null;
}

// 失败响应识别：工作流 cookie 失效或笔记不可用时返回 a_msg/n_msg = "false..."、
// cookie_status:false、author_info 全空 —— 绝不能当正文入库
function isDetailErrorResponse(parsed) {
  const isFalseMsg = (s) => typeof s === "string" && s.trim().startsWith("false");
  if (isFalseMsg(parsed?.a_msg) || isFalseMsg(parsed?.msg) || isFalseMsg(parsed?.n_msg)) return true;
  if (parsed?.note?.cookie_status === false) return true;
  const inner = parsed?.note?.note;
  if (!inner) return true;
  const hasContent = inner.note_desc || inner.note_display_title || (Array.isArray(inner.note_tags) && inner.note_tags.length > 0);
  return !hasContent;
}

/**
 * 调用 Coze 笔记详情工作流，返回 { body, raw, publishTime, redId, fans }。
 * @param {string} noteUrl - 笔记 URL
 * @returns {Promise<{ body: string, raw: string, publishTime: string | null, redId: string | null, fans: number | null }>}
 */
export async function fetchNoteDetail(noteUrl) {
  const { token, workflowId } = cozeNoteDetailConfig();
  if (!token || !workflowId) {
    throw new Error("未配置 Coze token / noteDetailWorkflowId");
  }
  const res = await httpsPostStream(
    "https://api.coze.cn/v1/workflow/stream_run",
    { workflow_id: workflowId, parameters: { input: noteUrl } },
    { Authorization: `Bearer ${token}` },
  );
  if (res.status === 401 || res.status === 403) throw new Error("Coze 鉴权失败");
  if (res.status !== 200) throw new Error(`Coze 上游返回 ${res.status}：${res.body.slice(0, 200)}`);
  const text = extractStreamText(res.body);
  if (!text) throw new Error("Coze 返回为空，无法解析笔记正文");
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!parsed || isDetailErrorResponse(parsed)) {
    throw new Error("笔记详情抓取失败：工作流返回 false（cookie 失效或笔记不可用）");
  }
  const body = formatNoteBody(text);
  if (!body || body === text) throw new Error("笔记详情解析为空");
  return {
    body,
    raw: text,
    publishTime: extractPublishTime(text),
    redId: extractRedId(text),
    fans: extractFans(text),
  };
}
