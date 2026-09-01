// 每期价格快照归档：读取抓取输出的价格 JSON，把当期主图下载留档到
// <dataDir>/intelligence/images/price-snapshots/<period>/，并生成
// <dataDir>/intelligence/price-snapshots/<period>.json（items 带 imageFile 指向留档图）。
// 用法：
//   node scripts/archive-price-snapshot.mjs --input <scrape-output.json> [--period 2026-09-01]
// 输入 JSON 为 CompetitorPriceItem 数组（含 id、couponPrice、mainImage 等）或 { period, items }。
// 之后 /api/intelligence/price-trend 会自动聚合多期快照，趋势弹窗展示各期真实主图。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.ECOM_DATA_DIR || join(root, "local-data");
const imagesDir = join(dataDir, "intelligence", "images", "price-snapshots");
const snapshotsDir = join(dataDir, "intelligence", "price-snapshots");

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? String(process.argv[idx + 1] || "").trim() : "";
}

const inputPath = argValue("--input");
if (!inputPath || !existsSync(inputPath)) {
  console.error("用法：node scripts/archive-price-snapshot.mjs --input <scrape-output.json> [--period 2026-09-01]");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(inputPath, "utf8"));
const items = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : null;
if (!items) throw new Error("输入 JSON 既不是数组也没有 items 字段");
const period = argValue("--period") || raw.period || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) throw new Error(`周期格式应为 YYYY-MM-DD，收到：${period}`);

// 只下载已验证的图片 CDN 白名单（alicdn）内的图片
function isAllowedImageUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "img.alicdn.com" || host.endsWith(".alicdn.com");
  } catch {
    return false;
  }
}

async function downloadImage(url, dest) {
  if (existsSync(dest)) return true; // 幂等：重复归档不重复下载
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "image/*" } });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) return false; // 过小视为失败图
    writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

mkdirSync(join(imagesDir, period), { recursive: true });
mkdirSync(snapshotsDir, { recursive: true });

let archived = 0;
let failed = 0;
let noImage = 0;
for (const item of items) {
  const url = typeof item.mainImage === "string" ? item.mainImage : "";
  if (!url.startsWith("http") || !isAllowedImageUrl(url)) {
    item.imageFile = null;
    noImage += 1;
    continue;
  }
  const ext = (url.match(/\.(jpe?g|png|webp|gif)(?:[?#]|$)/i)?.[1] || "jpg").toLowerCase();
  const fileName = `${item.id}.${ext}`;
  const ok = await downloadImage(url, join(imagesDir, period, fileName));
  if (ok) {
    // 相对 images/ 的留档路径，由 /competitor-images/ 路由按子路径访问
    item.imageFile = `price-snapshots/${period}/${fileName}`;
    archived += 1;
  } else {
    item.imageFile = null;
    failed += 1;
  }
}

const payload = {
  period,
  label: `${period}（${new Date().toISOString().slice(0, 10)} 归档）`,
  items,
};
writeFileSync(join(snapshotsDir, `${period}.json`), JSON.stringify(payload, null, 2) + "\n");
console.log(`[archive-price-snapshot] 周期 ${period}：${items.length} 条 | 主图留档 ${archived} | 下载失败 ${failed} | 无主图/非白名单 ${noImage}`);
console.log(`[archive-price-snapshot] 快照已写入 ${join(snapshotsDir, `${period}.json`)}`);
