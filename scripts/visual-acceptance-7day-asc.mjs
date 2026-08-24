import { chromium } from "playwright";

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

async function screenshotElement(page, selector, path) {
  const element = await page.locator(selector).first();
  await element.scrollIntoViewIfNeeded();
  await sleep(200);
  await element.screenshot({ path });
}

async function main() {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();

  try {
    console.log(`Navigating to ${BASE_URL}`);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await waitForSpinnerGone(page);
    await sleep(800);

    // 1. Open 运营数据看板
    const navButton = page.locator(".sidebar .nav-item").getByText(/运营数据看板/);
    await navButton.waitFor({ state: "visible", timeout: 15000 });
    await navButton.click();
    await waitForSpinnerGone(page);
    await sleep(1000);

    // 2. Read top date filter value
    const dateFilterButton = page.locator('[data-testid="analytics-date-filter"] button');
    await dateFilterButton.waitFor({ state: "visible", timeout: 15000 });
    const dateFilterText = await dateFilterButton.textContent();
    console.log(`Date filter text: ${dateFilterText}`);

    // 3. Switch to 天猫明细 workspace
    const tmallTab = page.getByRole("tab", { name: "天猫明细" });
    await tmallTab.click();
    await waitForSpinnerGone(page);
    await sleep(800);

    // 4. Screenshot full page header area showing date filter + tabs
    const headerPath = `${OUTPUT_DIR}/promotion-7day-header.png`;
    await page.locator('[data-testid="analytics-date-filter"]').first().screenshot({ path: headerPath });
    console.log(`Saved: ${headerPath}`);

    // 5. Switch to 推广费用明细
    const promotionTab = page.locator(".pb-replica-toolbar nav button").getByText("推广费用明细");
    await promotionTab.click();
    await waitForSpinnerGone(page);
    await sleep(800);

    const dailyTableSection = page.locator('[data-testid="promotion-daily-spend-table"]');
    await dailyTableSection.waitFor({ state: "visible", timeout: 20000 });

    // Screenshot promotion daily default (should show ~7 days ascending)
    const promotionDefaultPath = `${OUTPUT_DIR}/promotion-7day-default.png`;
    await screenshotElement(page, '[data-testid="promotion-daily-spend-table"]', promotionDefaultPath);
    console.log(`Saved: ${promotionDefaultPath}`);

    // Collect DOM evidence for promotion table
    const promotionEvidence = await dailyTableSection.evaluate((section) => {
      const table = section.querySelector("table");
      if (!table) return null;
      const rows = Array.from(table.querySelectorAll("tbody tr"));
      const dayRows = rows.filter((tr) => tr.getAttribute("data-hierarchy-level") === "day");
      const dayValues = dayRows.map((tr) => tr.querySelector("td:nth-child(3)")?.textContent?.trim() ?? "");
      const firstDay = dayValues[0] ?? "";
      const lastDay = dayValues[dayValues.length - 1] ?? "";
      const dayCount = dayValues.length;
      const monthToggle = section.querySelector('[data-testid="promotion-daily-month-toggle"]');
      const yearToggle = section.querySelector('[data-testid="promotion-daily-year-toggle"]');
      return {
        dayCount,
        firstDay,
        lastDay,
        dayValues,
        monthExpanded: monthToggle?.getAttribute("aria-expanded") ?? null,
        yearExpanded: yearToggle?.getAttribute("aria-expanded") ?? null,
        monthToggleText: monthToggle?.textContent?.trim() ?? "",
        yearToggleText: yearToggle?.textContent?.trim() ?? "",
      };
    });
    console.log("Promotion daily evidence:", JSON.stringify(promotionEvidence, null, 2));

    // 6. Switch to 旗舰店整体 and screenshot daily core data
    const overallTab = page.locator(".pb-replica-toolbar nav button").getByText("旗舰店整体");
    await overallTab.click();
    await waitForSpinnerGone(page);
    await sleep(800);

    const dailyCoreTable = page.locator('[data-testid="powerbi-daily-core-table"]');
    await dailyCoreTable.waitFor({ state: "visible", timeout: 20000 });

    const dailyCorePath = `${OUTPUT_DIR}/daily-core-7day-asc.png`;
    await screenshotElement(page, '[data-testid="powerbi-daily-core-table"]', dailyCorePath);
    console.log(`Saved: ${dailyCorePath}`);

    // Collect DOM evidence for daily core table
    const dailyCoreEvidence = await dailyCoreTable.evaluate((table) => {
      const rows = Array.from(table.querySelectorAll("tbody tr"));
      const dayRows = rows.filter((tr) => tr.getAttribute("data-hierarchy-level") === "day");
      const dayValues = dayRows.map((tr) => tr.querySelector("td:nth-child(3)")?.textContent?.trim() ?? "");
      const firstDay = dayValues[0] ?? "";
      const lastDay = dayValues[dayValues.length - 1] ?? "";
      const dayCount = dayValues.length;
      const monthToggle = table.querySelector('[data-testid="daily-core-month-toggle"]');
      const yearToggle = table.querySelector('[data-testid="daily-core-year-toggle"]');
      return {
        dayCount,
        firstDay,
        lastDay,
        dayValues,
        monthExpanded: monthToggle?.getAttribute("aria-expanded") ?? null,
        yearExpanded: yearToggle?.getAttribute("aria-expanded") ?? null,
        monthToggleText: monthToggle?.textContent?.trim() ?? "",
        yearToggleText: yearToggle?.textContent?.trim() ?? "",
      };
    });
    console.log("Daily core evidence:", JSON.stringify(dailyCoreEvidence, null, 2));

    await browser.close();

    console.log(JSON.stringify({
      dateFilterText,
      promotionDefaultPath,
      dailyCorePath,
      headerPath,
      promotionEvidence,
      dailyCoreEvidence,
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
