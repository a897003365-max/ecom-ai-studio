import assert from "node:assert/strict";
import { buildWarehouseDashboardMetrics } from "../server/warehouse.mjs";

const snapshot = {
  powerbiPages: {
    period: { start: "2026-05-18", end: "2026-07-16" },
    overallDaily: [
      { date: "2026-05-18", visitors: 10, addToCart: 2, payBuyers: 1, payAmount: 100 },
      { date: "2026-05-30", visitors: 10, addToCart: 2, payBuyers: 1, payAmount: 100 },
      { date: "2026-06-01", visitors: 20, addToCart: 4, payBuyers: 2, payAmount: 200 },
      { date: "2026-06-30", visitors: 20, addToCart: 4, payBuyers: 2, payAmount: 200 },
      { date: "2026-07-16", visitors: 30, addToCart: 6, payBuyers: 3, payAmount: 300 },
    ],
    productDaily: [
      { date: "2026-05-18", payAmount: 80, paidUnits: 1 },
      { date: "2026-05-30", payAmount: 80, paidUnits: 1 },
      { date: "2026-06-01", payAmount: 160, paidUnits: 2 },
      { date: "2026-06-30", payAmount: 160, paidUnits: 2 },
      { date: "2026-07-16", payAmount: 240, paidUnits: 3 },
    ],
    promotionSceneDaily: [
      { date: "2026-05-18", spend: 10, revenue: 100 },
      { date: "2026-05-30", spend: 10, revenue: 100 },
      { date: "2026-06-01", spend: 20, revenue: 200 },
      { date: "2026-06-30", spend: 20, revenue: 200 },
      { date: "2026-07-16", spend: 30, revenue: 300 },
    ],
  },
};

const partialCurrent = buildWarehouseDashboardMetrics(snapshot, {
  start: "2026-05-01",
  end: "2026-05-30",
});
assert.equal(partialCurrent.available, true);
assert.equal(partialCurrent.coverageComplete, false);
assert.equal(partialCurrent.partial, true);
assert.equal(partialCurrent.trends.visitors.mom, null);
assert.equal(partialCurrent.trends.visitors.yoy, null);

const incompleteComparison = buildWarehouseDashboardMetrics(snapshot, {
  start: "2026-06-01",
  end: "2026-06-30",
});
assert.equal(incompleteComparison.coverageComplete, true);
assert.equal(incompleteComparison.partial, false);
assert.equal(incompleteComparison.trends.visitors.mom, null);

console.log("warehouse dashboard coverage: ok");
