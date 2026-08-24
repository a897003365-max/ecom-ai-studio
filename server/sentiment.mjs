// 小红书舆情分析（服务端唯一引擎）：
// 1. 笔记库 local-data/sentiment/crawled-notes.json 是唯一数据源（按 noteId+keyword 去重，上限 500 条）
// 2. 抓取：POST /api/sentiment/crawl {keyword} → Coze 搜索 workflow → 笔记 upsert 入库 → 后台补抓正文
// 3. 分析：POST /api/sentiment/analyze {keyword, dateFrom, dateTo} → 从笔记库按关键词+发布时间筛选 → LLM 综合
// 4. 报告留档：local-data/sentiment/analyses/{id}.json + index.json，可翻查历史
// 首次启动会把 参考文件 txt 笔记 + notes-cache.json 正文 + result.json 旧报告一次性迁入，迁移后旧文件删除。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import https from "node:https";
import { runWorkflow, fetchNoteDetail } from "./workflow-proxy.mjs";

const RESULT_DIR = join(process.cwd(), "local-data", "sentiment");
const CRAWLED_FILE = join(RESULT_DIR, "crawled-notes.json");
const ANALYSES_DIR = join(RESULT_DIR, "analyses");
const ANALYSES_INDEX_FILE = join(ANALYSES_DIR, "index.json");
// 一次性迁移源（迁移成功后删除）
const KEYWORD_FILE = join(process.cwd(), "参考文件", "麻大师床垫避雷.txt");
const NOTES_CACHE_FILE = join(RESULT_DIR, "notes-cache.json");
const RESULT_FILE = join(RESULT_DIR, "result.json");

const CRAWLED_MAX_NOTES = 2000;
const CRAWL_CONCURRENCY = 2;
const CRAWL_GAP_MS = 3000;
// max 推理强度下思维链更长，超时与输出上限同步放大，避免截断/超时
const LLM_TIMEOUT_MS = 300_000;
const NOTE_BODY_CHAR_LIMIT = 3000; // 单条笔记正文进入 LLM 的长度上限

function number(value) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractPublishTimeFromBody(body) {
  if (typeof body !== "string") return null;
  const m = body.match(/^发布时间：(.+)$/m);
  return m ? m[1].trim() : null;
}

// ---------- 笔记库 ----------

function crawledNoteKey(note) {
  return `${note.noteId}|${note.keyword ?? ""}`;
}

export function listCrawledNotes() {
  try {
    const arr = JSON.parse(readFileSync(CRAWLED_FILE, "utf8"));
    return Array.isArray(arr) ? arr.filter((n) => n && typeof n.noteId === "string" && n.noteId) : [];
  } catch {
    return [];
  }
}

function writeLibrary(notes) {
  mkdirSync(RESULT_DIR, { recursive: true });
  const capped = [...notes].sort((a, b) =>
    String(b.crawledAt ?? "").localeCompare(String(a.crawledAt ?? "")),
  ).slice(0, CRAWLED_MAX_NOTES);
  writeFileSync(CRAWLED_FILE, JSON.stringify(capped, null, 2), "utf8");
  return capped;
}

function upsertNotes(library, incoming) {
  const merged = new Map(library.map((n) => [crawledNoteKey(n), n]));
  for (const note of incoming) {
    const key = crawledNoteKey(note);
    const existing = merged.get(key);
    // 重抓同一关键词：已有正文的保留（含 redId/fans，正文 ok 的笔记不会重新进队列补抓）
    if (existing?.detailState === "ok" && existing.noteBody) {
      merged.set(key, { ...note, detailState: "ok", noteBody: existing.noteBody, bodyLength: existing.bodyLength, publishTime: existing.publishTime ?? note.publishTime ?? null, redId: existing.redId ?? null, fans: existing.fans ?? null });
    } else {
      merged.set(key, note);
    }
  }
  return [...merged.values()];
}

// ---------- 一次性迁移：txt 笔记 + 正文缓存 + 旧报告 ----------

