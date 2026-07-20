/**
 * intelligence-pipeline.mjs
 *
 * 竞品情报全自动分析流水线（弹性数量版）
 *
 * 三阶段：
 *   1. extract  - 从 xlsx 抽出所有 DISPIMG 图片（数量弹性，实际有几张就处理几张）
 *   2. analyze  - 并发调用 Vision API 分析每张图
 *   3. merge    - 合并分析结果 + 写入 top100/brand-ranking/insights JSON
 *
 * 输入：local-data/intelligence/source_raw.xlsx
 * 输出：更新 local-data/intelligence/{top100,brand-ranking,insights}.json + images/*
 *
 * 特点：全程无硬编码"60"，处理什么数字就是什么数字。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyzeBatch, hasVisionKey, VisionKeyMissingError } from "./vision-client.mjs";
import { buildPrompt, parseVisionResponse, FIELD_KEYS } from "./vision-prompt.mjs";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = join(__filename, "..", "..");
const INTEL_DIR = join(projectRoot, "local-data", "intelligence");
const IMAGES_DIR = join(INTEL_DIR, "images");
const SOURCE_XLSX = join(INTEL_DIR, "source_raw.xlsx");
const PYTHON_EXTRACT_SCRIPT = join(projectRoot, "scripts", "extract-images-from-xlsx.py");

// 单机内存任务状态（重启即丢，够用）
const state = {
  running: false,
  phase: "idle",          // idle | extract | analyze | merge | done | error
  processed: 0,
  total: 0,
  message: "",
  startedAt: null,
  finishedAt: null,
  error: null,
  useMock: false,
};

export function getPipelineState() {
  return { ...state };
}

function setState(update) {
  Object.assign(state, update);
}

function setPhase(phase, message = "") {
  setState({ phase, message });
}

// ---------- Phase 1: 抽图 ----------

/**
 * 调用 Python 脚本抽图。Python 脚本必须支持接受 xlsx 路径和输出目录参数。
 * 返回抽出的图片文件路径数组和对应的 row 上下文。
 */
