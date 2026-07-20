/**
 * build-intelligence-dataset.mjs
 *
 * 生成前端可消费的三份 JSON：
 *   - local-data/intelligence/top100.json
 *   - local-data/intelligence/brand-ranking.json
 *   - local-data/intelligence/insights.json
 *
 * 两种模式：
 *   1. 默认（Stage A）：读取 E:/Github/竞品主图分析/analysis/ 下的离线人工分析
 *   2. --pipeline（Stage B）：读取 local-data/intelligence/analysis-cache/pipeline-results.json
 *      （由 server pipeline 自动生成）
 *
 * 用法：
 *   node scripts/build-intelligence-dataset.mjs
 *   node scripts/build-intelligence-dataset.mjs --pipeline
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = join(__filename, "..", "..");
const OUTPUT_DIR = join(projectRoot, "local-data", "intelligence");
const IMAGES_DIR = join(OUTPUT_DIR, "images");

const usePipeline = process.argv.includes("--pipeline");

// 数据源根据模式切换
const STAGE_A_ANALYSIS_ROOT = "E:/Github/竞品主图分析/analysis";
const STAGE_A_IMAGE_ROOT = "E:/Github/竞品主图分析/images/raw";
const PIPELINE_CACHE = join(OUTPUT_DIR, "analysis-cache", "pipeline-results.json");

mkdirSync(OUTPUT_DIR, { recursive: true });
mkdirSync(IMAGES_DIR, { recursive: true });

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// ---------- 1. 加载原始数据 ----------
let batches = [];
let context = {};
let rowImageMap = {};
let madashiByRow = {};
let samplePeriod = "2026-07-02 ~ 2026-07-08";
let imageBaseDir = IMAGES_DIR;  // pipeline 模式下图片已在 IMAGES_DIR

if (usePipeline) {
  // Pipeline 模式：从 pipeline-results.json 读所有内容
  if (!existsSync(PIPELINE_CACHE)) {
    console.error(`[build] pipeline 缓存不存在：${PIPELINE_CACHE}`);
    process.exit(1);
  }
  const pipelineRows = readJson(PIPELINE_CACHE);
  batches = pipelineRows;
  // 从 pipeline 结果反向拼上下文
  for (const row of pipelineRows) {
    const r = row.row;
    context[String(r)] = {
      row: r,
      ranking: r - 1,
      name: row.name || row["X主标题文案"] || "",
      shop: row.shop || "",
      platform: row.platform || "天猫",
      price: row.price || "",
      sales: row.sales || "",
      keywords: row.keywords || "",
    };
    rowImageMap[String(r)] = join(IMAGES_DIR, row.imageFile);
    if (row.date) samplePeriod = row.date;
  }
  console.log(`[build] pipeline 模式：读取 ${pipelineRows.length} 行分析结果`);
} else {
  // Stage A 模式：读现有 batch01~10
  for (let i = 1; i <= 10; i++) {
    const file = join(STAGE_A_ANALYSIS_ROOT, `batch${String(i).padStart(2, "0")}_results.json`);
    batches.push(...readJson(file));
  }
  context = readJson(join(STAGE_A_ANALYSIS_ROOT, "context_60rows.json"));
  rowImageMap = readJson(join(STAGE_A_ANALYSIS_ROOT, "row_image_mapping.json"));
  const madashiReal = readJson(join(STAGE_A_ANALYSIS_ROOT, "madashi_real_3images_analysis.json"));
  madashiByRow = Object.fromEntries(madashiReal.map((m) => [m.row, m]));

  // 从 images/raw/ 目录扫补齐 row_image_mapping.json 缺失的行
  for (const f of readdirSync(STAGE_A_IMAGE_ROOT)) {
    const m = f.match(/^row(\d+)_/);
    if (!m) continue;
    const row = String(Number(m[1]));
    if (!rowImageMap[row]) rowImageMap[row] = join(STAGE_A_IMAGE_ROOT, f);
  }
}

// ---------- 2. 归一化字段 ----------
// 分数字段可能是字符串数字，也可能是"高/中/低"，统一转成 1~5 数字
const RATING_MAP = { 高: 5, 中: 3, 低: 1, 强: 5, 弱: 1 };

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return value;
  const trimmed = String(value).trim();
  if (RATING_MAP[trimmed] !== undefined) return RATING_MAP[trimmed];
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

// 从原字段名（含中文）里取值：既支持 "CP综合转化潜力评分"，也兼容纯字母 "CP"
function pick(row, prefix) {
  const keys = Object.keys(row);
  const hit = keys.find((k) => k === prefix || k.startsWith(prefix));
  return hit ? row[hit] : undefined;
}

function pickString(row, prefix) {
  const v = pick(row, prefix);
  return v === undefined || v === null ? "" : String(v);
}

// ---------- 3. 生成 top100.json ----------
function buildTop100() {
  const items = batches.map((batch) => {
    const row = batch.row;
    // 麻大师三行用真实分析覆盖
    const analysis = madashiByRow[row] ?? batch;
    const ctx = context[String(row)] ?? {};
    const imgPath = rowImageMap[String(row)];
    const imgFile = imgPath ? basename(imgPath) : null;

    return {
      row,
      ranking: ctx.ranking ?? row - 1,
      productName: ctx.name ?? pickString(analysis, "X主标题") ?? "",
      brand: extractBrand(imgFile, ctx.shop),
      shop: ctx.shop ?? "",
      platform: ctx.platform ?? "天猫",
      priceRange: ctx.price ?? "",
      salesRange: ctx.sales ?? "",
      keywords: ctx.keywords ?? "",
      imageFile: imgFile,
      // 9 项评分（1~5）
      scores: {
        CH_clarity: toNumber(pick(analysis, "CH")),
        CI_sellpoint: toNumber(pick(analysis, "CI")),
        CJ_diff: toNumber(pick(analysis, "CJ")),
        CK_price: toNumber(pick(analysis, "CK")),
        CL_gift: toNumber(pick(analysis, "CL")),
        CM_trust: toNumber(pick(analysis, "CM")),
        CN_urgency: toNumber(pick(analysis, "CN")),
        CO_visual: toNumber(pick(analysis, "CO")),
        CP_total: toNumber(pick(analysis, "CP")),
      },
      // 精选 25 关键字段（主表列 + 抽屉展示用）
      headline: pickString(analysis, "X主标题"),
      subheadline: pickString(analysis, "Y副标题"),
      keyNumbers: pickString(analysis, "Z重点数字"),
      visualFocus1: pickString(analysis, "U第一视觉焦点"),
      visualFocus2: pickString(analysis, "V第二视觉焦点"),
      mainTheme: pickString(analysis, "W核心传播主题"),
      marketingCategory: pickString(analysis, "AD营销手法分类"),
      marketingCore: pickString(analysis, "AE核心营销手法"),
      marketingStrength: pickString(analysis, "AH营销力度"),
      sellPointCore: pickString(analysis, "AJ核心卖点"),
      sellPointExtra: pickString(analysis, "AK其他卖点"),
      userBenefit: pickString(analysis, "AN用户利益"),
      painPoints: pickString(analysis, "AP对应消费痛点"),
      hasGift: pickString(analysis, "AU是否展示赠品"),
      giftContent: pickString(analysis, "AV赠品内容"),
      priceExpression: pickString(analysis, "BF价格表达方式"),
      urgencySource: pickString(analysis, "BK紧迫感来源"),
      layoutType: pickString(analysis, "BL版式类型"),
      mainColor: pickString(analysis, "BN主色调"),
      audience: pickString(analysis, "BW目标人群"),
      scene: pickString(analysis, "BX使用场景"),
      conversionFormula: pickString(analysis, "CC转化公式"),
      // 结论三件套
      biggestAdvantage: pickString(analysis, "CQ最大优势"),
      biggestProblem: pickString(analysis, "CR最大问题"),
      worthLearning: pickString(analysis, "CS最值得借鉴"),
      // 保留完整原始字段供抽屉查看
      raw: analysis,
      isOwnBrand: row === 16 || row === 19 || row === 21,
    };
  });

  // 按综合 CP 降序排（有分数的排前面，null 排最后）
  items.sort((a, b) => (b.scores.CP_total ?? 0) - (a.scores.CP_total ?? 0));
  items.forEach((item, idx) => {
    item.cpRank = idx + 1;
  });

  return {
    generatedAt: new Date().toISOString(),
    samplePeriod,
    sourceCount: items.length,
    fieldCount: 85,
    items,
  };
}

// 从图片文件名 rowXX_品牌_产品名.jpeg 里提取品牌
function extractBrand(imgFile, fallbackShop) {
  if (imgFile) {
    const m = imgFile.match(/^row\d+_([^_]+)_/);
    if (m && m[1] !== "unk") return m[1];
  }
  return (fallbackShop || "").replace(/官方旗舰店|旗舰店|自营|京东自营|自播间|抖音自播间|寝具/g, "").trim() || "其他";
}

// ---------- 4. 生成 brand-ranking.json ----------
function buildBrandRanking(top100) {
  const byBrand = new Map();
  for (const item of top100.items) {
    if (!item.scores.CP_total) continue;
    const brand = item.brand;
    if (!byBrand.has(brand)) byBrand.set(brand, { brand, items: [], totalCP: 0 });
    const bucket = byBrand.get(brand);
    bucket.items.push(item.row);
    bucket.totalCP += item.scores.CP_total;
  }
  const ranking = Array.from(byBrand.values())
    .map((b) => ({
      brand: b.brand,
      count: b.items.length,
      avgCP: Math.round((b.totalCP / b.items.length) * 100) / 100,
      rows: b.items,
    }))
    .filter((b) => b.count >= 1)
    .sort((a, b) => b.avgCP - a.avgCP);

  ranking.forEach((r, i) => {
    r.rank = i + 1;
    r.isOwnBrand = r.brand === "麻大师";
  });

  return { generatedAt: new Date().toISOString(), ranking };
}

// ---------- 5. 生成 insights.json ----------
// 4 流派 + 麻大师 P0/P1 行动（来自 竞品主图分析/docs/关键洞察.md 和 README.md）
function buildInsights() {
  return {
    generatedAt: new Date().toISOString(),
    schools: [
      {
        id: "A",
        name: "大促爆款派",
        subtitle: "转化天花板",
        representatives: ["芝华仕 5.00", "金橡树 4.50", "梦百合 4.50", "喜临门 4.00"],
        features: [
          "价格锚点 + 政府补贴 + 多档赠品 + 销量数字四件套",
          "涨价紧迫感 / 大促窗口",
          "视觉高信息密度、红色促销风",
        ],
        tone: "red",
      },
      {
        id: "B",
        name: "品牌调性派",
        subtitle: "差异化壁垒",
        representatives: ["蓝盒子 4.80", "雅兰 4.50", "栖作 4.00", "亚朵星球 3.50"],
        features: [
          "品牌名 / 设计感 / 代言人 / 认证图章",
          "促销标签少而精",
          "视觉高级、色彩克制",
        ],
        tone: "blue",
      },
      {
        id: "C",
        name: "性价比矩阵派",
        subtitle: "走量",
        representatives: ["源氏木语 4.25", "林氏家居 4.25"],
        features: [
          "8 SKU / 4 SKU 集中出现在 TOP60",
          "每张图强调不同价位段（低价锚点 + 高价对比）",
          "0 胶水 / 护脊等重复卖点强化品牌记忆",
        ],
        tone: "purple",
      },
      {
        id: "D",
        name: "黄麻/环保专业派",
        subtitle: "我方所在流派",
        representatives: ["麻大师 4.00 ⭐"],
        features: [
          "剖面结构 / S 型黄麻 / 0 胶环保",
          "第一品牌认证图章",
          '痛点标题："拯救软床"、"撑腰护脊"',
        ],
        tone: "green",
        isOwnSchool: true,
      },
    ],
    ownBrandActions: {
      brand: "麻大师",
      currentScore: 4.0,
      currentRank: "10/17",
      p0: [
        {
          id: "p0-1",
          title: "增加大促时间窗口/倒计时",
          issue: "3/3 主图 CN=2（唯一评分低于 3 的维度）",
          action: '右上角红色飘带 "88超品｜7/7 20点-7/9 24点" 或 "限时500单赠护脊枕"',
          expectedGain: "CN 紧迫感 2→4，综合评分 4→4.5，进入 TOP5",
        },
        {
          id: "p0-2",
          title: "优化豆7款主标题差异化",
          issue: '"适配多种睡感"过于宽泛，差异化评分 3 分',
          action: '改为 "久坐族腰痛必备｜黄麻硬护脊" 或 "父母房专用｜A类抑菌黄麻"',
          expectedGain: "CJ 差异化 3→4，CI 卖点表达 4→5",
        },
      ],
      p1: [
        {
          id: "p1-1",
          title: "豆芽款促销标签合并",
          issue: "促销标签分散，视觉噪音较高",
          action: "3 档赠品换购合并为 1 个组合标签，主图信息密度下降",
          expectedGain: "视觉完成度 CO 提升 0.5 分",
        },
      ],
    },
  };
}

// ---------- 主流程 ----------
const top100 = buildTop100();
const brandRanking = buildBrandRanking(top100);
const insights = buildInsights();

writeFileSync(join(OUTPUT_DIR, "top100.json"), JSON.stringify(top100, null, 2), "utf8");
writeFileSync(join(OUTPUT_DIR, "brand-ranking.json"), JSON.stringify(brandRanking, null, 2), "utf8");
writeFileSync(join(OUTPUT_DIR, "insights.json"), JSON.stringify(insights, null, 2), "utf8");

console.log(`[build-intelligence-dataset] 写入完成：`);
console.log(`  ${OUTPUT_DIR}/top100.json         (${top100.items.length} 行)`);
console.log(`  ${OUTPUT_DIR}/brand-ranking.json  (${brandRanking.ranking.length} 品牌)`);
console.log(`  ${OUTPUT_DIR}/insights.json       (4 流派 + P0/P1 行动)`);

// 图片存在性 sanity check（根据模式检查不同目录）
const imgCheckDir = usePipeline ? IMAGES_DIR : STAGE_A_IMAGE_ROOT;
const missing = top100.items.filter((i) => i.imageFile && !existsSync(join(imgCheckDir, i.imageFile)));
if (missing.length) {
  console.warn(`[WARN] ${missing.length} 张图片在 ${imgCheckDir} 中未找到，前端会显示占位：`);
  missing.slice(0, 5).forEach((i) => console.warn(`  row ${i.row}: ${i.imageFile}`));
}
