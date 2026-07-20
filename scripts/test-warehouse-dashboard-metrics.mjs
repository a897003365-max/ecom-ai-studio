import assert from "node:assert/strict";
import { buildWarehouseDashboardMetrics } from "../server/warehouse.mjs";

const snapshot = {
  powerbiPages: {
    period: { start: "2025-02-01", end: "2026-02-01" },
    overallDaily: [
      { date: "2025-02-01", visitors: 50, addToCart: 10, payBuyers: 5, payAmount: 1000 },
      { date: "2026-01-01", visitors: 80, addToCart: 16, payBuyers: 8, payAmount: 1200 },
      { date: "2026-02-01", visitors: 100, addToCart: 20, payBuyers: 10, payAmount: 2000 },
    ],
    productDaily: [
      { date: "2025-02-01", payAmount: 800, paidUnits: 8 },
      { date: "2026-01-01", payAmount: 900, paidUnits: 9 },
      { date: "2026-02-01", payAmount: 1800, paidUnits: 12 },
    ],
    promotionSceneDaily: [
      { date: "2025-02-01", spend: 750, revenue: 1500 },
      { date: "2026-01-01", spend: 900, revenue: 1800 },
      { date: "2026-02-01", spend: 1000, revenue: 3000 },
    ],
  },
};

const result = buildWarehouseDashboardMetrics(snapshot, {
  start: "2026-02-01",
  end: "2026-02-01",
});

assert.equal(result.source, "powerbi_local_warehouse");
assert.equal(result.available, true);
assert.deepEqual(result.coverage, { start: "2025-02-01", end: "2026-02-01" });
assert.deepEqual(result.period, { start: "2026-02-01", end: "2026-02-01" });
assert.equal(result.metrics.visitors, 100);
assert.equal(result.metrics.payBuyers, 10);
assert.equal(result.metrics.addToCart, 20);
assert.equal(result.metrics.paymentConversion, 0.1);
assert.equal(result.metrics.addToCartRate, 0.2);
assert.equal(result.metrics.clientAvgPrice, 200);
assert.equal(result.metrics.itemAvgPrice, 150);
assert.equal(result.metrics.promotionSpend, 1000);
assert.equal(result.metrics.promotionRevenue, 3000);
assert.equal(result.metrics.promotionRoi, 3);
assert.equal(result.trends.visitors.mom, 0.25);
assert.equal(result.trends.visitors.yoy, 1);
assert.ok(Math.abs(result.trends.clientAvgPrice.mom - 1 / 3) < 1e-12);
assert.equal(result.trends.clientAvgPrice.yoy, 0);
assert.equal(result.trends.itemAvgPrice.mom, 0.5);
assert.equal(result.trends.itemAvgPrice.yoy, 0.5);
assert.equal(result.trends.promotionRoi.mom, 0.5);
assert.equal(result.trends.promotionRoi.yoy, 0.5);

const unavailable = buildWarehouseDashboardMetrics(snapshot, {
  start: "2024-01-01",
  end: "2024-01-31",
});
assert.equal(unavailable.available, false);
assert.equal(unavailable.metrics, null);
assert.equal(unavailable.trends, null);

console.log("warehouse dashboard metrics: ok");