function migrateLegacyData() {
  const library = listCrawledNotes();
  let libraryChanged = false;

  if (existsSync(KEYWORD_FILE) && !library.some((n) => n.keyword === "麻大师床垫避雷")) {
    try {
      const raw = JSON.parse(readFileSync(KEYWORD_FILE, "utf8"));
      const txtNotes = Array.isArray(raw?.note?.notes) ? raw.note.notes : [];
      let bodyCache = new Map();
      let cacheFetchedAt = null;
      try {
        const cached = JSON.parse(readFileSync(NOTES_CACHE_FILE, "utf8"));
        if (Array.isArray(cached)) {
          bodyCache = new Map(cached.filter((n) => n?.noteId && typeof n.body === "string").map((n) => [n.noteId, n]));
          cacheFetchedAt = cached.find((n) => n?.fetchedAt)?.fetchedAt ?? null;
        }
      } catch {
        // 无正文缓存则导入为待抓取
      }
      const imported = txtNotes.map((note) => {
        const entry = bodyCache.get(note.note_id);
        const body = entry?.body ?? null;
        return {
          noteId: note.note_id,
          title: note.note_display_title || "(无标题)",
          url: note.note_url || "",
          author: note.author_nick_name || "",
          liked: number(note.note_liked_count),
          comment: number(note.comment_count),
          collected: number(note.collected_count),
          shared: number(note.shared_count),
          keyword: "麻大师床垫避雷",
          crawledAt: entry?.fetchedAt ?? cacheFetchedAt ?? new Date().toISOString(),
          detailState: body ? "ok" : "pending",
          bodyLength: body ? body.length : 0,
          noteBody: body ?? undefined,
          publishTime: body ? extractPublishTimeFromBody(body) : null,
        };
      });
      if (imported.length) {
        writeLibrary(upsertNotes(library, imported));
        libraryChanged = true;
      }
      rmSync(NOTES_CACHE_FILE, { force: true });
    } catch {
      // txt 读取失败时保留原文件，下次启动重试
    }
  }

  // 旧 result.json → 首份历史报告
  if (existsSync(RESULT_FILE)) {
    try {
      const old = JSON.parse(readFileSync(RESULT_FILE, "utf8"));
      const notes = Array.isArray(old?.notes) ? old.notes : [];
      if (old?.result && notes.length) {
        const createdAt = old.finishedAt || old.startedAt || new Date().toISOString();
        const report = {
          id: createdAt.replace(/[-:TZ.]/g, "").slice(0, 14),
          keyword: old.keyword || "麻大师床垫避雷",
          createdAt,
          period: null,
          noteCount: notes.length,
          totalEngagement: notes.reduce((sum, n) => sum + number(n.liked) + number(n.comment) + number(n.collected) + number(n.shared), 0),
          noteIds: notes.map((n) => n.noteId),
          result: old.result,
        };
        saveReport(report);
      }
      rmSync(RESULT_FILE, { force: true });
    } catch {
      // 旧报告损坏时保留文件，不影响新链路
    }
  }
  return libraryChanged;
}

// ---------- 报告留档 ----------

