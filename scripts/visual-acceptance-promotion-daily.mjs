import { chromium } from "playwright";
import { existsSync } from "node:fs";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:5173";
const OUTPUT_DIR = process.cwd();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSpinnerGone(page, timeout = 30000) {
  try {
    await page.waitForSelector('[aria-label="页面加载中"], .page-suspense-fallback, .analytics-loading', { state: "detached", timeout });
  } catch {
    // ignore
  }
}

async function waitForStable(page, selector) {
  await page.waitForSelector(selector, { state: "visible", timeout: 30000 });
  await sleep(400);
}

async function screenshotElement(page, selector, path) {
  const element = await page.locator(selector).first();
  await element.scrollIntoViewIfNeeded();
  await sleep(200);
  await element.screenshot({ path });
}

async function main() {
  if (!existsSync(OUTPUT_DIR)) {
    throw new Error(`Output directory does not exist: ${OUTPUT_DIR}`);
  }

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();

  try {
    console.log(`Navigating to ${BASE_URL}`);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await waitForSpinnerGone(page);
    await sleep(800);

    // 1. Open 运营数据看板 from sidebar
    const navButton = page.locator(".sidebar .nav-item").getByText(/运营数据看板/);
    await navButton.waitFor({ state: "visible", timeout: 15000 });
    await navButton.click();
    await waitForSpinnerGone(page);
    await sleep(800);

    // 2. Switch workspace to 天猫明细
    const tmallTab = page.getByRole("tab", { name: "天猫明细" });
    await waitForStable(page, '[role="tab"]:has-text("天猫明细")');
    await tmallTab.click();
    await waitForSpinnerGone(page);
    await sleep(600);

    // 3. Switch to 推广费用明细
    const promotionTab = page.locator(".pb-replica-toolbar nav button").getByText("推广费用明细");
    await promotionTab.waitFor({ state: "visible", timeout: 15000 });
    await promotionTab.click();
    await waitForSpinnerGone(page);
    await sleep(600);

    // 4. Wait for 每日推广费用 table
    const dailyTableSection = page.locator('[data-testid="promotion-daily-spend-table"]');
    await dailyTableSection.waitFor({ state: "visible", timeout: 20000 });
    await sleep(400);

    // Screenshot default state (full page section)
    const defaultPath = `${OUTPUT_DIR}/promotion-daily-collapse-default.png`;
    await screenshotElement(page, '[data-testid="promotion-daily-spend-table"]', defaultPath);
    console.log(`Saved: ${defaultPath}`);

    // 5. Toggle first month: first expand if collapsed, screenshot expanded, then collapse, screenshot collapsed
    const monthToggle = dailyTableSection.locator('[data-testid="promotion-daily-month-toggle"]').first();
    await monthToggle.waitFor({ state: "visible", timeout: 10000 });
    let monthExpandedBefore = await monthToggle.getAttribute("aria-expanded");
    console.log(`Month toggle aria-expanded before: ${monthExpandedBefore}`);

    if (monthExpandedBefore === "false") {
      await monthToggle.click();
      await sleep(600);
    }
    const monthExpandedPath = `${OUTPUT_DIR}/promotion-daily-collapse-month-expanded.png`;
    await screenshotElement(page, '[data-testid="promotion-daily-spend-table"]', monthExpandedPath);
    console.log(`Saved: ${monthExpandedPath}`);

    // Now collapse it
    const monthToggleAfter = dailyTableSection.locator('[data-testid="promotion-daily-month-toggle"]').first();
    const monthExpandedAfter = await monthToggleAfter.getAttribute("aria-expanded");
    console.log(`Month toggle aria-expanded after expand: ${monthExpandedAfter}`);
    if (monthExpandedAfter === "true") {
      await monthToggleAfter.click();
      await sleep(600);
    }
    const monthCollapsedPath = `${OUTPUT_DIR}/promotion-daily-collapse-month.png`;
    await screenshotElement(page, '[data-testid="promotion-daily-spend-table"]', monthCollapsedPath);
    console.log(`Saved: ${monthCollapsedPath}`);

    // 6. Ensure year is expanded then collapse it
    const yearToggle = dailyTableSection.locator('[data-testid="promotion-daily-year-toggle"]').first();
    await yearToggle.waitFor({ state: "visible", timeout: 10000 });
    let yearExpandedBefore = await yearToggle.getAttribute("aria-expanded");
    console.log(`Year toggle aria-expanded before: ${yearExpandedBefore}`);
    if (yearExpandedBefore === "false") {
      await yearToggle.click();
      await sleep(600);
    }
    const yearToggleExpanded = dailyTableSection.locator('[data-testid="promotion-daily-year-toggle"]').first();
    const yearExpandedCheck = await yearToggleExpanded.getAttribute("aria-expanded");
    if (yearExpandedCheck === "true") {
      await yearToggleExpanded.click();
      await sleep(600);
    }

    const yearCollapsedPath = `${OUTPUT_DIR}/promotion-daily-collapse-year.png`;
    await screenshotElement(page, '[data-testid="promotion-daily-spend-table"]', yearCollapsedPath);
    console.log(`Saved: ${yearCollapsedPath}`);

    // 7. Switch to 旗舰店整体 tab and screenshot 每天核心数据 table
    const overallTab = page.locator(".pb-replica-toolbar nav button").getByText("旗舰店整体");
    await overallTab.waitFor({ state: "visible", timeout: 15000 });
    await overallTab.click();
    await waitForSpinnerGone(page);
    await sleep(600);

    const dailyCoreTable = page.locator('[data-testid="powerbi-daily-core-table"]');
    await dailyCoreTable.waitFor({ state: "visible", timeout: 20000 });
    await sleep(400);

    const vsDailyCorePath = `${OUTPUT_DIR}/promotion-daily-vs-daily-core.png`;
    await screenshotElement(page, '[data-testid="powerbi-daily-core-table"]', vsDailyCorePath);
    console.log(`Saved: ${vsDailyCorePath}`);

    // Re-open promotion tab to collect DOM evidence on default structure
    const promotionTab2 = page.locator(".pb-replica-toolbar nav button").getByText("推广费用明细");
    await promotionTab2.click();
    await waitForSpinnerGone(page);
    await sleep(600);
    const dailyTableSection2 = page.locator('[data-testid="promotion-daily-spend-table"]');
    await dailyTableSection2.waitFor({ state: "visible" });

    // 8. Check for empty state DOM presence
    const emptyState = page.locator("text=当前期间无推广花费数据");
    const emptyCount = await emptyState.count();
    console.log(`Empty state occurrences: ${emptyCount}`);

    // 9. Check for horizontal overflow (page level)
    const hasPageOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    console.log(`Page-level horizontal overflow: ${hasPageOverflow}`);

    // Collect structural DOM evidence
    const domEvidence = await dailyTableSection2.evaluate((section) => {
      const table = section.querySelector("table");
      if (!table) return null;
      const headerCells = Array.from(table.querySelectorAll("thead th")).map((th) => ({
        text: th.textContent?.trim() ?? "",
        textAlign: window.getComputedStyle(th).textAlign,
      }));
      const footerRow = table.querySelector("tfoot tr");
      const totalCell = footerRow?.querySelector("td");
      const totalColSpan = totalCell ? Number(totalCell.getAttribute("colSpan") || 1) : null;
      const firstYearToggle = section.querySelector('[data-testid="promotion-daily-year-toggle"]');
      const firstMonthToggle = section.querySelector('[data-testid="promotion-daily-month-toggle"]');
      return {
        headerCells,
        totalColSpan,
        totalText: totalCell?.textContent?.trim() ?? "",
        yearToggleAriaExpanded: firstYearToggle?.getAttribute("aria-expanded") ?? null,
        monthToggleAriaExpanded: firstMonthToggle?.getAttribute("aria-expanded") ?? null,
        yearToggleText: firstYearToggle?.textContent?.trim() ?? "",
        monthToggleText: firstMonthToggle?.textContent?.trim() ?? "",
      };
    });
    console.log("DOM evidence:", JSON.stringify(domEvidence, null, 2));

    // 10. Read structural evidence from default screenshot state
    await overallTab.click();
    await waitForSpinnerGone(page);
    await sleep(400);
    // ... already done

    await browser.close();

    console.log("Visual acceptance screenshots captured.");
    console.log(JSON.stringify({
      defaultPath,
      monthExpandedPath,
      monthCollapsedPath,
      yearCollapsedPath,
      vsDailyCorePath,
      monthExpandedBefore,
      yearExpandedBefore,
      emptyCount,
      hasPageOverflow,
      domEvidence,
    }, null, 2));
  } catch (error) {
    await browser.close();
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
