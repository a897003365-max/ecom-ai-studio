import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { searchSite, parsePeriod, matchMetrics, matchEntities, buildEntityIndex, answerFromSnapshots } from "../server/search-service.mjs";

const db = new DatabaseSync(new URL("../local-data/ecom-ai-studio.sqlite", import.meta.url).pathname);
const dingtalkRow = db.prepare("SELECT snapshot_json FROM sync_runs WHERE source_id=? AND status=? AND snapshot_json IS NOT NULL ORDER BY started_at DESC LIMIT 1").get("dingtalk", "success");
if (!dingtalkRow) throw new Error("缺少钉钉快照，无法运行搜索 API 测试");
const dingtalk = JSON.parse(dingtalkRow.snapshot_json);
const warehouse = JSON.parse(readFileSync(new URL("../local-data/warehouse/analytics-snapshot.json", import.meta.url), "utf8"));

const ctx = {
  dingtalk,
  dingtalkMeta: { finishedAt: dingtalk.refreshedAt },
  warehouse,
  warehouseMtime: Date.now(),
  warehouseRefreshedAt: warehouse.refreshedAt,
};
const admin = { role: "admin", permissions: ["analytics.view", "products.view"] };
const analyticsOnly = { role: "member", permissions: ["analytics.view"] };
const nobody = { role: "member", permissions: [] };

// helper：断言无 Infinity/NaN/伪造 0
function assertFinite(value, label) {
  assert.ok(value === null || Number.isFinite(value), `${label} 应为有限数或 null，实际 ${value}`);
}

