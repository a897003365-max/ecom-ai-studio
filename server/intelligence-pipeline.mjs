/**
 * intelligence-pipeline.mjs
 *
 * 竞品情报全自动分析流水线（多周期 + 链接原图版）
 *
 * 四阶段：
 *   1. read     - python 读取排行 Excel 行（含格式校验、周期识别）
 *   2. download - 按「商品图片链接」列下载原图到 images/<period>/（失败的记录并汇总）
 *   3. analyze  - 多 provider 并发 vision 分析（支持取消；按周期断点续跑）
 *   4. merge    - 合并本周期的分析结果并调 build-intelligence-dataset.mjs 生成前端 JSON
 *
 * 目录结构（按周期隔离）：
 *   local-data/intelligence/sources/<period>.xlsx
 *   local-data/intelligence/images/<period>/rowNN_xxx.jpg
 *   local-data/intelligence/analysis-cache/<period>/pipeline-results.json
 *
 * 取消：POST /api/intelligence/analyze-cancel → state.cancelRequested=true，
 *       下载/分析在逐项之间检查该标记，已完成的进度保留在周期缓存里。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { writeFile, rm } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyzeBatch, hasVisionKey, visionProviderInfo } from "./vision-client.mjs";
import { buildPrompt, parseVisionResponse, FIELD_KEYS } from "./vision-prompt.mjs";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = join(__filename, "..", "..");
const INTEL_DIR = join(projectRoot, "local-data", "intelligence");
const SOURCES_DIR = join(INTEL_DIR, "sources");
const IMAGES_ROOT = join(INTEL_DIR, "images");
const CACHE_ROOT = join(INTEL_DIR, "analysis-cache");
const READ_ROWS_SCRIPT = join(projectRoot, "scripts", "read-ranking-rows.py");

// 单机内存任务状态（重启即丢，够用）
const state = {
  running: false,
  phase: "idle",          // idle | read | download | analyze | merge | done | error | cancelled
  processed: 0,
  total: 0,
  message: "",
  startedAt: null,
  finishedAt: null,
  error: null,
  useMock: false,
  period: null,
  failedDownloads: [],    // [{row, name, url, reason}]
  cancelRequested: false,
};

export function getPipelineState() {
  return { ...state };
}

export function requestCancel() {
  if (state.running) {
    state.cancelRequested = true;
    return true;
  }
  return false;
}

function setState(update) {
  Object.assign(state, update);
}

function setPhase(phase, message = "") {
  setState({ phase, message });
}

// ---------- 周期工具 ----------

/** "2026-08-14 ~ 2026-08-20" → "2026-08-14_~_2026-08-20"；与 build 脚本口径一致 */
export function periodSlug(period) {
  return String(period || "").trim().replace(/[\\/:*?"<>|\s]+/g, "_");
}

function periodDirs(slug) {
  return {
    source: join(SOURCES_DIR, `${slug}.xlsx`),
    images: join(IMAGES_ROOT, slug),
    cache: join(CACHE_ROOT, slug),
    results: join(CACHE_ROOT, slug, "pipeline-results.json"),
  };
}

/** 列出已上传的源表周期（按文件名，新→旧） */
export function listSourcePeriods() {
  try {
    return readdirSync(SOURCES_DIR)
      .filter((f) => f.endsWith(".xlsx") && !f.startsWith("."))
      .map((f) => f.replace(/\.xlsx$/, ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** 最新上传的源表周期 */
export function latestSourcePeriod() {
  const list = listSourcePeriods();
  return list[0] || null;
}

// ---------- Phase 1: 读取 + 校验（供上传端点复用） ----------

/**
 * 用 python 脚本读取 Excel 行并校验格式。
 * 返回 {ok, period, rows, error, missing, headers}
 */
export async function readSourceRows(xlsxPath) {
  return new Promise((resolve) => {
    const python = process.env.PYTHON_BIN || "python";
    const proc = spawn(python, [READ_ROWS_SCRIPT, xlsxPath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => resolve({ ok: false, error: `读取脚本启动失败: ${err.message}` }));
    proc.on("close", (code) => {
      try {
        const lastLine = stdout.trim().split(/\r?\n/).pop();
        resolve(JSON.parse(lastLine));
      } catch {
        resolve({ ok: false, error: `读取脚本输出无法解析 (exit ${code}): ${stderr.slice(0, 300)}` });
      }
    });
  });
}

/**
 * 上传入口：校验格式 → 按周期存到 sources/<period>.xlsx
 * 返回 {ok, period, slug, rowCount, error, missing, headers}
 */
export async function saveSourceFile(buffer) {
  mkdirSync(SOURCES_DIR, { recursive: true });
  // 先落临时文件供 python 读取
  const tmpPath = join(SOURCES_DIR, `.incoming-${Date.now()}.xlsx`);
  await writeFile(tmpPath, buffer);
  try {
    const probe = await readSourceRows(tmpPath);
    if (!probe.ok) {
      return { ok: false, error: probe.error, missing: probe.missing, headers: probe.headers };
    }
    if (!probe.period) {
      return { ok: false, error: "未能在「日期」列读到周期信息", missing: ["日期"], headers: probe.headers };
    }
    const slug = periodSlug(probe.period);
    const target = periodDirs(slug).source;
    await writeFile(target, buffer);
    return { ok: true, period: probe.period, slug, rowCount: probe.rows.length };
  } finally {
    try { await rm(tmpPath, { force: true }); } catch {}
  }
}

// ---------- Phase 2: 按链接下载原图 ----------

async function downloadOne(url, outPath, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { Referer: "https://www.taobao.com/", "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 1024) throw new Error(`文件过小(${buf.length}B)，疑似占位图`);
    await writeFile(outPath, buf);
    return null;
  } catch (error) {
    return error.name === "AbortError" ? "下载超时" : error.message;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadImages(rows, imagesDir, onProgress, shouldCancel) {
  mkdirSync(imagesDir, { recursive: true });
  const failures = [];
  const downloaded = [];
  let done = 0;
  const CONCURRENCY = 6;
  let idx = 0;

  async function worker() {
    while (idx < rows.length) {
      if (shouldCancel()) return;
      const myIdx = idx++;
      const row = rows[myIdx];
      if (!row.imageUrl) {
        failures.push({ row: row.row, name: row.name, url: "", reason: "该行无图片链接" });
        done++;
        onProgress?.(done, rows.length, row.name || `row${row.row}`);
        continue;
      }
      // 文件名：NN_店铺_名称.ext（截断防超长）
      let ext = ".jpg";
      try {
        ext = (extname(new URL(row.imageUrl).pathname) || ".jpg").slice(0, 6) || ".jpg";
      } catch {}
      const safeName = `${String(row.ranking || row.row).padStart(2, "0")}_${String(row.shop || "unk").slice(0, 12)}_${String(row.name || "").replace(/[\\/:*?"<>|【】\[\]]/g, "").slice(0, 25)}`;
      const outPath = join(imagesDir, `${safeName}${ext}`);
      const err = await downloadOne(row.imageUrl, outPath);
      if (err) {
        failures.push({ row: row.row, name: row.name, url: row.imageUrl, reason: err });
      } else {
        downloaded.push({ ...row, imageFile: basename(outPath) });
      }
      done++;
      onProgress?.(done, rows.length, basename(outPath));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  return { downloaded, failures };
}

// ---------- Phase 3: 视觉分析 ----------

async function mockAnalyzeBatch(items, promptBuilder, onProgress) {
  const results = [];
  let processed = 0;
  for (const item of items) {
    await new Promise((r) => setTimeout(r, 80));
    const ctx = item.context || {};
    const obj = {};
    for (const key of FIELD_KEYS) obj[key] = "-";
    obj["P图片分析状态"] = "分析完成";
    obj["X主标题文案"] = ctx.name ? String(ctx.name).slice(0, 20) : "模拟标题";
    ["CH信息清晰度评分","CI卖点表达评分","CJ差异化评分","CK价格吸引力评分",
     "CL赠品吸引力评分","CM信任建立评分","CN紧迫感评分","CO视觉完成度评分",
     "CP综合转化潜力评分"].forEach((k) => { obj[k] = 3; });
    results.push({ imagePath: item.imagePath, imageFile: basename(item.imagePath), context: ctx, text: JSON.stringify(obj) });
    processed++;
    onProgress?.({ processed, total: items.length, current: basename(item.imagePath) });
  }
  return { results, cancelled: false };
}

// ---------- Phase 4: 合并 + 构建 ----------

// 解析单条分析结果为一行（完整上下文 + vision 字段）；解析失败返回 null
function parseResultRow(r) {
  try {
    const parsed = parseVisionResponse(r.text);
    // 保留完整上下文（shop/date/name/ranking 等），供 build 脚本生成指标
    return { ...r.context, ...parsed, imageFile: r.imageFile };
  } catch {
    return null;
  }
}

// 按 row upsert 进本周期缓存并落盘（不跨周期，避免行号串期）；返回合并后总行数
function upsertRowsIntoCache(newRows, dirs) {
  mkdirSync(dirs.cache, { recursive: true });
  let prevRows = [];
  try {
    if (existsSync(dirs.results)) {
      prevRows = JSON.parse(readFileSync(dirs.results, "utf8"));
    }
  } catch {}
  const newRowIds = new Set(newRows.map((r) => r.row));
  const rows = [...newRows, ...prevRows.filter((r) => !newRowIds.has(r.row))];
  writeFileSync(dirs.results, JSON.stringify(rows, null, 2), "utf8");
  return rows.length;
}

// 解析失败 sidecar：原始返回落盘供诊断/离线重解析；行成功后自动移出清单
function updateParseFailureSidecar(dirs, rowId, failureEntry) {
  try {
    mkdirSync(dirs.cache, { recursive: true });
    const path = join(dirs.cache, "pipeline-parse-failures.json");
    let arr = [];
    try {
      if (existsSync(path)) arr = JSON.parse(readFileSync(path, "utf8"));
    } catch {}
    arr = arr.filter((x) => x.row !== rowId);
    if (failureEntry) arr.push(failureEntry);
    writeFileSync(path, JSON.stringify(arr, null, 2), "utf8");
  } catch {}
}

// 增量落盘：每张分析成功即写入本周期缓存，防中途重启丢失内存中的结果
function persistIncrementalResult(r, dirs) {
  try {
    if (!r || r.error || !r.text) return;
    const rowId = r.context?.row;
    try {
      const parsed = parseVisionResponse(r.text);
      upsertRowsIntoCache([{ ...r.context, ...parsed, imageFile: r.imageFile }], dirs);
      updateParseFailureSidecar(dirs, rowId, null);
    } catch (parseErr) {
      updateParseFailureSidecar(dirs, rowId, {
        row: rowId,
        imageFile: r.imageFile,
        reason: String(parseErr.message || "").slice(0, 200),
        text: String(r.text).slice(0, 4000),
        at: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.warn("[pipeline] 增量落盘失败（不影响分析继续）：", e.message);
  }
}

async function mergeResults(analysisResults, dirs) {
  const newRows = analysisResults
    .filter((r) => !r.error && r.text)
    .map(parseResultRow)
    .filter(Boolean);

  // 与增量落盘/历史缓存按 row 幂等合并
  const totalRows = upsertRowsIntoCache(newRows, dirs);

  if (totalRows === 0) {
    const sampleErrors = analysisResults
      .filter((r) => r.error)
      .slice(0, 3)
      .map((r) => `[${r.imageFile}] ${r.error}`)
      .join(" | ");
    throw new Error(`所有图片分析均失败。样本错误: ${sampleErrors || "(无 error 字段)"}`);
  }
  const failedCount = analysisResults.filter((r) => r.error || !r.text).length;
  if (failedCount > 0) {
    console.warn(`[pipeline] 本轮失败 ${failedCount} 张，合并本周期历史后共 ${totalRows} 行（新增 ${newRows.length}）`);
  }

  return new Promise((resolve, reject) => {
    const scriptPath = join(projectRoot, "scripts", "build-intelligence-dataset.mjs");
    const child = spawn("node", [scriptPath, "--pipeline", "--period", periodSlug(state.period)], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: projectRoot,
    });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`build-intelligence-dataset 退出码 ${code}: ${err.slice(0, 300)}`));
    });
  });
}

// ---------- 主流程 ----------

/**
 * 启动 pipeline（异步执行，state 供轮询）
 * @param {{mock?: boolean, force?: boolean, period?: string}} options
 *   period 为空时分析最新上传的源表
 */
export async function startAnalysisPipeline(options = {}) {
  if (state.running) {
    throw new Error("已有分析任务正在进行中，请等待完成");
  }

  const slug = options.period ? periodSlug(options.period) : latestSourcePeriod();
  if (!slug) {
    throw new Error("未找到任何源表，请先上传带图片链接的排行 Excel");
  }
  const dirs = periodDirs(slug);
  if (!existsSync(dirs.source)) {
    throw new Error(`周期 ${slug} 的源表不存在：${dirs.source}`);
  }

  const useMock = options.mock === true || (!hasVisionKey() && options.mock !== false);
  setState({
    running: true,
    phase: "read",
    processed: 0,
    total: 0,
    message: useMock ? "读取源表中（Mock 模式：无 API Key）..." : "读取源表中...",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    useMock,
    period: slug,
    failedDownloads: [],
    cancelRequested: false,
  });

  const shouldCancel = () => state.cancelRequested;

  (async () => {
    try {
      // Phase 1: 读取 + 校验
      const probe = await readSourceRows(dirs.source);
      if (!probe.ok) throw new Error(`源表校验失败：${probe.error}`);
      const rows = probe.rows;
      setState({ total: rows.length, message: `共 ${rows.length} 个商品，开始下载原图...` });

      // Phase 2: 下载原图
      setPhase("download");
      const { downloaded, failures } = await downloadImages(
        rows,
        dirs.images,
        (done, total, current) => setState({ processed: done, total, message: `下载原图 ${done}/${total} - ${current}` }),
        shouldCancel,
      );
      setState({ failedDownloads: failures });
      if (shouldCancel()) throw new Error("__cancelled__");
      if (downloaded.length === 0) {
        throw new Error(`原图全部下载失败（${failures.length} 张）：${failures[0]?.reason || "未知"}`);
      }

      // Phase 3: 分析（周期内断点续跑）
      let prevRows = [];
      try {
        if (existsSync(dirs.results)) prevRows = JSON.parse(readFileSync(dirs.results, "utf8"));
      } catch {}
      const doneRows = new Set(prevRows.map((r) => r.row));
      const todo = options.force ? downloaded : downloaded.filter((d) => !doneRows.has(d.row));

      let analysisResults = [];
      let cancelled = false;
      if (todo.length === 0) {
        setPhase("merge", "全部图片已有分析结果，直接重建数据集...");
      } else {
        setPhase("analyze", `待分析 ${todo.length} 张（跳过已完成 ${doneRows.size} 张）...`);
        const analyzeFn = useMock ? mockAnalyzeBatch : analyzeBatch;
        const items = todo.map((d) => ({
          imagePath: join(dirs.images, d.imageFile),
          context: d,
        }));
        const out = await analyzeFn(items, buildPrompt, (progress) => {
          setState({
            processed: progress.processed,
            total: progress.total,
            message: `分析中... ${progress.processed}/${progress.total} - ${progress.current}${progress.error ? " (错误)" : ""}${progress.provider ? ` [${progress.provider}]` : ""}`,
          });
          // 每张完成即落盘：中途重启/崩溃不丢已分析结果，下轮续跑自动跳过
          if (progress.result) persistIncrementalResult(progress.result, dirs);
        }, { shouldCancel });
        analysisResults = out.results;
        cancelled = out.cancelled;
      }

      // Phase 4: 合并（取消时也合并已完成部分，保住进度）
      setPhase("merge", "合并结果并生成前端数据集...");
      await mergeResults(analysisResults, dirs);

      const failNote = failures.length > 0 ? `；${failures.length} 张原图下载失败（见状态详情）` : "";
      setState({
        running: false,
        phase: cancelled ? "cancelled" : "done",
        message: cancelled
          ? `已取消。完成部分已保存${failNote}`
          : `分析完成：本周期新分析 ${todo.length} 张（总 ${downloaded.length} 张）${failNote}`,
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      const isCancel = error.message === "__cancelled__";
      setState({
        running: false,
        phase: isCancel ? "cancelled" : "error",
        message: isCancel ? "已取消" : `分析失败：${error.message}`,
        error: isCancel ? null : error.message,
        finishedAt: new Date().toISOString(),
      });
    }
  })();
}

/** 是否有可用源表（供前端判断按钮可用性） */
export function hasSourceXlsx() {
  return latestSourcePeriod() !== null;
}

export function sourceXlsxInfo() {
  const slug = latestSourcePeriod();
  if (!slug) return null;
  const p = periodDirs(slug).source;
  if (!existsSync(p)) return null;
  const s = statSync(p);
  return { path: p, size: s.size, mtime: s.mtime.toISOString(), period: slug };
}

export { visionProviderInfo };