async function extractImages(xlsxPath, outputDir) {
  return new Promise((resolve, reject) => {
    // 清空输出目录（保持"重新分析"语义）
    if (existsSync(outputDir)) {
      for (const f of readdirSync(outputDir)) {
        const fp = join(outputDir, f);
        try {
          rmSync(fp, { force: true });
        } catch {}
      }
    } else {
      mkdirSync(outputDir, { recursive: true });
    }

    const python = process.env.PYTHON_BIN || "python";
    const proc = spawn(python, [PYTHON_EXTRACT_SCRIPT, xlsxPath, outputDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("error", (err) => reject(new Error(`Python 抽图脚本启动失败: ${err.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`Python 抽图脚本退出码 ${code}, stderr: ${stderr.slice(0, 500)}`));
      }
      try {
        // Python 脚本以 JSON 一行输出 {"images": [{...}, ...]}
        const lastLine = stdout.trim().split(/\r?\n/).pop();
        const result = JSON.parse(lastLine);
        resolve(result.images || []);
      } catch (parseErr) {
        reject(new Error(`抽图脚本输出无法解析: ${parseErr.message}\nSTDOUT: ${stdout.slice(0, 500)}`));
      }
    });
  });
}

// ---------- Phase 2: 视觉分析 ----------

/**
 * 用 mock 分析函数（不调 API），用于开发/无 Key 环境验证 UI
 */
async function mockAnalyzeBatch(items, promptBuilder, onProgress) {
  const total = items.length;
  const results = new Array(total);
  let processed = 0;
  const startAt = Date.now();

  for (let i = 0; i < total; i++) {
    // 模拟每张 300~600ms 延时
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
    const item = items[i];
    const ctx = item.context || {};
    results[i] = {
      imagePath: item.imagePath,
      imageFile: basename(item.imagePath),
      context: ctx,
      text: JSON.stringify(mockAnalysisResult(ctx)),
    };
    processed++;
    if (onProgress) {
      onProgress({ processed, total, current: basename(item.imagePath) });
    }
  }
  return results;
}

function mockAnalysisResult(ctx) {
  const obj = {};
  for (const key of FIELD_KEYS) {
    obj[key] = "-";
  }
  obj["P图片分析状态"] = "分析完成";
  obj["Q图片数量"] = 1;
  obj["R图片信息完整度"] = "中";
  obj["S分析依据类型"] = "模拟数据";
  obj["X主标题文案"] = ctx.name ? String(ctx.name).slice(0, 20) : "模拟标题";
  obj["Y副标题文案"] = "模拟副标题";
  // 评分字段给随机中等值
  ["CH信息清晰度评分","CI卖点表达评分","CJ差异化评分","CK价格吸引力评分",
   "CL赠品吸引力评分","CM信任建立评分","CN紧迫感评分","CO视觉完成度评分",
   "CP综合转化潜力评分"].forEach((k, i) => {
    obj[k] = 3 + (i % 3 === 0 ? 1 : 0);
  });
  obj["CQ最大优势"] = "（mock）复合战术齐备";
  obj["CR最大问题"] = "（mock）紧迫感偏弱";
  obj["CS最值得借鉴的做法"] = "（mock）套装组合式";
  obj["CV单图分析结论"] = `mock 分析：${ctx.brand || ""} ${ctx.name || ""}`;
  return obj;
}

// ---------- Phase 3: 合并 ----------

/**
 * 将 Vision 结果转成 batch 风格 JSON，写入 analysis 目录
 * 并触发 build-intelligence-dataset.mjs 生成最终 3 份 JSON
 */
async function mergeResults(analysisResults) {
  const ANALYSIS_DIR = join(projectRoot, "local-data", "intelligence", "analysis-cache");
  mkdirSync(ANALYSIS_DIR, { recursive: true });

  // 按 row 排序，每 6 行一个 batch（保持与 batch01~10 结构一致）
  const rows = analysisResults
    .filter((r) => !r.error && r.text)
    .map((r) => {
      try {
        const parsed = parseVisionResponse(r.text);
        return { row: r.context?.row, ...parsed, imageFile: r.imageFile };
      } catch (err) {
        return null;
      }
    })
    .filter(Boolean);

  if (rows.length === 0) {
    throw new Error("所有图片分析均失败，无法合并结果");
  }

  // 写单个合并文件（供 build-intelligence-dataset 使用）
  writeFileSync(
    join(ANALYSIS_DIR, "pipeline-results.json"),
    JSON.stringify(rows, null, 2),
    "utf8"
  );

  // 触发 build-intelligence-dataset.mjs（用当前 pipeline 结果）
  return new Promise((resolve, reject) => {
    const scriptPath = join(projectRoot, "scripts", "build-intelligence-dataset.mjs");
    const child = spawn("node", [scriptPath, "--pipeline"], {
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
 * @param {{mock?: boolean}} options
 */
export async function startAnalysisPipeline(options = {}) {
  if (state.running) {
    throw new Error("已有分析任务正在进行中，请等待完成");
  }

  if (!existsSync(SOURCE_XLSX)) {
    throw new Error(`未找到源文件：${SOURCE_XLSX}\n请把原始表放到该路径`);
  }

  const useMock = options.mock === true || (!hasVisionKey() && options.mock !== false);
  setState({
    running: true,
    phase: "extract",
    processed: 0,
    total: 0,
    message: useMock ? "抽图中（Mock 模式：无 API Key）..." : "抽图中...",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    useMock,
  });

  // 后台异步执行，不阻塞 HTTP 响应
  (async () => {
    try {
      // Phase 1: 抽图
      const extracted = await extractImages(SOURCE_XLSX, IMAGES_DIR);
      if (extracted.length === 0) {
        throw new Error("抽图完成但未找到任何 DISPIMG 图片，请检查 xlsx 格式");
      }
      setState({ total: extracted.length, message: `已抽取 ${extracted.length} 张图片，开始分析...` });

      // Phase 2: 分析
      setPhase("analyze");
      const analyzeFn = useMock ? mockAnalyzeBatch : analyzeBatch;
      const items = extracted.map((e) => ({
        imagePath: join(IMAGES_DIR, e.imageFile),
        context: e,
      }));
      const results = await analyzeFn(items, buildPrompt, (progress) => {
        setState({
          processed: progress.processed,
          total: progress.total,
          message: `分析中... ${progress.processed}/${progress.total} - ${progress.current}${progress.error ? " (错误)" : ""}`,
        });
      });

      // Phase 3: 合并
      setPhase("merge", "合并结果并生成前端数据集...");
      await mergeResults(results);

      setState({
        running: false,
        phase: "done",
        message: `分析完成，共处理 ${extracted.length} 张图片`,
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      setState({
        running: false,
        phase: "error",
        message: `分析失败：${error.message}`,
        error: error.message,
        finishedAt: new Date().toISOString(),
      });
    }
  })();
}

/**
 * 检查 source_raw.xlsx 是否就位
 */
export function hasSourceXlsx() {
  return existsSync(SOURCE_XLSX);
}

export function sourceXlsxInfo() {
  if (!hasSourceXlsx()) return null;
  const s = statSync(SOURCE_XLSX);
  return {
    path: SOURCE_XLSX,
    size: s.size,
    mtime: s.mtime.toISOString(),
  };
}