// ---------------------------------------------------------------------------
// 1. 8月天猫退款率
// ---------------------------------------------------------------------------
{
  const r = await searchSite({ query: "8月天猫退款率", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.equal(r.status, "ok", "8月天猫退款率应 ok");
  assert.equal(r.interpretation.scope, "analytics", "应解析为经营");
  assert.equal(r.interpretation.entity?.kind, "channel", "应识别天猫渠道");
  assert.equal(r.interpretation.entity?.id, "天猫", "实体应为天猫");
  assert.ok(r.interpretation.metricIds.includes("analytics.refund_rate"), "应包含退款率指标");
  assert.ok(r.interpretation.period?.label.includes("8月"), "应解析为 8 月");
  const answer = r.answers.find((a) => a.metricId === "analytics.refund_rate");
  assert.ok(answer, "缺少退款率答案");
  assert.equal(answer.source, "dingtalk", "来源应为钉钉");
  assert.ok(answer.period, "答案应包含统计周期");
  assert.ok(answer.refreshedAt, "答案应包含更新时间");
  assert.ok(answer.definition, "答案应包含指标定义");
  // rawValue 与同周期钉钉平台行一致
  const filtered = (await import("../server/dingtalk-api.mjs")).filterDingTalkSnapshot(dingtalk, { start: answer.period.start, end: answer.period.end });
  const tmall = filtered.platforms.find((p) => p.platform === "天猫");
  assert.ok(tmall, "同周期应存在天猫平台行");
  const expected = tmall.refundRate ?? tmall.refund / tmall.gmv;
  assert.ok(Math.abs(answer.rawValue - expected) < 1e-9, `退款率 rawValue 应与钉钉平台行一致 ${answer.rawValue} vs ${expected}`);
}

// ---------------------------------------------------------------------------
// 2. 豆7销量和退货率
// ---------------------------------------------------------------------------
{
  const r = await searchSite({ query: "豆7销量和退货率", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.equal(r.status, "ok", "豆7销量和退货率应 ok");
  assert.equal(r.interpretation.scope, "products", "应解析为商品");
  assert.equal(r.interpretation.entity?.id, "豆7", "实体应为豆7");
  assert.equal(r.answers.length, 2, "应返回两个答案卡");
  const sales = r.answers.find((a) => a.metricId === "products.sales_units");
  const refund = r.answers.find((a) => a.metricId === "products.refund_rate");
  assert.ok(sales && refund, "应包含销量与退货率答案");
  const dou7 = warehouse.productManagement.productNameOverview.find((row) => row.productName === "豆7");
  assert.equal(sales.rawValue, dou7.salesUnits, "销量应与 productNameOverview 一致");
  assert.equal(refund.rawValue, dou7.refundRate, "退货率应与 productNameOverview 一致");
  assert.equal(sales.source, "warehouse", "商品答案来源应为数仓");
}

// ---------------------------------------------------------------------------
// 3. M5209 多义
// ---------------------------------------------------------------------------
{
  const r = await searchSite({ query: "M5209", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.equal(r.status, "ambiguous", "M5209 应返回 ambiguous");
  const names = r.results.map((x) => x.title);
  assert.ok(names.includes("豆芽2.0"), "应包含豆芽2.0");
  assert.ok(names.includes("豆芽3.0"), "应包含豆芽3.0");
  assert.equal(r.answers.length, 0, "多义商品不应生成答案卡");
}

// ---------------------------------------------------------------------------
// 4. 7月豆7退货率 → navigate_required
// ---------------------------------------------------------------------------
{
  const r = await searchSite({ query: "7月豆7退货率", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.equal(r.status, "navigate_required", "7月豆7退货率应 navigate_required");
  const target = r.results[0]?.target;
  assert.equal(target?.page, "products", "目标应为商品页");
  assert.equal(target?.filters?.start, "2026-07-01", "应带 7 月起始日期");
  assert.equal(target?.filters?.end, "2026-07-31", "应带 7 月结束日期");
  assert.equal(target?.focus?.value, "豆7", "应带豆7焦点");
}

// ---------------------------------------------------------------------------
// 5. 仓配履约在哪里
// ---------------------------------------------------------------------------
{
  const r = await searchSite({ query: "仓配履约在哪里", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.equal(r.status, "ok", "仓配履约应 ok");
  const t = r.results.find((x) => x.target?.page === "products")?.target;
  assert.equal(t?.tab, "fulfillment", "仓配履约应定位到 fulfillment 页签");
}

// ---------------------------------------------------------------------------
// 6. 费比怎么算 → 定义
// ---------------------------------------------------------------------------
{
  const r = await searchSite({ query: "费比怎么算", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.equal(r.status, "ok", "费比怎么算应 ok");
  assert.equal(r.interpretation.intent, "definition", "应识别为定义意图");
  const answer = r.answers[0];
  assert.ok(answer, "应返回定义答案");
  assert.ok(answer.definition.includes("推广费"), "定义应含费比口径");
}

// ---------------------------------------------------------------------------
// 7. 权限隔离：无 products.view 看不到商品实体
// ---------------------------------------------------------------------------
{
  const r = await searchSite({ query: "豆7", mode: "answer", user: analyticsOnly, permissions: analyticsOnly.permissions }, ctx);
  // 无商品权限：不应返回商品页目标或商品实体答案
  const productTargets = r.results.filter((x) => x.target?.page === "products");
  assert.equal(productTargets.length, 0, "无 products.view 不应返回商品页导航");
  const warehouseAnswers = r.answers.filter((a) => a.source === "warehouse");
  assert.equal(warehouseAnswers.length, 0, "无 products.view 不应返回商品答案");
}

// ---------------------------------------------------------------------------
// 8. 0 分母 / null / 缺失快照 / 超范围日期 → 不产生 Infinity/NaN/伪造 0
// ---------------------------------------------------------------------------
{
  // 0 分母：构造一个 gmv=0 的指标快照，回款率应为 null 而非 Infinity
  const emptyDing = JSON.parse(JSON.stringify(dingtalk));
  emptyDing.reporting.dailyPlatforms = [{ date: "2026-08-01", platform: "天猫", gmv: 0, netRevenue: 0, spend: 0, refund: 0, addToCart: 0, exposure: 0, clicks: 0, paidOrders: 0, favorite: 0, target: 0, budget: 0 }];
  const r0 = await searchSite({ query: "8月退款率", mode: "answer", user: admin, permissions: admin.permissions }, { ...ctx, dingtalk: emptyDing });
  const a0 = r0.answers[0];
  if (a0) assertFinite(a0.rawValue, "0分母退款率");
  // 缺失快照：数仓为 null → 商品答案 unavailable 但仍给商品管理入口
  const rMissing = await searchSite({ query: "豆7销量", mode: "answer", user: admin, permissions: admin.permissions }, { ...ctx, warehouse: null });
  assert.equal(rMissing.status, "unavailable", "数仓缺失应 unavailable 或 ok");
  const warehouseEntries = rMissing.results.filter((x) => x.target?.page === "products");
  assert.ok(warehouseEntries.length > 0, "数仓缺失仍应返回商品管理入口");
  // 超范围日期：遥不可及的未来月份 → 无交集
  const rFuture = await searchSite({ query: "2029年8月退款率", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  for (const a of rFuture.answers) assertFinite(a.rawValue, "超范围日期答案");
}

// ---------------------------------------------------------------------------
// 纯函数单元测试
// ---------------------------------------------------------------------------
{
  const index = buildEntityIndex({ dingtalk, warehouse });
  const m = matchEntities("M5209", index);
  assert.equal(m?.entity?.kind, "spu", "M5209 应匹配为 SPU");
  const metrics = matchMetrics("8月天猫退款率");
  assert.ok(metrics.some((x) => x.metric.id === "analytics.refund_rate"), "应匹配退款率经营指标");
  const period = parsePeriod("8月", { completedThrough: "2026-08-03" });
  assert.equal(period.start, "2026-08-01", "8月应为 8 月 1 日起");
  // 客单价不得映射为件单价
  const avgPrice = matchMetrics("客单价");
  assert.ok(!avgPrice.some((x) => x.metric.id === "products.avg_unit_price"), "客单价不得映射为件单价");
}

// ---------------------------------------------------------------------------
// 9. 口语时间词与默认周期（2026-08-05 用户体验优化：禁止静默全周期错答）
// ---------------------------------------------------------------------------
{
  // 昨天 → 最新完整数据日，不再静默全周期
  const r1 = await searchSite({ query: "昨天退款率", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.equal(r1.status, "ok", "昨天退款率应 ok");
  assert.equal(r1.interpretation.period?.start, "2026-08-03", "昨天应落到最新完整数据日");
  assert.equal(r1.interpretation.period?.end, "2026-08-03");
  assert.equal(r1.answers[0]?.period?.start, "2026-08-03", "答案卡应回填实际周期");
  // 上个月 → 完整上月
  const r2 = await searchSite({ query: "上个月GMV", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.equal(r2.interpretation.period?.start, "2026-07-01", "上个月应为 7 月 1 日起");
  assert.equal(r2.interpretation.period?.end, "2026-07-31", "上个月应为 7 月 31 日止");
  // 这个月 → 本月 MTD
  const r3 = await searchSite({ query: "这个月回款", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.equal(r3.interpretation.period?.start, "2026-08-01", "这个月应为本月起");
  assert.equal(r3.interpretation.period?.end, "2026-08-03", "这个月应到最新数据日");
  // 单日不再静默扩成整月
  const r4 = await searchSite({ query: "8月1日天猫退款率", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.equal(r4.interpretation.period?.start, "2026-08-01");
  assert.equal(r4.interpretation.period?.end, "2026-08-01", "8月1日应为单日");
  // 裸指标默认本月 MTD，答案卡带实际周期
  const r5 = await searchSite({ query: "退款率", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.equal(r5.answers[0]?.period?.start, "2026-08-01", "裸指标应默认本月");
  assert.equal(r5.answers[0]?.period?.end, "2026-08-03");
}

// ---------------------------------------------------------------------------
// 10. 排名意图：渠道维度 Top 答案卡，不再静默改答全渠道值
// ---------------------------------------------------------------------------
{
  const r = await searchSite({ query: "退款率最高的渠道", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.equal(r.status, "ok", "排名查询应 ok");
  assert.equal(r.interpretation.intent, "ranking", "应识别排名意图");
  assert.ok(r.answers.length >= 1, "应返回排名答案卡");
  assert.ok(r.answers[0].scopeLabel !== "全渠道", "排名首卡应为具体渠道而非全渠道");
  // 与快照口径对账：默认周期（本月 MTD）各平台退款率最大值
  const { filterDingTalkSnapshot } = await import("../server/dingtalk-api.mjs");
  const filtered = filterDingTalkSnapshot(dingtalk, { start: "2026-08-01", end: "2026-08-03" });
  const expected = Math.max(...filtered.platforms.map((p) => p.refundRate ?? p.refund / p.gmv));
  assert.ok(Math.abs(r.answers[0].rawValue - expected) < 1e-9, `排名第一应与快照平台行一致 ${r.answers[0].rawValue} vs ${expected}`);
  // 商品维度排名：明示导航，不给静默错答
  const rp = await searchSite({ query: "销量最高的商品", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.equal(rp.interpretation.intent, "ranking");
  assert.equal(rp.answers.length, 0, "商品排名不应生成数值答案卡");
  assert.ok(rp.results.some((x) => x.target?.page === "products"), "商品排名应导航到商品页");
}

// ---------------------------------------------------------------------------
// 11. 裸实体兜底、变体归一化、全局商品 KPI、页面导航权限
// ---------------------------------------------------------------------------
{
  const r1 = await searchSite({ query: "豆7", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.equal(r1.status, "ok", "裸商品不应再 unsupported");
  assert.ok(r1.answers.some((a) => a.metricId === "products.sales_units"), "裸商品应带销量卡");
  assert.ok(r1.answers.every((a) => a.scopeLabel === "豆7"), "裸商品答案应限定该商品");
  const r2 = await searchSite({ query: "天猫", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.equal(r2.status, "ok", "裸渠道不应再 unsupported");
  assert.ok(r2.answers.length > 0, "裸渠道应返回核心指标卡");
  assert.equal(r2.answers[0].scopeLabel, "天猫", "裸渠道答案应限定该渠道");
  const r3 = await searchSite({ query: "豆七销量", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.equal(r3.status, "ok", "中文数字变体应命中豆7");
  assert.equal(r3.answers[0]?.scopeLabel, "豆7");
  // 全局商品 KPI 直通：无实体也可回答
  const r4 = await searchSite({ query: "待发货件数", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.equal(r4.status, "ok", "全局商品 KPI 应可回答");
  assert.equal(r4.answers[0]?.rawValue, warehouse.productManagement.kpis.pendingUnits, "待发货件数应取全局 kpi");
  // 后端页面导航权限修复：权限串 `${page}.view` 映射页面 id
  const r5 = await searchSite({ query: "竞品", mode: "answer", user: admin, permissions: admin.permissions }, ctx);
  assert.ok(r5.results.some((x) => x.target?.page === "intelligence"), "竞品应导航到竞品情报页");
}

console.log("global-search api: ok");