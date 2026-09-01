/**
 * 竞品情报报告：完整 TOP100 + 同周期价格快照 -> 证据化事实 -> 结构化判断 -> HTML/PDF/Markdown。
 * HTML 是网页预览与 PDF 打印的唯一视觉源；每个周期只保留最新一组产物。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const serverDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(serverDir);
const intelligenceDir = join(projectRoot, "local-data", "intelligence");
export const reportOutputDir = join(intelligenceDir, "reports");

const ARK_ENDPOINT = "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions";
const ARK_MODEL = "deepseek-v4-flash-ga-260731";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = process.env.REPORT_MODEL_OPENROUTER || "qwen/qwen3-235b-a22b:free";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeMarkdown(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function cleanText(value, max = 600) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function safePeriod(value) {
  const period = cleanText(value, 80);
  if (!/^[0-9A-Za-z_~.-]+$/.test(period)) throw new Error("报告周期格式不合法");
  return period;
}

function readDataset(name, period) {
  const snapshot = join(intelligenceDir, name.replace(/\.json$/, `-${period}.json`));
  const path = existsSync(snapshot) ? snapshot : join(intelligenceDir, name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${name} 不是有效 JSON`);
  }
}

function numberFromText(value) {
  const match = cleanText(value).replaceAll(",", "").match(/-?[\d.]+/);
  return match ? Number(match[0]) : Number.NaN;
}

function percentChange(value) {
  const text = cleanText(value);
  const number = numberFromText(text);
  if (!Number.isFinite(number) || !/[▲▼]/.test(text)) return null;
  return text.includes("▼") ? -Math.abs(number) : Math.abs(number);
}

function imageDataUri(item) {
  const relativePath = cleanText(item?.imageFile, 300).replaceAll("/", "\\");
  if (!relativePath || relativePath.includes("..")) return "";
  const path = join(intelligenceDir, "images", relativePath);
  if (!existsSync(path)) return "";
  const extension = extname(path).toLowerCase();
  const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

function aggregateCounts(items, key) {
  const counts = new Map();
  for (const item of items) {
    const value = cleanText(item?.[key], 120) || "未标注";
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function selectRepresentatives(items) {
  const selected = [];
  const brands = new Set();
  const candidates = [...items].sort((a, b) => (Number(b.scores?.CP_total) || 0) - (Number(a.scores?.CP_total) || 0) || a.cpRank - b.cpRank);
  const own = candidates.find((item) => item.isOwnBrand);
  if (own) {
    selected.push(own);
    brands.add(own.brand);
  }
  for (const item of candidates) {
    if (selected.length >= 6) break;
    if (!brands.has(item.brand) && imageDataUri(item)) {
      selected.push(item);
      brands.add(item.brand);
    }
  }
  return selected.slice(0, 6);
}

export function buildReportFacts({ top100, brandRanking, insights, priceSnapshot }) {
  if (!Array.isArray(top100?.items) || top100.items.length !== 100) {
    throw new Error(`TOP100 数据不完整：需要 100 条，当前 ${top100?.items?.length ?? 0} 条`);
  }
  const period = safePeriod(top100.samplePeriod || priceSnapshot?.period || "");
  if (!priceSnapshot || safePeriod(priceSnapshot.period || "") !== period) {
    throw new Error(`缺少与 TOP100 同周期（${period}）的价格快照`);
  }
  if (!Array.isArray(priceSnapshot.items) || priceSnapshot.items.length === 0 || priceSnapshot.items.length > 200) {
    throw new Error("同周期价格快照为空或超过 200 条限制");
  }

  const top100Items = top100.items.map((item, index) => ({ ...item, evidenceId: `T${String(index + 1).padStart(3, "0")}` }));
  const ranking = Array.isArray(brandRanking?.ranking) ? brandRanking.ranking : [];
  const brandItems = ranking.map((item, index) => ({ ...item, evidenceId: `B${String(index + 1).padStart(3, "0")}` }));
  const priceItems = priceSnapshot.items.map((item, index) => {
    const current = numberFromText(item.couponPrice);
    const previous = numberFromText(item.previousPrice);
    return {
      ...item,
      evidenceId: `P${String(index + 1).padStart(3, "0")}`,
      currentPriceValue: Number.isFinite(current) ? current : null,
      previousPriceValue: Number.isFinite(previous) && cleanText(item.previousPrice) !== "-" ? previous : null,
      priceChangeValue: percentChange(item.priceChange),
    };
  });
  const p0Count = insights?.ownBrandActions?.p0?.length || 0;
  const insightActions = [...(insights?.ownBrandActions?.p0 || []), ...(insights?.ownBrandActions?.p1 || [])]
    .map((item, index) => ({ ...item, priority: index < p0Count ? "P0" : "P1", evidenceId: `O${String(index + 1).padStart(3, "0")}` }));
  const schools = (insights?.schools || []).map((item, index) => ({ ...item, evidenceId: `S${String(index + 1).padStart(3, "0")}` }));
  const stores = new Set(top100Items.map((item) => item.shop).filter(Boolean));
  const brands = new Set(top100Items.map((item) => item.brand).filter(Boolean));
  const scored = top100Items.filter((item) => Number.isFinite(Number(item.scores?.CP_total)));
  const ownBrand = brandItems.find((item) => item.isOwnBrand) || null;
  const baselineItems = priceItems.filter((item) => item.previousPriceValue !== null);
  const priceAlerts = priceItems.filter((item) => item.warningStatus !== "无变化" || item.priceChangeValue !== null);
  const criticalAlerts = priceItems.filter((item) => item.warningStatus === "重点预警");
  const withGift = top100Items.filter((item) => item.hasGift === "是").length;
  const highUrgency = top100Items.filter((item) => Number(item.scores?.CN_urgency) >= 4).length;
  const averageCp = scored.length ? scored.reduce((sum, item) => sum + Number(item.scores.CP_total), 0) / scored.length : 0;
  const validEvidenceIds = new Set([
    ...top100Items.map((item) => item.evidenceId),
    ...brandItems.map((item) => item.evidenceId),
    ...priceItems.map((item) => item.evidenceId),
    ...insightActions.map((item) => item.evidenceId),
    ...schools.map((item) => item.evidenceId),
  ]);

  return {
    period,
    pricePeriodLabel: cleanText(priceSnapshot.label || priceSnapshot.period, 100),
    top100Items,
    brandItems,
    priceItems,
    insightActions,
    schools,
    representatives: selectRepresentatives(top100Items),
    validEvidenceIds,
    metrics: {
      itemCount: top100Items.length,
      storeCount: stores.size,
      brandCount: brands.size,
      scoredCount: scored.length,
      averageCp,
      ownRank: ownBrand?.rank ?? "-",
      ownCp: ownBrand?.avgCP ?? "-",
      priceCount: priceItems.length,
      priceBaselineCount: baselineItems.length,
      priceAlertCount: priceAlerts.length,
      criticalAlertCount: criticalAlerts.length,
      giftRate: withGift / top100Items.length,
      highUrgencyRate: highUrgency / top100Items.length,
      marketingCategories: aggregateCounts(top100Items, "marketingCore").slice(0, 6),
    },
  };
}

export function createBaselineNarrative(facts) {
  const topBrandEvidence = facts.brandItems[0]?.evidenceId || "T001";
  const ownEvidence = facts.insightActions[0]?.evidenceId || facts.top100Items.find((item) => item.isOwnBrand)?.evidenceId || "T001";
  const priceEvidence = facts.priceItems.find((item) => item.priceChangeValue !== null)?.evidenceId || facts.priceItems[0]?.evidenceId;
  return {
    thesis: "床垫竞争已从单一功能卖点，转向价格结构、信任背书、场景人群与促销节奏的组合设计。",
    findings: [
      { title: "头部品牌用完整交易理由提高转化", summary: `TOP100 覆盖 ${facts.metrics.brandCount} 个品牌，头部样本把卖点、价格与服务承诺放在同一视觉路径中。`, evidenceIds: [topBrandEvidence, "T001"] },
      { title: "我方机会集中在降噪与紧迫感", summary: "现有专业资产已具备辨识度，下一轮主图应减少并列标签并强化明确人群与限时利益点。", evidenceIds: [ownEvidence] },
      { title: "价格信号必须与主图动作联动", summary: `同周期 ${facts.metrics.priceCount} 款价格快照中，${facts.metrics.priceAlertCount} 款形成观察信号，需在创意测试前确认价格口径。`, evidenceIds: [priceEvidence] },
    ],
    actions: facts.insightActions.slice(0, 3).map((item) => ({ priority: item.priority, title: cleanText(item.title, 80), action: cleanText(item.action, 240), evidenceIds: [item.evidenceId] })),
  };
}

function validateNarrative(narrative, facts) {
  if (!narrative || typeof narrative !== "object") throw new Error("LLM 未返回结构化报告判断");
  const thesis = cleanText(narrative.thesis, 360);
  const findings = Array.isArray(narrative.findings) ? narrative.findings.slice(0, 3) : [];
  const actions = Array.isArray(narrative.actions) ? narrative.actions.slice(0, 3) : [];
  if (!thesis || findings.length !== 3 || actions.length === 0) throw new Error("LLM 报告结构不完整");
  const validateEvidenceIds = (ids) => {
    const cleanIds = Array.isArray(ids) ? [...new Set(ids.map((id) => cleanText(id, 8)))] : [];
    if (!cleanIds.length || cleanIds.some((id) => !facts.validEvidenceIds.has(id))) throw new Error(`LLM 返回了无效证据编号：${cleanIds.join("、") || "空"}`);
    return cleanIds;
  };
  return {
    thesis,
    findings: findings.map((item) => ({ title: cleanText(item.title, 100), summary: cleanText(item.summary, 360), evidenceIds: validateEvidenceIds(item.evidenceIds) })),
    actions: actions.map((item) => ({ priority: cleanText(item.priority, 8) === "P1" ? "P1" : "P0", title: cleanText(item.title, 100), action: cleanText(item.action, 360), evidenceIds: validateEvidenceIds(item.evidenceIds) })),
  };
}

function llmConfig() {
  const arkKey = cleanText(process.env.ARK_API_KEY, 500);
  if (arkKey) return { provider: "ark", endpoint: ARK_ENDPOINT, key: arkKey, model: process.env.ARK_MODEL || ARK_MODEL };
  const openRouterKey = cleanText(process.env.OPENROUTER_API_KEY, 500)
    || (cleanText(process.env.DASHSCOPE_API_KEY, 500).startsWith("sk-or-v1-") ? cleanText(process.env.DASHSCOPE_API_KEY, 500) : "");
  if (openRouterKey) return { provider: "openrouter", endpoint: OPENROUTER_ENDPOINT, key: openRouterKey, model: OPENROUTER_MODEL };
  throw new Error("未配置报告生成用的 LLM key（ARK_API_KEY 或 OPENROUTER_API_KEY）");
}

function buildPrompt(facts) {
  const topEvidence = facts.top100Items.map((item) => [item.evidenceId, `CP#${item.cpRank}`, cleanText(item.brand, 40), cleanText(item.productName, 80), `CP=${item.scores?.CP_total ?? "-"}`, `价格带=${cleanText(item.priceRange, 30) || "-"}`, `手法=${cleanText(item.marketingCore, 80) || "-"}`, `优势=${cleanText(item.biggestAdvantage, 100) || "-"}`, `问题=${cleanText(item.biggestProblem, 100) || "-"}`].join(" | ")).join("\n");
  const priceEvidence = facts.priceItems.map((item) => `${item.evidenceId} | ${cleanText(item.brand, 40)} | ${cleanText(item.productName, 70)} | 当前=${cleanText(item.couponPrice, 20)} | 上期=${cleanText(item.previousPrice, 20)} | 变化=${cleanText(item.priceChange, 20)} | 预警=${cleanText(item.warningStatus, 30)}`).join("\n");
  const actionEvidence = facts.insightActions.map((item) => `${item.evidenceId} | ${item.priority} | ${cleanText(item.title, 80)} | ${cleanText(item.action, 180)}`).join("\n");
  return `你是电商经营决策分析师。请只返回 JSON，不要 markdown，不要代码围栏。\n\n目标结构：\n{"thesis":"核心判断","findings":[{"title":"发现标题","summary":"发现说明","evidenceIds":["T001"]}],"actions":[{"priority":"P0","title":"动作标题","action":"执行动作","evidenceIds":["O001"]}]}\n\n约束：\n1. findings 必须恰好 3 项；actions 为 1-3 项。\n2. 每个发现和动作必须引用下面存在的证据编号，不得创造编号。\n3. 不得编造数字。TOP100 的确定性指标由系统计算，你只负责形成判断与动作。\n4. 聚焦管理层能决策、运营能执行的结论。\n\n周期：${facts.period}\n确定性指标：${JSON.stringify(facts.metrics)}\n\nTOP100 全量证据：\n${topEvidence}\n\n同周期价格证据：\n${priceEvidence}\n\n我方动作证据：\n${actionEvidence || "无"}`;
}

async function generateNarrative(facts) {
  const config = llmConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model, messages: [{ role: "user", content: buildPrompt(facts) }], max_tokens: 2200, temperature: 0.2 }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${config.provider} HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const payload = await response.json();
    const raw = cleanText(payload?.choices?.[0]?.message?.content, 12000).replace(/^```json\s*/i, "").replace(/```$/, "");
    if (!raw) throw new Error(`${config.provider} 返回空内容`);
    return { narrative: validateNarrative(JSON.parse(raw), facts), provider: config.provider, model: config.model };
  } finally {
    clearTimeout(timer);
  }
}

function evidenceLabel(ids) {
  return ids.map((id) => `<span class="evidence">${escapeHtml(id)}</span>`).join("");
}

function chartRows(rows) {
  const max = Math.max(1, ...rows.map((row) => Number(row.avgCP) || 0));
  return rows.map((row) => `<div class="bar-row"><span>${escapeHtml(row.brand)}</span><i><b style="width:${Math.round((Number(row.avgCP || 0) / max) * 100)}%"></b></i><strong>${escapeHtml(row.avgCP)}</strong></div>`).join("");
}

function chunk(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

function reportCss() {
  return `
    :root{--paper:#f8f5ef;--ink:#151515;--muted:#6b6862;--line:#242424;--accent:#d73d32;--soft:#eee9df}
    *{box-sizing:border-box}html,body{margin:0}body{background:#d8ddda;color:var(--ink);font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif;padding:28px}.report{display:grid;gap:24px;width:794px;margin:0 auto}.page{position:relative;width:794px;height:1123px;overflow:hidden;background:linear-gradient(90deg,var(--paper) 0 70%,#f0ece4 70%);padding:48px 52px 42px;box-shadow:0 22px 70px rgba(10,22,16,.18)}.page::before{content:"";position:absolute;left:0;top:0;width:100%;height:5px;background:var(--accent)}
    h1,h2,h3,p{margin-top:0}.display{font-family:"Arial Narrow","Microsoft YaHei",sans-serif;font-size:65px;line-height:1.02;letter-spacing:-.06em;margin:0}.eyebrow{font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:var(--accent)}.lede{font-size:18px;line-height:1.7}.muted{color:var(--muted)}.page-head,.page-foot{display:flex;justify-content:space-between;align-items:center}.page-head{margin-bottom:30px}.page-foot{position:absolute;left:52px;right:52px;bottom:22px;font-size:9px;color:var(--muted)}.section-title{font-size:34px;line-height:1.08;letter-spacing:-.045em;margin:8px 0 22px}.chip,.evidence{display:inline-flex;border:1px solid currentColor;padding:4px 7px;font:800 9px/1 Arial,sans-serif;letter-spacing:.08em}.evidence{margin-right:5px;color:var(--accent)}
    .cover{display:grid;grid-template-rows:auto 1fr auto}.cover::after{content:"100";position:absolute;right:12px;bottom:86px;font:900 250px/.75 Georgia,serif;color:rgba(215,61,50,.1)}.cover .lede{max-width:620px;margin-top:28px}.cover-meta{border-top:2px solid var(--ink);padding-top:18px;display:grid;grid-template-columns:repeat(4,1fr);gap:18px;font-size:11px}.cover-meta strong{display:block;font:800 24px/1 Arial;margin-bottom:7px}
    .metrics{display:grid;grid-template-columns:repeat(4,1fr);border-block:3px solid var(--ink)}.metric{padding:18px 13px;border-right:1px solid var(--line)}.metric:last-child{border-right:0}.metric strong{display:block;font:800 32px/1 Arial;letter-spacing:-.04em}.metric span{font-size:10px;color:var(--muted)}.finding-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:22px;margin-top:30px}.finding{padding-top:15px;border-top:5px solid var(--ink)}.finding:first-child{grid-row:span 2}.finding:first-child h3{font-size:28px}.finding h3{font-size:17px;margin:10px 0 8px}.finding p{font-size:11px;line-height:1.75;color:var(--muted)}
    .decision{margin-top:25px;padding:17px 20px;border-left:5px solid var(--accent);background:#f0e2dc;font-size:14px;line-height:1.75}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:24px}.action{padding:14px 0;border-top:3px solid var(--accent)}.action h3{font-size:18px;margin:8px 0}.action p{font-size:11px;line-height:1.7;color:var(--muted)}.priority{font:900 11px/1 Arial;color:var(--accent)}
    .products{display:grid;grid-template-columns:1.5fr 1fr 1fr;grid-template-rows:195px 195px;gap:8px}.product{position:relative;overflow:hidden;background:#ddd}.product:first-child{grid-row:span 2}.product:last-child{grid-column:2/4}.product img{width:100%;height:100%;object-fit:cover}.caption{position:absolute;left:0;right:0;bottom:0;padding:12px;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.88));font-size:10px}.caption b{display:block;font-size:14px}.caption small{color:#ddd}
    .panel{padding:18px;border:1px solid #cfc8bd;background:rgba(255,255,255,.55)}.bar-row{display:grid;grid-template-columns:110px 1fr 34px;gap:10px;align-items:center;margin:11px 0;font-size:10px}.bar-row i{height:6px;background:#ded8ce}.bar-row b{display:block;height:100%;background:var(--accent)}.bar-row strong{text-align:right}.signal-list{list-style:none;margin:0;padding:0}.signal-list li{padding:12px 0;border-top:1px solid #cfc8bd;font-size:11px;line-height:1.55}.signal-list strong{color:var(--accent);float:right}
    .school-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:15px}.school{padding:17px;border-top:5px solid var(--ink);background:rgba(255,255,255,.45)}.school h3{font-size:19px;margin:9px 0}.school p,.school li{font-size:10px;line-height:1.65;color:var(--muted)}
    table{width:100%;border-collapse:collapse;table-layout:fixed}.data-table{font-size:8px}.data-table th{background:var(--ink);color:#fff;padding:7px 5px;text-align:left}.data-table td{padding:5px;border-bottom:1px solid #d6d0c6;line-height:1.35;vertical-align:top;overflow-wrap:anywhere}.data-table tr:nth-child(even){background:rgba(255,255,255,.42)}.rank{font:800 10px/1 Arial}.danger{color:var(--accent);font-weight:800}.method{display:grid;grid-template-columns:150px 1fr;gap:12px;padding:14px 0;border-top:1px solid var(--line);font-size:11px;line-height:1.7}.method b{font-size:12px}.note{font-size:10px;line-height:1.7;color:var(--muted)}
    @media screen and (max-width:850px){body{padding:12px;overflow-x:hidden}.report{margin:0;zoom:calc((100vw - 24px)/794)}}
    @media print{@page{size:A4;margin:0}html,body{background:#fff;padding:0}.report{display:block;width:auto;margin:0}.page{width:210mm;height:297mm;margin:0;box-shadow:none;break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}}
  `;
}

function pageShell(content, section, pageNumber, pageCount, className = "") {
  return `<section class="page ${className}"><header class="page-head"><span class="eyebrow">ecom AI Studio / ${escapeHtml(section)}</span><span class="muted" style="font-size:10px">${String(pageNumber).padStart(2, "0")} / ${String(pageCount).padStart(2, "0")}</span></header>${content}<footer class="page-foot"><span>竞品情报与 TOP100 · ${escapeHtml(section)}</span><span>证据 → 判断 → 动作</span></footer></section>`;
}

export function renderReportHtml(facts, narrative, meta = {}) {
  const validated = validateNarrative(narrative, facts);
  const generatedAt = meta.generatedAt || new Date().toISOString();
  const topChunks = chunk(facts.top100Items, 25);
  const priceChunks = chunk(facts.priceItems, 25);
  const pageEntries = [];
  pageEntries.push({ section: "Cover", className: "cover", content: `<div><div class="eyebrow">MARKET INTELLIGENCE / 竞品情报</div><h1 class="display" style="margin-top:28px">床垫行业<br>TOP100<br>竞争特刊</h1><p class="lede">${escapeHtml(validated.thesis)}</p></div><div></div><div class="cover-meta"><div><strong>${escapeHtml(facts.period)}</strong>样本周期</div><div><strong>${facts.metrics.itemCount}</strong>TOP100 商品</div><div><strong>${facts.metrics.storeCount}</strong>覆盖店铺</div><div><strong>${facts.metrics.priceCount}</strong>价格快照</div></div>` });
  pageEntries.push({ section: "Executive Brief", content: `<div class="eyebrow">管理层摘要</div><h2 class="section-title">先看结论，<br>再决定下一张主图。</h2><div class="metrics"><div class="metric"><strong>${facts.metrics.itemCount}</strong><span>全量样本</span></div><div class="metric"><strong>${facts.metrics.brandCount}</strong><span>覆盖品牌</span></div><div class="metric"><strong>#${escapeHtml(facts.metrics.ownRank)}</strong><span>麻大师品牌 CP</span></div><div class="metric"><strong>${facts.metrics.priceAlertCount}</strong><span>价格观察信号</span></div></div><div class="finding-grid">${validated.findings.map((item) => `<article class="finding">${evidenceLabel(item.evidenceIds)}<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p></article>`).join("")}</div><div class="decision"><span class="eyebrow">Core judgement</span><br>${escapeHtml(validated.thesis)}</div>` });
  pageEntries.push({ section: "Operating Action", content: `<div class="eyebrow">运营证据与行动</div><h2 class="section-title">看见差距，马上行动</h2><div class="products">${facts.representatives.slice(0, 4).map((item) => `<article class="product">${imageDataUri(item) ? `<img src="${imageDataUri(item)}" alt="">` : ""}<div class="caption"><small>${item.evidenceId} · CP ${escapeHtml(item.scores?.CP_total ?? "-")}</small><b>${escapeHtml(item.brand)}</b><small>${escapeHtml(item.marketingCore)}</small></div></article>`).join("")}</div><div class="two-col" style="margin-top:24px"><section><div class="eyebrow" style="margin-bottom:10px">品牌 CP / TOP 5</div>${chartRows(facts.brandItems.slice(0, 5))}</section><section>${validated.actions.map((item) => `<article class="action"><span class="priority">${escapeHtml(item.priority)}</span> ${evidenceLabel(item.evidenceIds)}<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.action)}</p></article>`).join("")}</section></div>` });
  pageEntries.push({ section: "Market Landscape", content: `<div class="eyebrow">行业结构</div><h2 class="section-title">头部品牌与主图流派</h2><div class="two-col"><section class="panel"><div class="eyebrow">品牌 CP 排行</div>${chartRows(facts.brandItems.slice(0, 12))}</section><section class="panel"><div class="eyebrow">确定性口径</div><div class="metrics" style="grid-template-columns:1fr 1fr;margin-top:15px"><div class="metric"><strong>${facts.metrics.averageCp.toFixed(2)}</strong><span>全榜平均 CP</span></div><div class="metric"><strong>${Math.round(facts.metrics.giftRate * 100)}%</strong><span>赠品展示率</span></div><div class="metric"><strong>${Math.round(facts.metrics.highUrgencyRate * 100)}%</strong><span>高紧迫感占比</span></div><div class="metric"><strong>${facts.metrics.scoredCount}</strong><span>有效评分样本</span></div></div><p class="note" style="margin-top:18px">全部指标由 100 条数据确定性计算；文本判断不参与数值生成。</p></section></div><div class="school-grid" style="margin-top:24px">${facts.schools.slice(0, 4).map((school) => `<article class="school">${evidenceLabel([school.evidenceId])}<h3>${escapeHtml(school.name)}</h3><p>${escapeHtml(school.subtitle)}</p><ul>${(school.features || []).slice(0, 3).map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul></article>`).join("")}</div>` });
  const largestMoves = [...facts.priceItems].filter((item) => item.priceChangeValue !== null).sort((a, b) => Math.abs(b.priceChangeValue) - Math.abs(a.priceChangeValue)).slice(0, 8);
  pageEntries.push({ section: "Price Intelligence", content: `<div class="eyebrow">价格监控</div><h2 class="section-title">价格信号必须与主图动作联动</h2><div class="metrics"><div class="metric"><strong>${facts.metrics.priceCount}</strong><span>同周期快照</span></div><div class="metric"><strong>${facts.metrics.priceBaselineCount}</strong><span>具备上期基线</span></div><div class="metric"><strong>${facts.metrics.priceAlertCount}</strong><span>观察信号</span></div><div class="metric"><strong>${facts.metrics.criticalAlertCount}</strong><span>重点预警</span></div></div><div class="two-col" style="margin-top:28px"><section class="panel"><div class="eyebrow">最大涨跌</div><ul class="signal-list">${largestMoves.map((item) => `<li>${evidenceLabel([item.evidenceId])}${escapeHtml(item.brand)} · ${escapeHtml(cleanText(item.productName, 36))}<strong>${escapeHtml(item.priceChange)}</strong></li>`).join("") || "<li>本周期无可比涨跌项</li>"}</ul></section><section class="panel"><div class="eyebrow">口径说明</div><div class="method"><b>同周期</b><span>价格快照必须与 TOP100 周期 ${escapeHtml(facts.period)} 一致。</span></div><div class="method"><b>上期基线</b><span>无上一期价格时显示“-”，不参与涨跌判断。</span></div><div class="method"><b>阈值</b><span>沿用现有价格监控预警状态与阈值，不在报告中重算业务规则。</span></div></section></div>` });
  pageEntries.push({ section: "Visual Evidence", content: `<div class="eyebrow">代表性商品证据</div><h2 class="section-title">商品图不是装饰，是证据本身</h2><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px">${facts.representatives.map((item) => `<article class="panel" style="padding:8px"><div style="height:210px;overflow:hidden;background:#ddd">${imageDataUri(item) ? `<img src="${imageDataUri(item)}" alt="" style="width:100%;height:100%;object-fit:cover">` : ""}</div><div style="padding:9px 4px 2px">${evidenceLabel([item.evidenceId])}<b style="font-size:13px">${escapeHtml(item.brand)}</b><p class="note" style="margin:7px 0 0">${escapeHtml(item.marketingCore)} · CP ${escapeHtml(item.scores?.CP_total ?? "-")}</p></div></article>`).join("")}</div>` });
  topChunks.forEach((rows, index) => pageEntries.push({ section: "TOP100 Appendix", content: `<div class="eyebrow">完整榜单附录</div><h2 class="section-title">TOP100 · ${index * 25 + 1}—${index * 25 + rows.length}</h2><table class="data-table"><colgroup><col style="width:37px"><col style="width:54px"><col style="width:95px"><col><col style="width:76px"><col style="width:36px"><col style="width:95px"></colgroup><thead><tr><th>CP#</th><th>证据</th><th>品牌</th><th>商品</th><th>价格带</th><th>CP</th><th>核心手法</th></tr></thead><tbody>${rows.map((item) => `<tr><td class="rank">${item.cpRank}</td><td>${item.evidenceId}</td><td>${escapeHtml(item.brand)}</td><td>${escapeHtml(item.productName)}</td><td>${escapeHtml(item.priceRange)}</td><td>${escapeHtml(item.scores?.CP_total ?? "-")}</td><td>${escapeHtml(item.marketingCore)}</td></tr>`).join("")}</tbody></table>` }));
  priceChunks.forEach((rows, index) => pageEntries.push({ section: "Price Appendix", content: `<div class="eyebrow">价格预警附录</div><h2 class="section-title">价格快照 · ${index * 25 + 1}—${index * 25 + rows.length}</h2><table class="data-table"><colgroup><col style="width:46px"><col style="width:75px"><col><col style="width:62px"><col style="width:62px"><col style="width:55px"><col style="width:70px"></colgroup><thead><tr><th>证据</th><th>品牌</th><th>商品</th><th>券后价</th><th>上一期</th><th>变化</th><th>预警</th></tr></thead><tbody>${rows.map((item) => `<tr><td>${item.evidenceId}</td><td>${escapeHtml(item.brand)}</td><td>${escapeHtml(item.productName)}</td><td>${escapeHtml(item.couponPrice)}</td><td>${escapeHtml(item.previousPrice)}</td><td class="${item.priceChangeValue !== null ? "danger" : ""}">${escapeHtml(item.priceChange)}</td><td>${escapeHtml(item.warningStatus)}</td></tr>`).join("")}</tbody></table>` }));
  pageEntries.push({ section: "Methodology", content: `<div class="eyebrow">方法与追溯</div><h2 class="section-title">一份可以复核的经营报告</h2><div class="method"><b>样本</b><span>TOP100 全量 100 条；品牌、店铺、CP、促销与视觉字段均从当前周期数据集确定性计算。</span></div><div class="method"><b>价格</b><span>${escapeHtml(facts.pricePeriodLabel)} 同周期快照，共 ${facts.metrics.priceCount} 条；${facts.metrics.priceBaselineCount} 条具备上一期价格。</span></div><div class="method"><b>证据编号</b><span>T=TOP100 商品，B=品牌排行，P=价格快照，O=我方既有行动，S=行业流派。所有判断和动作只允许引用本报告存在的编号。</span></div><div class="method"><b>LLM 边界</b><span>LLM 只生成结构化核心判断、3 项发现和行动建议；不计算排名、比例、价格涨跌或样本数。</span></div><div class="method"><b>生成信息</b><span>${escapeHtml(generatedAt)} · ${escapeHtml(meta.provider || "deterministic-preview")} · ${escapeHtml(meta.model || "baseline")}</span></div><div class="decision" style="margin-top:38px"><span class="eyebrow">Use this report</span><br>前 3 页用于管理层决策；中段用于运营拆解；完整 TOP100 与价格快照附录用于追溯和复核。</div>` });

  const pageCount = pageEntries.length;
  const pages = pageEntries.map((entry, index) => pageShell(entry.content, entry.section, index + 1, pageCount, entry.className)).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>床垫行业 TOP100 竞争特刊 · ${escapeHtml(facts.period)}</title><style>${reportCss()}</style></head><body><main class="report">${pages}</main></body></html>`;
}

export function renderReportMarkdown(facts, narrative, meta = {}) {
  const validated = validateNarrative(narrative, facts);
  const lines = [
    "# 床垫行业 TOP100 竞争特刊", "", `- 样本周期：${facts.period}`, `- TOP100：${facts.metrics.itemCount} 条`, `- 同周期价格快照：${facts.metrics.priceCount} 条（${facts.metrics.priceBaselineCount} 条具备上一期基线）`, `- 生成：${meta.generatedAt || new Date().toISOString()} · ${meta.provider || "deterministic-preview"} · ${meta.model || "baseline"}`, "",
    "## 核心判断", "", validated.thesis, "", "## 管理层摘要", "",
    ...validated.findings.flatMap((item) => [`### ${item.title} [${item.evidenceIds.join(", ")}]`, "", item.summary, ""]),
    "## 麻大师 P0/P1 行动", "", ...validated.actions.flatMap((item) => [`### ${item.priority} · ${item.title} [${item.evidenceIds.join(", ")}]`, "", item.action, ""]),
    "## 完整 TOP100", "", "| CP# | 证据 | 品牌 | 商品 | 店铺 | 价格带 | CP | 核心手法 |", "|---:|---|---|---|---|---|---:|---|",
    ...facts.top100Items.map((item) => `| ${item.cpRank} | ${item.evidenceId} | ${escapeMarkdown(item.brand)} | ${escapeMarkdown(item.productName)} | ${escapeMarkdown(item.shop)} | ${escapeMarkdown(item.priceRange)} | ${escapeMarkdown(item.scores?.CP_total ?? "-")} | ${escapeMarkdown(item.marketingCore)} |`),
    "", "## 同周期价格快照", "", "| 证据 | 品牌 | 商品 | 券后价 | 上一期 | 变化 | 预警 |", "|---|---|---|---:|---:|---:|---|",
    ...facts.priceItems.map((item) => `| ${item.evidenceId} | ${escapeMarkdown(item.brand)} | ${escapeMarkdown(item.productName)} | ${escapeMarkdown(item.couponPrice)} | ${escapeMarkdown(item.previousPrice)} | ${escapeMarkdown(item.priceChange)} | ${escapeMarkdown(item.warningStatus)} |`),
    "", "## 方法", "", "T=TOP100 商品，B=品牌排行，P=价格快照，O=我方既有行动，S=行业流派。LLM 只生成结构化判断和行动，不计算确定性指标。", "",
  ];
  return lines.join("\n");
}

export function reportArtifactPath(id, format = "html") {
  const safeId = safePeriod(id);
  if (!new Set(["html", "pdf", "md"]).has(format)) throw new Error("不支持的报告格式");
  return join(reportOutputDir, `${safeId}.${format}`);
}

export async function writeReportArtifacts(facts, narrative, meta = {}) {
  const generatedAt = meta.generatedAt || new Date().toISOString();
  const id = safePeriod(facts.period);
  const html = renderReportHtml(facts, narrative, { ...meta, generatedAt });
  const markdown = renderReportMarkdown(facts, narrative, { ...meta, generatedAt });
  mkdirSync(reportOutputDir, { recursive: true });
  const nonce = `${process.pid}-${Date.now()}`;
  const finalPaths = { html: reportArtifactPath(id, "html"), pdf: reportArtifactPath(id, "pdf"), md: reportArtifactPath(id, "md") };
  const tempPaths = Object.fromEntries(Object.entries(finalPaths).map(([key, path]) => [key, `${path}.${nonce}.tmp`]));
  let browser;
  try {
    writeFileSync(tempPaths.html, html, "utf8");
    writeFileSync(tempPaths.md, markdown, "utf8");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: tempPaths.pdf, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
    await browser.close();
    browser = null;
    for (const key of ["html", "md", "pdf"]) renameSync(tempPaths[key], finalPaths[key]);
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    for (const path of Object.values(tempPaths)) if (existsSync(path)) unlinkSync(path);
    throw error;
  }
  return {
    id, title: "床垫行业 TOP100 竞争特刊", period: facts.period, generatedAt, provider: meta.provider || "deterministic-preview", model: meta.model || "baseline", itemCount: facts.metrics.itemCount, priceCount: facts.metrics.priceCount,
    pageCount: 7 + Math.ceil(facts.top100Items.length / 25) + Math.ceil(facts.priceItems.length / 25),
    previewUrl: `/api/intelligence/reports/${id}`, pdfUrl: `/api/intelligence/reports/${id}.pdf`, markdownUrl: `/api/intelligence/reports/${id}.md`,
  };
}

export async function generateIntelligenceReport(options = {}) {
  const requestedPeriod = safePeriod(options.period || options.priceSnapshot?.period || "");
  const top100 = readDataset("top100.json", requestedPeriod);
  const brandRanking = readDataset("brand-ranking.json", requestedPeriod);
  const insights = readDataset("insights.json", requestedPeriod);
  if (!top100) throw new Error("TOP100 数据集不存在，请先完成一次主图分析");
  const facts = buildReportFacts({ top100, brandRanking, insights, priceSnapshot: options.priceSnapshot });
  const generated = await generateNarrative(facts);
  return writeReportArtifacts(facts, generated.narrative, generated);
}
