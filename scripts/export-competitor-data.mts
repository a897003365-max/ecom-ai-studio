// 导出 tmallCompetitorData.ts 中的数据为 JSON
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  tmallCompetitorPrices,
  tmallPricePeriods,
  tmallSkuDetails,
  tmallSkuTrendDays,
  tmallCompetitorStores,
  tmallScrapedAt,
} from "../src/data/tmallCompetitorData.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "local-data", "intelligence");
mkdirSync(outDir, { recursive: true });

function save(name, data) {
  const path = join(outDir, name);
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  console.log(`  ${name}: ${JSON.stringify(data).length} bytes`);
}

console.log("Exporting competitor price data...");
console.log(`  scrapedAt: ${tmallScrapedAt}`);
console.log(`  prices: ${tmallCompetitorPrices.length} items`);
console.log(`  periods: ${tmallPricePeriods.length} periods`);
console.log(`  skuDetails: ${Object.keys(tmallSkuDetails).length} products`);
console.log(`  skuTrendDays: ${tmallSkuTrendDays.length} days`);
console.log(`  stores: ${tmallCompetitorStores.length} stores`);

save("competitor-prices.json", {
  scrapedAt: tmallScrapedAt,
  items: tmallCompetitorPrices,
  total: tmallCompetitorPrices.length,
});

save("competitor-price-periods.json", {
  periods: tmallPricePeriods,
});

save("competitor-sku-details.json", {
  details: tmallSkuDetails,
  trendDays: tmallSkuTrendDays,
});

save("competitor-stores.json", {
  stores: tmallCompetitorStores,
});

console.log("Done.");
