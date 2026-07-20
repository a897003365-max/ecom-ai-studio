import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [replica, types, warehouse, styles] = await Promise.all([
  readFile(new URL("../src/components/PowerBiReplica.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/types/integration.ts", import.meta.url), "utf8"),
  readFile(new URL("../pipeline/ecom_pipeline/warehouse.py", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
]);

assert(/imageUrl/.test(types), "PowerBI 商品类型缺少图片链接字段");
assert(/\"商品图片\"/.test(warehouse), "本地数仓未读取商品图片链接字段");
assert(/img\.alicdn\.com/.test(warehouse), "商品图片链接未限制为允许的图片 CDN");
assert(/<img/.test(replica) && /pb-product-thumb/.test(replica), "PowerBI 页面未渲染商品图片缩略图");
assert(/promotion.*product|product.*promotion/i.test(replica), "推广费用明细未区分商品明细图片行");
assert(/pb-promotion-product-row/.test(styles), "推广商品明细未配置加高行样式");
assert(/pb-product-selector.*img|pb-product-thumb/.test(styles), "左侧商品列表未配置图片样式");
assert(/alt=/.test(replica), "商品图片缺少可访问的 alt 文本");

console.log("powerbi image contract ok");
