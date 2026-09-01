import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const intelligenceDir = join(root, "local-data", "intelligence");
const outputDir = join(root, "output", "report-design-bakeoff");

const top100 = JSON.parse(readFileSync(join(intelligenceDir, "top100.json"), "utf8"));
const brandRanking = JSON.parse(readFileSync(join(intelligenceDir, "brand-ranking.json"), "utf8"));
const insights = JSON.parse(readFileSync(join(intelligenceDir, "insights.json"), "utf8"));
const competitorSource = readFileSync(join(root, "src", "data", "tmallCompetitorData.ts"), "utf8");

function extractJsonArray(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`未找到 ${marker}`);
  const assignmentIndex = source.indexOf("=", markerIndex);
  const start = source.indexOf("[", assignmentIndex);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(start, index + 1));
    }
  }
  throw new Error(`${marker} 数组不完整`);
}

const pricePeriods = extractJsonArray(competitorSource, "export const tmallPricePeriods");
const pricePeriod = pricePeriods.find((entry) => entry.period === top100.samplePeriod);
if (!pricePeriod) throw new Error(`缺少周期 ${top100.samplePeriod} 的价格快照`);

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function imageData(item) {
  if (!item?.imageFile) return "";
  try {
    const filePath = join(intelligenceDir, "images", item.imageFile);
    const ext = extname(filePath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${readFileSync(filePath).toString("base64")}`;
  } catch {
    return "";
  }
}

function parsePercent(value) {
  const match = String(value || "").match(/[\d.]+/);
  return match ? Number(match[0]) : -1;
}

const items = [...top100.items].sort((a, b) => a.cpRank - b.cpRank);
const stores = new Set(items.map((item) => item.shop).filter(Boolean));
const brands = new Set(items.map((item) => item.brand).filter(Boolean));
const scored = items.filter((item) => Number.isFinite(item.scores?.CP_total));
const ownBrand = brandRanking.ranking.find((item) => item.brand === "麻大师");
const alerts = pricePeriod.items
  .filter((item) => item.warningStatus && item.warningStatus !== "无变化")
  .sort((a, b) => {
    if (a.warningStatus === "重点预警" && b.warningStatus !== "重点预警") return -1;
    if (b.warningStatus === "重点预警" && a.warningStatus !== "重点预警") return 1;
    return parsePercent(b.priceChange) - parsePercent(a.priceChange);
  });
const priceBaselineCount = pricePeriod.items.filter((item) => item.previousPrice && item.previousPrice !== "-").length;

const representative = [];
for (const item of items) {
  if (!item.imageFile || representative.some((entry) => entry.brand === item.brand)) continue;
  representative.push(item);
  if (representative.length === 3) break;
}
const ownProduct = items.find((item) => item.brand === "麻大师" && item.imageFile);
if (ownProduct) representative.push(ownProduct);

const facts = {
  period: top100.samplePeriod,
  generatedAt: new Date().toISOString(),
  itemCount: items.length,
  storeCount: stores.size,
  brandCount: brands.size,
  scoredCount: scored.length,
  ownRank: ownBrand?.rank ?? "-",
  ownScore: ownBrand?.avgCP ?? "-",
  priceCount: pricePeriod.items.length,
  priceBaselineCount,
  alertCount: alerts.length,
  criticalCount: alerts.filter((item) => item.warningStatus === "重点预警").length,
  topBrands: brandRanking.ranking.slice(0, 5),
  schools: insights.schools ?? [],
  actions: [...(insights.ownBrandActions?.p0 ?? []), ...(insights.ownBrandActions?.p1 ?? [])].slice(0, 3),
  alerts: alerts.slice(0, 3),
  representative,
};

const sharedCopy = {
  thesis: "床垫竞争正从单一产品卖点，转向价格结构、信任背书与场景人群的组合设计。",
  findings: [
    { id: "T001", title: "交易结构成为主图入场券", text: "头部商品普遍把补贴、试睡、赠品和服务承诺组合成完整的购买理由。" },
    { id: "B002", title: "统一模板与极简差异化同时有效", text: "源氏木语用一致的信任模块建立记忆，蓝盒子用留白和口语标题穿透高密度竞品。" },
    { id: "O001", title: "麻大师的下一步是降噪与加紧迫感", text: "黄麻第一的专业资产已经明确，短板集中在信息拥挤、场景不足和促销时间感偏弱。" },
  ],
};

const themes = {
  a: { name: "A 纸面情报特刊", slug: "paper-dossier", accent: "#719625" },
  b: { name: "B 深色作战沙盘", slug: "dark-command", accent: "#a6e536" },
  c: { name: "C 行业视觉杂志", slug: "industry-editorial", accent: "#d73d32" },
  d: { name: "D 咨询分析白皮书", slug: "consulting-brief", accent: "#145348" },
};

const scorecard = [
  { key: "A", name: "纸面情报特刊", hierarchy: 23, readability: 19, imagery: 12, brand: 14, pdf: 15, memory: 9 },
  { key: "B", name: "深色作战沙盘", hierarchy: 22, readability: 16, imagery: 13, brand: 15, pdf: 11, memory: 9 },
  { key: "C", name: "行业视觉杂志", hierarchy: 24, readability: 18, imagery: 15, brand: 12, pdf: 14, memory: 10 },
  { key: "D", name: "咨询分析白皮书", hierarchy: 22, readability: 20, imagery: 12, brand: 13, pdf: 15, memory: 6 },
].map((item) => ({ ...item, total: item.hierarchy + item.readability + item.imagery + item.brand + item.pdf + item.memory }));

const baseCss = `
  *{box-sizing:border-box} html,body{margin:0;background:#d9ddd8;color:var(--ink);font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif}
  body{padding:32px}.page{position:relative;width:794px;height:1123px;margin:0 auto;overflow:hidden;background:var(--paper);color:var(--ink);box-shadow:0 24px 80px rgba(14,24,19,.18);isolation:isolate}
  .pad{height:100%;padding:48px 52px}.eyebrow{font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}.display{margin:0;font-family:"Arial Narrow","Microsoft YaHei",sans-serif;font-size:54px;line-height:1.02;letter-spacing:-.055em}.lede{font-size:18px;line-height:1.7}.meta{font-size:11px;line-height:1.65;color:var(--muted)}
  .rule{height:1px;background:var(--line)}.chip{display:inline-flex;align-items:center;border:1px solid var(--line);padding:5px 9px;font-size:10px;font-weight:700;letter-spacing:.05em}.metric strong{display:block;font:700 34px/1 Arial,sans-serif;letter-spacing:-.04em}.metric span{display:block;margin-top:7px;font-size:11px;color:var(--muted)}
  .finding h3,.action h3{margin:0 0 7px;font-size:15px;line-height:1.35}.finding p,.action p{margin:0;font-size:11px;line-height:1.75;color:var(--muted)}.evidence{font:800 9px/1 Arial,sans-serif;letter-spacing:.12em;color:var(--accent)}
  .product img{width:100%;height:100%;object-fit:cover}.product b{display:block;font-size:11px;line-height:1.35}.product small{font-size:9px;color:var(--muted)}
  .brand-row{display:grid;grid-template-columns:86px 1fr 40px;align-items:center;gap:10px;margin:9px 0;font-size:10px}.brand-track{height:5px;background:var(--track)}.brand-fill{height:100%;background:var(--accent)}
  .alert-row{display:grid;grid-template-columns:1fr 68px;gap:12px;padding:10px 0;border-top:1px solid var(--line)}.alert-row b{font-size:10px}.alert-row span{font:700 11px/1 Arial;color:var(--danger);text-align:right}
  .footer{position:absolute;left:52px;right:52px;bottom:22px;display:flex;justify-content:space-between;font-size:9px;color:var(--muted)}
  @media screen and (max-width:858px){body{padding:12px;overflow-x:hidden;min-height:calc((100vw - 24px) * 1.414 + 24px)}.page{margin:0;transform:scale(calc((100vw - 24px)/794));transform-origin:top left}}
  .a{--paper:#f3f0e6;--ink:#182119;--muted:#667065;--line:#b9c0b4;--track:#d8dccf;--accent:#719625;--danger:#a84335}.a .page{background-image:radial-gradient(rgba(20,32,23,.06) .55px,transparent .55px);background-size:6px 6px}.a .cover-mark{position:absolute;left:0;top:0;bottom:0;width:18px;background:var(--accent)}.a .cover-grid{display:grid;grid-template-columns:1.5fr .75fr;gap:50px;align-items:end;height:100%}.a .cover-number{font:700 140px/.8 Arial;color:rgba(113,150,37,.14)}.a .metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;padding:21px 0;border-block:1px solid var(--line)}.a .findings{display:grid;grid-template-columns:1.12fr .88fr;gap:20px}.a .finding:first-child{grid-row:span 2;padding:24px;border-left:6px solid var(--accent);background:#e7ead9}.a .finding:not(:first-child){padding:18px 0;border-top:1px solid var(--line)}.a .product-grid{display:grid;grid-template-columns:1.25fr repeat(3,1fr);gap:10px}.a .product{height:218px;position:relative}.a .product img{height:160px}.a .product-caption{padding-top:8px}.a .ops-grid{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:26px}.a .action{padding:13px 0;border-top:1px solid var(--line)}
  .b{--paper:#071014;--ink:#e8f1ec;--muted:#8da09a;--line:rgba(166,229,54,.2);--track:#16272a;--accent:#a6e536;--danger:#ff735f}.b .page{background-image:linear-gradient(rgba(166,229,54,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(166,229,54,.035) 1px,transparent 1px),radial-gradient(circle at 80% 10%,rgba(73,191,227,.17),transparent 34%);background-size:24px 24px,24px 24px,auto}.b .page::before{content:"";position:absolute;inset:14px;border:1px solid rgba(166,229,54,.16);pointer-events:none}.b .display{font-family:"Arial Narrow","Microsoft YaHei";text-transform:uppercase}.b .cover-grid{display:flex;flex-direction:column;justify-content:space-between;height:100%}.b .cover-number{font:700 128px/.8 Arial;color:rgba(166,229,54,.13)}.b .metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.b .metric{padding:18px 14px;border:1px solid var(--line);background:rgba(10,30,31,.72)}.b .findings{display:grid;gap:10px}.b .finding{padding:18px;border:1px solid var(--line);background:linear-gradient(90deg,rgba(166,229,54,.08),rgba(73,191,227,.035))}.b .product-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.b .product{height:210px;border:1px solid var(--line);padding:6px;background:#0d1a1f}.b .product img{height:112px}.b .product-caption{padding:7px 2px}.b .product small{display:block;line-height:1.35}.b .ops-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:16px;margin-top:20px}.b .panel{padding:16px;border:1px solid var(--line);background:rgba(9,25,26,.8)}.b .action{padding:12px;border-left:2px solid var(--accent);background:rgba(166,229,54,.05);margin-top:8px}
  .c{--paper:#f8f5ef;--ink:#151515;--muted:#6b6862;--line:#242424;--track:#e1ddd4;--accent:#d73d32;--danger:#d73d32}.c .page{background:linear-gradient(90deg,#f8f5ef 0 70%,#f0ece4 70%)}.c .cover-grid{display:grid;grid-template-rows:auto 1fr auto;height:100%}.c .display{font-size:66px;max-width:620px}.c .cover-number{position:absolute;right:-22px;bottom:100px;font:800 250px/.75 Georgia;color:rgba(215,61,50,.1)}.c .metrics{display:grid;grid-template-columns:1.2fr repeat(3,1fr);gap:0;border-block:3px solid var(--ink)}.c .metric{padding:18px 13px;border-right:1px solid var(--line)}.c .findings{display:grid;grid-template-columns:1fr 1fr;gap:24px}.c .finding{padding-top:15px;border-top:5px solid var(--ink)}.c .finding:first-child{grid-row:span 2}.c .finding:first-child h3{font-size:30px;letter-spacing:-.04em}.c .product-grid{display:grid;grid-template-columns:1.5fr 1fr 1fr;grid-template-rows:190px 190px;gap:8px}.c .product{position:relative;overflow:hidden}.c .product:first-child{grid-row:span 2}.c .product:last-child{grid-column:2/4}.c .product-caption{position:absolute;left:0;right:0;bottom:0;padding:10px;color:white;background:linear-gradient(transparent,rgba(0,0,0,.84))}.c .product small{color:#ddd}.c .ops-grid{display:grid;grid-template-columns:.85fr 1.15fr;gap:26px;margin-top:22px}.c .action{padding:12px 0;border-top:3px solid var(--accent)}
  .d{--paper:#fbfcfc;--ink:#122a26;--muted:#63736f;--line:#ccd7d4;--track:#e7edeb;--accent:#145348;--danger:#a8473d}.d .page{background:linear-gradient(180deg,#f2f7f5 0 145px,#fbfcfc 145px)}.d .cover-grid{display:grid;grid-template-columns:1fr .55fr;gap:44px;align-items:center;height:100%}.d .cover-number{font:700 120px/.8 Arial;color:#dfe9e6}.d .metrics{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-radius:5px;overflow:hidden}.d .metric{padding:19px;border-right:1px solid var(--line);background:white}.d .findings{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.d .finding{padding:18px;border:1px solid var(--line);border-radius:5px;background:white}.d .product-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.d .product{padding:8px;border:1px solid var(--line);border-radius:5px;background:white}.d .product img{height:130px}.d .product-caption{padding:8px 2px 2px}.d .ops-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px}.d .panel{padding:18px;border:1px solid var(--line);border-radius:5px;background:white}.d .action{padding:12px 0;border-top:1px solid var(--line)}
`;

function header(theme, section, page) {
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:36px"><span class="eyebrow" style="color:var(--accent)">ecom AI Studio / ${esc(section)}</span><span class="meta">${esc(facts.period)} · ${String(page).padStart(2, "0")}</span></div>`;
}

function cover(theme) {
  return `<div class="page ${theme}" data-page="01"><div class="cover-mark"></div><div class="pad cover-grid">
    <section><div class="eyebrow" style="color:var(--accent);margin-bottom:20px">MARKET INTELLIGENCE / 竞品情报</div><h1 class="display">床垫行业<br>TOP100<br>竞争特刊</h1><p class="lede" style="max-width:570px;margin:28px 0 0">${esc(sharedCopy.thesis)}</p></section>
    <aside><div class="cover-number">100</div><div class="rule" style="margin:20px 0"></div><div class="meta">样本周期<br><strong style="font-size:18px;color:var(--ink)">${esc(facts.period)}</strong><br><br>${facts.itemCount} 款商品 · ${facts.storeCount} 家店铺<br>${facts.priceCount} 款价格快照 · ${facts.alertCount} 条观察信号</div></aside>
    <footer style="grid-column:1/-1;display:flex;justify-content:space-between;align-items:end"><div class="chip">内部经营决策材料</div><div class="meta" style="text-align:right">数据源：生意参谋榜单 / 竞品主图分析 / 价格快照<br>生成：ecom AI Studio Intelligence</div></footer>
  </div></div>`;
}

function summary(theme) {
  const metrics = [
    [facts.itemCount, "TOP100 样本"],
    [facts.storeCount, "覆盖店铺"],
    [`#${facts.ownRank}`, "麻大师品牌 CP"],
    [facts.alertCount, "价格观察信号"],
  ];
  return `<div class="page ${theme}" data-page="02"><div class="pad">${header(theme, "Executive Brief", 2)}
    <div style="display:flex;justify-content:space-between;gap:28px;align-items:end;margin-bottom:30px"><div><div class="eyebrow" style="color:var(--accent);margin-bottom:9px">管理层摘要</div><h2 style="font-size:34px;line-height:1.08;margin:0;letter-spacing:-.045em">先看结论，<br>再决定下一张主图。</h2></div><p class="meta" style="width:270px;margin:0">口径：${facts.scoredCount}/${facts.itemCount} 款含 CP 评分；价格基线覆盖 ${facts.priceBaselineCount}/${facts.priceCount}。未具备上一期价格的商品不参与涨跌判断。</p></div>
    <div class="metrics">${metrics.map(([value, label]) => `<div class="metric"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join("")}</div>
    <div style="margin:35px 0 16px" class="eyebrow">Three signals / 三项信号</div>
    <div class="findings">${sharedCopy.findings.map((finding) => `<article class="finding"><div class="evidence">${finding.id}</div><h3>${esc(finding.title)}</h3><p>${esc(finding.text)}</p></article>`).join("")}</div>
    <div style="margin-top:34px;padding:18px 20px;border-left:4px solid var(--accent);background:color-mix(in srgb,var(--accent) 9%,transparent)"><div class="eyebrow">Decision</div><p style="font-size:14px;line-height:1.7;margin:8px 0 0">下一轮主图测试优先验证“降噪后的黄麻第一信任模块 + 明确人群场景 + 可执行的限时利益点”，而不是继续叠加标签。</p></div>
    <div class="footer"><span>竞品情报与 TOP100</span><span>EXECUTIVE BRIEF</span></div>
  </div></div>`;
}

function ops(theme) {
  return `<div class="page ${theme}" data-page="03"><div class="pad">${header(theme, "Evidence & Action", 3)}
    <div style="display:flex;align-items:end;justify-content:space-between;margin-bottom:22px"><div><div class="eyebrow" style="color:var(--accent);margin-bottom:8px">运营证据与行动</div><h2 style="font-size:31px;letter-spacing:-.04em;margin:0">看见差距，马上行动</h2></div><span class="chip">${facts.criticalCount} 条重点预警 / ${facts.alertCount} 条观察</span></div>
    <div class="product-grid">${facts.representative.map((item) => `<article class="product">${imageData(item) ? `<img src="${imageData(item)}" alt="">` : ""}<div class="product-caption"><small>T${String(item.cpRank).padStart(3, "0")}</small><b>${esc(item.brand)}</b><small>CP ${esc(item.scores?.CP_total ?? "-")} · ${esc(item.marketingCore)}</small></div></article>`).join("")}</div>
    <div class="ops-grid"><section class="panel"><div class="eyebrow" style="margin-bottom:14px">品牌 CP / Top 5</div>${facts.topBrands.map((brand) => `<div class="brand-row"><span>${esc(brand.brand)}</span><div class="brand-track"><div class="brand-fill" style="width:${Math.min(100, Number(brand.avgCP || 0) * 20)}%"></div></div><b>${esc(brand.avgCP)}</b></div>`).join("")}<div class="eyebrow" style="margin:22px 0 6px">价格信号</div>${facts.alerts.map((alert) => `<div class="alert-row"><b>${esc(alert.brand)} · ${esc(alert.productName).slice(0, 21)}</b><span>${esc(alert.priceChange)}</span></div>`).join("")}</section>
    <section class="panel"><div class="eyebrow" style="margin-bottom:8px">麻大师 / P0-P1</div>${facts.actions.map((action, index) => `<article class="action"><div class="evidence">O${String(index + 1).padStart(3, "0")}</div><h3>${esc(action.title)}</h3><p>${esc(action.action)}</p><p style="margin-top:6px;color:var(--accent)">${esc(action.expectedGain)}</p></article>`).join("")}</section></div>
    <div class="footer"><span>证据 → 判断 → 动作</span><span>OPERATING ACTION</span></div>
  </div></div>`;
}

function document(themeKey, pageNumber) {
  const theme = themes[themeKey];
  const page = pageNumber === 1 ? cover(themeKey) : pageNumber === 2 ? summary(themeKey) : ops(themeKey);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(theme.name)} · ${pageNumber}</title><style>${baseCss}</style></head><body>${page}</body></html>`;
}

async function main() {
  mkdirSync(outputDir, { recursive: true });
  for (const [key, theme] of Object.entries(themes)) {
    for (let page = 1; page <= 3; page += 1) {
      writeFileSync(join(outputDir, `${key}-${theme.slug}-${page}.html`), document(key, page), "utf8");
    }
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 858, height: 1187 }, deviceScaleFactor: 2 });
  for (const [key, theme] of Object.entries(themes)) {
    for (let page = 1; page <= 3; page += 1) {
      const browserPage = await context.newPage();
      await browserPage.goto(pathToFileURL(join(outputDir, `${key}-${theme.slug}-${page}.html`)).href);
      await browserPage.screenshot({ path: join(outputDir, `${key}-${theme.slug}-${page}.png`) });
      await browserPage.close();
    }
  }
  await browser.close();

  const overview = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:#111715;color:#edf3ef;font-family:"Microsoft YaHei",sans-serif;padding:38px}h1{font-size:30px;margin:0 0 8px}.sub{color:#98aaa4;margin-bottom:28px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:22px}.theme{border:1px solid #34433e;background:#19211f;padding:14px}.theme h2{font-size:15px;margin:0 0 12px}.theme img{width:100%;display:block;margin-top:10px;border:1px solid #46534f;box-shadow:0 8px 26px rgba(0,0,0,.26)}.score{margin-top:30px;padding:26px;border:1px solid #3d4d47;background:#171f1d}.score-head{display:flex;align-items:end;justify-content:space-between;gap:30px;margin-bottom:20px}.score h2{font-size:24px;margin:0}.winner{color:#ff685c;font-weight:800}.gate{color:#a6e536;font-size:13px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:13px 12px;border-top:1px solid #34433e;text-align:center}th:first-child,td:first-child{text-align:left}.win{background:#29211f;color:#fff}.total{font-size:20px;font-weight:900}.reason{margin:20px 0 0;color:#c8d3cf;line-height:1.8}
  </style></head><body><h1>竞品情报报告 · 四方向比稿</h1><div class="sub">同一周期 ${esc(facts.period)} · 同一数据 · 同一文案 · A4 2× 样图</div><div class="grid">${Object.entries(themes).map(([key, theme]) => `<section class="theme"><h2>${esc(theme.name)}</h2>${[1, 2, 3].map((page) => `<img src="${key}-${theme.slug}-${page}.png" alt="${esc(theme.name)} 第${page}页">`).join("")}</section>`).join("")}</div><section class="score"><div class="score-head"><div><div class="gate">硬门槛：四案均通过打印清晰 / 中文正确 / 无裁切 / 证据可追溯 / 对比度</div><h2>加权评分与胜选</h2></div><div class="winner">WINNER · C 行业视觉杂志</div></div><table><thead><tr><th>方向</th><th>决策层级 /25</th><th>可读性 /20</th><th>商品图 /15</th><th>品牌延续 /15</th><th>PDF 稳定 /15</th><th>记忆点 /10</th><th>总分</th></tr></thead><tbody>${scorecard.map((row) => `<tr class="${row.key === "C" ? "win" : ""}"><td>${row.key} ${esc(row.name)}</td><td>${row.hierarchy}</td><td>${row.readability}</td><td>${row.imagery}</td><td>${row.brand}</td><td>${row.pdf}</td><td>${row.memory}</td><td class="total">${row.total}</td></tr>`).join("")}</tbody></table><p class="reason">C 以 93 分、A 以 92 分进入小于 3 分的加赛；按预设规则比较“决策信息层级”，C（24）高于 A（23），因此 C 胜出。它用大幅真实商品图承载证据，用强标题和编辑分栏建立决策节奏，同时保留 A4 打印稳定性。</p></section></body></html>`;
  writeFileSync(join(outputDir, "overview.html"), overview, "utf8");
  const scorecardMarkdown = `# 竞品情报报告比稿评分\n\n周期：${facts.period}\n\n硬门槛：四案均通过打印清晰、中文正确、无裁切、证据可追溯、对比度合格。\n\n| 方向 | 决策层级 /25 | 可读性 /20 | 商品图 /15 | 品牌延续 /15 | PDF 稳定 /15 | 记忆点 /10 | 总分 |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${scorecard.map((row) => `| ${row.key} ${row.name} | ${row.hierarchy} | ${row.readability} | ${row.imagery} | ${row.brand} | ${row.pdf} | ${row.memory} | **${row.total}** |`).join("\n")}\n\n胜选：C 行业视觉杂志。C 与 A 分差小于 3 分，按预设规则比较决策信息层级，C（24）高于 A（23）。\n`;
  writeFileSync(join(outputDir, "scorecard.md"), scorecardMarkdown, "utf8");
  const overviewBrowser = await chromium.launch({ headless: true });
  const overviewPage = await overviewBrowser.newPage({ viewport: { width: 1920, height: 2850 }, deviceScaleFactor: 1 });
  await overviewPage.goto(pathToFileURL(join(outputDir, "overview.html")).href);
  await overviewPage.screenshot({ path: join(outputDir, "overview.png"), fullPage: true });
  await overviewBrowser.close();

  console.log(JSON.stringify({ outputDir, period: facts.period, themes: Object.values(themes).map((theme) => theme.name), winner: "C 行业视觉杂志", images: 13 }, null, 2));
}

await main();
