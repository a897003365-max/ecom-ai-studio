import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the actual route body with isolated snapshot/query boundaries; no server startup or sync.
const source = readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');
const guard = source.slice(source.indexOf('function hasCurrentProductManagementMetrics('), source.indexOf('\nfunction dingtalkAutomationStatus'));
const route = source.slice(source.indexOf('  if (request.method === "GET" && path === "/api/products")'), source.indexOf('  // yudao 业务管理后台只读代理'));
const current = {
  kpis: { totalReceivedAmount: 10, collectionRate: .9 }, fulfillmentByProduct: [],
  monthlyComparison: { currentPeriod: {} }, previousDailyTrend: [],
  warehouseStatusDaily: { start: '2026-07-01', end: '2026-07-03', rows: [] },
};
async function run(snapshotPages, query = '', failure = false) {
  let calls = 0;
  const context = vm.createContext({
    request: { method: 'GET' }, path: '/api/products', url: new URL(`http://localhost/api/products${query}`),
    response: {}, readWarehouseSnapshot: async () => ({ productManagement: snapshotPages, refreshedAt: 'test' }),
    queryProductsOnDemand: async () => { calls++; if (failure) throw new Error('fixture query failure'); return { productManagement: current }; },
    sendJsonCached: (_response, payload) => payload, sendJson: (_response, _status, payload) => payload,
  });
  const payload = await vm.runInContext(`${guard}\n(async () => { ${route} })()`, context);
  return { payload, calls };
}
assert.equal((await run(current)).calls, 0);
const old = structuredClone(current);
delete old.warehouseStatusDaily;
const refreshed = await run(old);
assert.equal(refreshed.calls, 1);
assert.ok(refreshed.payload.productManagement.warehouseStatusDaily);
assert.equal((await run(current, '?start=2026-07-01&end=2026-07-03')).calls, 1);
const failed = await run(old, '', true);
assert.equal(failed.payload.status, 'stale');
assert.equal(failed.payload.productManagement, null);
console.log('Warehouse daily API: current snapshot, old snapshot recompute, filtered query, failure passed.');
