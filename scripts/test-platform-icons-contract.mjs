import { readFile } from "node:fs/promises";
import { platformBrand } from "../src/components/platformBrand.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const currentChannels = ["天猫", "京东", "抖音", "拼多多", "唯品"];
const brands = currentChannels.map(platformBrand);

assert(brands.every((brand, index) => brand.platform === currentChannels[index]), "渠道品牌定义未保留可见渠道名");
assert(new Set(brands.map((brand) => brand.icon)).size === currentChannels.length, "当前五个渠道必须使用互不相同的专属图标");
assert(brands.every((brand) => brand.tone && brand.shortLabel), "渠道图标缺少品牌色或一眼可辨的短标识");
assert(platformBrand("未知渠道").icon === "store", "未知渠道必须回退到通用店铺图标");

const badge = await readFile(new URL("../src/components/PlatformBadge.tsx", import.meta.url), "utf8");
assert(badge.includes("PlatformBrandIcon") && badge.includes("platform-brand-icon"), "渠道标识组件未渲染专属品牌图标");
assert(badge.includes('data-testid="platform-badge"') && badge.includes("aria-label"), "渠道图标缺少稳定定位或可访问名称");
assert(badge.includes("platform-brand-name"), "渠道图标旁必须保留渠道名，避免只靠颜色识别");

console.log("platform icons contract ok");