function listReportIndex() {
  try {
    const arr = JSON.parse(readFileSync(ANALYSES_INDEX_FILE, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveReport(report) {
  mkdirSync(ANALYSES_DIR, { recursive: true });
  writeFileSync(join(ANALYSES_DIR, `${report.id}.json`), JSON.stringify(report, null, 2), "utf8");
  const index = listReportIndex().filter((item) => item.id !== report.id);
  index.push({
    id: report.id,
    keyword: report.keyword,
    createdAt: report.createdAt,
    period: report.period,
    noteCount: report.noteCount,
    riskLevel: report.result?.riskLevel ?? "medium",
    problemCount: report.result?.problemPoints?.length ?? 0,
  });
  index.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  writeFileSync(ANALYSES_INDEX_FILE, JSON.stringify(index, null, 2), "utf8");
}

export function listAnalyses() {
  return listReportIndex();
}

export function getAnalysis(id) {
  if (!/^[0-9a-zA-Z-]+$/.test(id)) return null;
  try {
    return JSON.parse(readFileSync(join(ANALYSES_DIR, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

// ---------- 抓取引擎（多关键词串行：搜索全部入库，再统一补抓正文） ----------

let crawlJob = { running: false, keywords: [], keywordIndex: 0, phase: "idle", total: 0, ok: 0, failed: 0, errors: [], startedAt: null, finishedAt: null };

export function getCrawlStatus() {
  return { ...crawlJob };
}

export function startCrawl(keywords) {
  if (crawlJob.running) throw new Error("抓取任务正在进行中，请等待完成");
  const list = [...new Set((Array.isArray(keywords) ? keywords : [keywords]).map((k) => String(k ?? "").trim()).filter(Boolean))];
  if (!list.length) throw new Error("至少提供一个关键词");
  if (list.length > 10) throw new Error("一次最多抓取 10 个关键词");
  crawlJob = { running: true, keywords: list, keywordIndex: 0, phase: "searching", total: 0, ok: 0, failed: 0, errors: [], startedAt: new Date().toISOString(), finishedAt: null };
  void runCrawlJob(list);
  return { keywords: list.length };
}

async function runCrawlJob(keywords) {
  const queue = [];
  try {
    for (let i = 0; i < keywords.length; i += 1) {
      crawlJob.keywordIndex = i + 1;
      const keyword = keywords[i];
      try {
        const { output } = await runWorkflow(keyword);
        let rawNotes = [];
        try {
          const parsed = JSON.parse(output);
          const isFalseMsg = (s) => typeof s === "string" && s.trim().startsWith("false");
          if (isFalseMsg(parsed?.a_msg) || isFalseMsg(parsed?.msg) || parsed?.note?.cookie_status === false) {
            crawlJob.errors.push(`「${keyword}」搜索失败：工作流返回 false（cookie 失效）`);
            continue;
          }
          rawNotes = Array.isArray(parsed?.note?.notes) ? parsed.note.notes : [];
        } catch {
          rawNotes = [];
        }
        const now = new Date().toISOString();
        const incoming = rawNotes.map((n) => ({
          noteId: n.note_id || "",
          title: n.note_display_title || "(无标题)",
          url: n.note_url || "",
          author: n.author_nick_name || "",
          liked: number(n.note_liked_count),
          comment: number(n.comment_count),
          collected: number(n.collected_count),
          shared: number(n.shared_count),
          keyword,
          crawledAt: now,
          detailState: "pending",
          bodyLength: 0,
          publishTime: null,
        })).filter((n) => n.noteId);
        const library = upsertNotes(listCrawledNotes(), incoming);
        writeLibrary(library);
        for (const note of library.filter((n) => n.keyword === keyword && n.detailState !== "ok" && n.url)) {
          queue.push(note);
        }
        crawlJob.total = queue.length;
      } catch (error) {
        crawlJob.errors.push(`「${keyword}」搜索失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (queue.length) {
      crawlJob.phase = "filling";
      await fillNoteBodies(queue);
    }
  } finally {
    crawlJob.running = false;
    crawlJob.phase = "idle";
    crawlJob.finishedAt = new Date().toISOString();
  }
}

async function fillNoteBodies(queue) {
  for (let bi = 0; bi < queue.length; bi += CRAWL_CONCURRENCY) {
    const batch = queue.slice(bi, bi + CRAWL_CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (note) => {
        try {
          const detail = await fetchNoteDetail(note.url);
          note.noteBody = detail.body;
          note.bodyLength = detail.body.length;
          note.publishTime = detail.publishTime ?? extractPublishTimeFromBody(detail.body);
          note.redId = detail.redId ?? null;
          note.fans = detail.fans ?? null;
          note.detailState = "ok";
          crawlJob.ok += 1;
        } catch {
          note.detailState = "failed";
          crawlJob.failed += 1;
        }
      }),
    );
    // 每批落盘一次：中途重启也能保留已抓到的正文
    const library = upsertNotes(listCrawledNotes(), batch);
    writeLibrary(library);
    if (bi + CRAWL_CONCURRENCY < queue.length) {
      await new Promise((resolve) => setTimeout(resolve, CRAWL_GAP_MS));
    }
  }
}

// ---------- LLM 综合分析（DashScope 通义千问优先，Ark 兜底，任一可用 key 即可） ----------

const DASHSCOPE_TEXT_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation";
// 方舟 Anthropic 兼容端点（x-api-key）与 OpenAI 兼容端点（Bearer）鉴权方式不同：
// 本仓库 ARK_API_KEY 为方舟账号 key，走 Bearer + chat/completions 才是有效用法。
// 注意：deepseek-v4-flash-ga-260731 仅通过方舟 coding 端点启用（标准 /api/v3 端点报 ModelNotOpen）。
const ARK_ENDPOINT = "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions";

function httpsPostJson(url, body, headers) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: target.hostname,
        path: target.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers },
        timeout: LLM_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("LLM 请求超时")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

const ANALYSIS_SYSTEM_PROMPT = `你是电商品牌舆情分析师。用户会提供某品牌关键词（如「麻大师床垫避雷」）在小红书的负面舆情笔记数据，包含每条笔记的标题、作者、互动数据和抓取到的笔记正文。

请输出严格的 JSON（不要 markdown 代码块、不要多余文字），结构如下：
{
  "summary": "整体舆情态势摘要，2-3 句，点明负面声量规模和核心矛盾",
  "riskLevel": "high | medium | low",
  "problemPoints": [
    { "title": "问题点短标题", "detail": "问题点分析：现象、根因、涉及范围", "evidence": ["支撑该问题点的笔记标题或作者"], "severity": "high | medium | low", "mentionCount": 涉及笔记数 }
  ],
  "suggestions": [
    { "title": "改善建议短标题", "detail": "具体可执行的改善动作", "priority": "high | medium | low" }
  ],
  "keywords": ["舆情高频关键词，按出现频率排序，最多 12 个"]
}
要求：问题点按严重程度排序；改善建议要与问题点一一对应且可落地；只用笔记中出现的证据，不要编造。`;

async function callDashScope(apiKey, material) {
  const res = await httpsPostJson(
    DASHSCOPE_TEXT_ENDPOINT,
    {
      model: process.env.SENTIMENT_MODEL || "qwen-max",
      input: {
        messages: [
          { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
          { role: "user", content: material },
        ],
      },
      parameters: { result_format: "message", temperature: 0.3 },
    },
    { Authorization: `Bearer ${apiKey}` },
  );
  if (res.status !== 200) throw new Error(`上游返回 ${res.status}：${res.body.slice(0, 160)}`);
  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    throw new Error("响应非 JSON");
  }
  const text = parsed?.output?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("未返回分析文本");
  return text;
}

async function callArk(apiKey, material) {
  // 方舟 OpenAI 兼容端点：Authorization: Bearer + chat/completions
  // reasoning_effort=max 已实测被端点接受（2026-08-22）；思维链计入 max_tokens
  const res = await httpsPostJson(
    ARK_ENDPOINT,
    {
      model: process.env.ARK_SENTIMENT_MODEL || "deepseek-v4-flash-ga-260731",
      max_tokens: 16384,
      temperature: 0.3,
      reasoning_effort: "max",
      messages: [
        { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content: material },
      ],
    },
    { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  );
  if (res.status !== 200) throw new Error(`上游返回 ${res.status}：${res.body.slice(0, 160)}`);
  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    throw new Error("响应非 JSON");
  }
  const text = parsed?.choices?.[0]?.message?.content ?? "";
  if (typeof text !== "string" || !text.trim()) throw new Error("未返回分析文本");
  return text;
}

async function synthesizeAnalysis(notes) {
  const dashscopeKey = process.env.DASHSCOPE_API_KEY?.trim();
  const arkKey = process.env.ARK_API_KEY?.trim();
  if (!dashscopeKey && !arkKey) {
    throw new Error("未配置 LLM key：请在 .env 填入 DASHSCOPE_API_KEY 或 ARK_API_KEY 后重启服务");
  }

  const material = notes
    .map((note, index) => {
      const body = (note.noteBody || note.body || "").slice(0, NOTE_BODY_CHAR_LIMIT);
      return `【笔记 ${index + 1}】标题：${note.title}\n作者：${note.author}\n互动：赞 ${note.liked} / 评 ${note.comment} / 藏 ${note.collected} / 转 ${note.shared}\n发布时间：${note.publishTime ?? "未知"}\n正文：${body || "(未抓取到正文)"}`;
    })
    .join("\n\n");

  // DashScope 优先，失败降级 Ark；两路都失败时报出各自原因
  const errors = [];
  let text = null;
  if (dashscopeKey) {
    try {
      text = await callDashScope(dashscopeKey, material);
    } catch (error) {
      errors.push(`DashScope 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!text && arkKey) {
    try {
      text = await callArk(arkKey, material);
    } catch (error) {
      errors.push(`Ark 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!text) throw new Error(errors.join("；"));

  // 宽容解析模型输出（去掉可能的代码块围栏后取最外层 JSON）
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("模型输出中未找到 JSON 结构");
  const result = JSON.parse(cleaned.slice(start, end + 1));

  return {
    summary: typeof result.summary === "string" ? result.summary : "",
    riskLevel: ["high", "medium", "low"].includes(result.riskLevel) ? result.riskLevel : "medium",
    problemPoints: Array.isArray(result.problemPoints)
      ? result.problemPoints.map((p) => ({
          title: String(p?.title ?? "未命名问题点"),
          detail: String(p?.detail ?? ""),
          evidence: Array.isArray(p?.evidence) ? p.evidence.map(String) : [],
          severity: ["high", "medium", "low"].includes(p?.severity) ? p.severity : "medium",
          mentionCount: Number(p?.mentionCount) || 0,
        }))
      : [],
    suggestions: Array.isArray(result.suggestions)
      ? result.suggestions.map((s) => ({
          title: String(s?.title ?? "未命名建议"),
          detail: String(s?.detail ?? ""),
          priority: ["high", "medium", "low"].includes(s?.priority) ? s.priority : "medium",
        }))
      : [],
    keywords: Array.isArray(result.keywords) ? result.keywords.map(String).slice(0, 12) : [],
  };
}

// ---------- 分析任务（带参数，报告入档） ----------

let analysisJob = { status: "idle", keyword: "", reportId: null, error: null, startedAt: null, finishedAt: null };

export function getAnalysisStatus() {
  return { ...analysisJob };
}

export function startAnalysis({ keyword, dateFrom, dateTo }) {
  if (analysisJob.status === "running") throw new Error("舆情分析正在运行中，请等待完成");
  if (!keyword || !keyword.trim()) throw new Error("必须选择分析关键词");

  const kw = keyword.trim();
  let selected = listCrawledNotes().filter((n) => n.keyword === kw && n.detailState === "ok");
  if (dateFrom) selected = selected.filter((n) => String(n.publishTime ?? "").slice(0, 10) >= dateFrom);
  if (dateTo) selected = selected.filter((n) => String(n.publishTime ?? "").slice(0, 10) <= dateTo);
  if (!selected.length) {
    const period = dateFrom || dateTo ? `，发布时间 ${dateFrom || "…"} ~ ${dateTo || "…"}` : "";
    throw new Error(`笔记库中没有符合条件的笔记（关键词「${kw}」${period}，且正文已抓取成功）`);
  }

  analysisJob = { status: "running", keyword: kw, reportId: null, error: null, startedAt: new Date().toISOString(), finishedAt: null };

  void (async () => {
    try {
      const result = await synthesizeAnalysis(selected);
      const report = {
        id: new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14),
        keyword: kw,
        createdAt: new Date().toISOString(),
        period: dateFrom || dateTo ? { from: dateFrom || null, to: dateTo || null } : null,
        noteCount: selected.length,
        totalEngagement: selected.reduce((sum, n) => sum + n.liked + n.comment + n.collected + n.shared, 0),
        noteIds: selected.map((n) => n.noteId),
        result,
      };
      saveReport(report);
      analysisJob.status = "done";
      analysisJob.reportId = report.id;
      analysisJob.finishedAt = new Date().toISOString();
    } catch (error) {
      analysisJob.status = "error";
      analysisJob.error = error instanceof Error ? error.message : String(error);
      analysisJob.finishedAt = new Date().toISOString();
    }
  })();

  return { status: analysisJob.status, keyword: kw, noteCount: selected.length };
}

// 启动时执行一次性迁移
migrateLegacyData();
