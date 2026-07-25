import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const tempRoot = await mkdtemp(join(tmpdir(), "ecom-product-management-"));
const port = 5900 + Math.floor(Math.random() * 150);
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server/index.mjs", "--production"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    AUTH_ENFORCEMENT_ENABLED: "0",
    AUTH_STORE_PATH: join(tempRoot, "auth-store.json"),
    HOST: "127.0.0.1",
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
child.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
child.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`商品管理测试服务提前退出：${serverOutput.slice(-1000)}`);
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`商品管理测试服务启动超时：${serverOutput.slice(-1000)}`);
}

try {
  await waitForServer();
  const response = await fetch(`${baseUrl}/api/products`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  const kpis = payload.productManagement?.kpis;
  assert.ok(kpis, "商品管理默认接口必须返回 KPI");
  assert.ok(Object.hasOwn(kpis, "totalReceivedAmount"), "商品管理必须返回商家实收");
  assert.ok(Object.hasOwn(kpis, "collectionRate"), "商品管理必须返回回款率");
  assert.equal(Object.hasOwn(kpis, "totalShippedAmount"), false, "商品管理默认接口不得返回实发金额");
  assert.equal(Object.hasOwn(kpis, "totalShippedUnits"), false, "商品管理默认接口不得返回实发量");
  const pages = payload.productManagement;
  assert.ok(pages.monthlyTrend.some((row) => Number(row.receivedAmount) > 0), "月度商家实收不得全部为 0");
  assert.ok(pages.dailyTrend.some((row) => Number(row.receivedAmount) > 0), "每日商家实收不得全部为 0");
  assert.ok(pages.storeBreakdown.some((row) => Number(row.receivedAmount) > 0), "店铺商家实收不得全部为 0");
  assert.ok(Array.isArray(pages.fulfillmentByProduct), "商品管理必须返回按产品名称的仓配履约表");
  assert.ok(pages.fulfillmentByProduct.some((row) => Number(row.orderCount) > 0), "仓配履约表必须包含订单量");
  assert.ok(pages.fulfillmentByProduct.some((row) => Object.hasOwn(row, "avgShippingDays")), "仓配履约表必须包含平均发货时效");
  assert.ok(pages.priceStructure, "商品管理必须返回价格结构");
  assert.ok(Array.isArray(pages.priceStructure.buckets), "价格结构必须返回分桶数组");
  assert.ok(pages.priceStructure.quality, "价格结构必须返回 quality");
  assert.ok(pages.sizeStructure, "商品管理必须返回尺寸结构");
  assert.ok(pages.sizeStructure.unknownSize, "尺寸结构必须返回未填写尺寸行");
  assert.ok(pages.spuSalesTrend, "商品管理必须返回 SPU 销量趋势");
  assert.ok(Array.isArray(pages.spuSalesTrend.dailySpuTrend), "SPU 销量趋势必须返回日趋势数组");
  assert.ok(pages.customizationStructure, "商品管理必须返回定制结构");
  assert.ok(Array.isArray(pages.customizationStructure.tags), "定制结构必须返回标签数组");
  console.log("product management current contract: ok");
} finally {
  child.kill();
  await new Promise((resolveExit) => child.once("exit", resolveExit));
  await rm(tempRoot, { recursive: true, force: true });
}
