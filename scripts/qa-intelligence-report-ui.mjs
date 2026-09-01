import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.REPORT_QA_BASE_URL || "http://127.0.0.1:5191";
const outputDir = join(process.cwd(), "output", "report-ui-qa");
mkdirSync(outputDir, { recursive: true });
const sizes = [1440, 1280, 1024, 768, 390, 375];
const report = {
  id: "2026-08-25",
  title: "床垫行业 TOP100 竞争特刊",
  period: "2026-08-25",
  generatedAt: "2026-08-28T04:07:02.245Z",
  provider: "ark",
  model: "deepseek-v4-flash-ga-260731",
  itemCount: 100,
  priceCount: 82,
  pageCount: 15,
  previewUrl: "/api/intelligence/reports/2026-08-25",
  pdfUrl: "/api/intelligence/reports/2026-08-25.pdf",
  markdownUrl: "/api/intelligence/reports/2026-08-25.md",
};

const browser = await chromium.launch({ headless: true });
const results = [];
for (const width of sizes) {
  const context = await browser.newContext({ viewport: { width, height: width <= 390 ? 780 : 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.route("**/api/intelligence/report", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report) });
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "竞品情报 / TOP100", exact: true }).first().click();
  const trigger = page.getByRole("button", { name: "📝 生成汇报报告" });
  await trigger.waitFor({ state: "visible" });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  const frame = page.frameLocator('iframe[title="床垫行业 TOP100 竞争特刊网页预览"]');
  await frame.locator("h1.display").waitFor({ state: "visible" });
  const dimensions = await page.evaluate(() => {
    const studio = document.querySelector(".intelligence-report-studio");
    const viewport = document.querySelector(".intelligence-report-studio__viewport");
    const canvas = document.querySelector(".intelligence-report-studio__canvas");
    const studioRect = studio?.getBoundingClientRect();
    return {
      rootOverflow: document.documentElement.scrollWidth > window.innerWidth,
      studioLeft: studioRect?.left,
      studioRight: studioRect?.right,
      viewportOverflowY: viewport ? viewport.scrollHeight >= viewport.clientHeight : false,
      canvasWidth: canvas?.getBoundingClientRect().width,
    };
  });
  assert.equal(dimensions.rootOverflow, false, `${width}px 不得产生根级横向溢出`);
  assert.equal(Math.round(dimensions.studioLeft), 0, `${width}px 工作台必须贴合左边界`);
  assert.equal(Math.round(dimensions.studioRight), width, `${width}px 工作台必须贴合右边界`);
  assert.equal(consoleErrors.length, 0, `${width}px 控制台错误：${consoleErrors.join(" | ")}`);
  await page.screenshot({ path: join(outputDir, `report-studio-${width}.png`), fullPage: true });
  if (width === 1440) {
    await page.getByRole("button", { name: "100%" }).click();
    const actualWidth = await page.locator(".intelligence-report-studio__canvas").evaluate((node) => node.getBoundingClientRect().width);
    assert.equal(Math.round(actualWidth), 900, "100% 模式必须使用固定 900px 预览画布");
  }
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.textContent?.includes("生成汇报报告"), null, { timeout: 2000 });
  assert.equal(await trigger.evaluate((node) => document.activeElement === node), true, "Escape 关闭后焦点应回到生成按钮");
  results.push({ width, ...dimensions, consoleErrors: consoleErrors.length });
  await context.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
