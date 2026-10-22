#!/usr/bin/env node
/**
 * 京东POP 客服"每人数据"历史回填拉取：
 * 逐天调用 kf.jd.com/jingmai/T1/queryIndicatorDim (tabType=waiterDim)，
 * 输出汇总 JSON 供 python 生成 京东pop<date>.xlsx 源文件（进接待数据文件夹走正式管道）。
 *
 * 用法：node scripts/kf-pop-waiter-backfill.mjs [--dates-file=path] [--out=path]
 * 默认日期 = local-data/tmp/pop-missing-dates.json（后端京东POP缺失清单）
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DATES = path.join(ROOT, 'local-data', 'tmp', 'pop-missing-dates.json');
const DEFAULT_OUT = path.join(ROOT, 'local-data', 'tmp', 'kf-pop-waiter-days.json');
const CDP_URL = 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const dates = JSON.parse(fs.readFileSync(args['dates-file'] || DEFAULT_DATES, 'utf-8'));
const outPath = args['out'] || DEFAULT_OUT;
console.log(`[backfill] 待拉取 ${dates.length} 天 -> ${outPath}`);

const browser = await chromium.connectOverCDP(CDP_URL);
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('kf-manage')) || browser.contexts()[0].pages()[0];

// 若中断重跑：跳过已抓过的日期（输出文件里已有的）
let done = {};
if (fs.existsSync(outPath)) { try { done = JSON.parse(fs.readFileSync(outPath, 'utf-8')); } catch { done = {}; } }

let ok = 0, empty = 0, fail = 0;
for (const day of dates) {
  if (done[day]) { ok++; continue; }
  let rows = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const txt = await page.evaluate(async ([s, e]) => {
        const r = await fetch('https://kf.jd.com/jingmai/T1/queryIndicatorDim', {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body: `startTime=${s}&endTime=${e}&transferType=1&tabType=waiterDim&page=1&pageSize=50`,
        });
        return await r.text();
      }, [day, day]);
      const j = JSON.parse(txt);
      if (j.code !== 'success') throw new Error((j.msg || '').slice(0, 80));
      rows = (j.pageData && j.pageData.result) || [];
      break;
    } catch (e) {
      if (attempt === 3) { console.error(`[backfill] ${day} 失败: ${e.message}`); fail++; }
      else await sleep(2500 * attempt);
    }
  }
  if (rows === null) continue;
  done[day] = rows;
  if (rows.length === 0) empty++; else ok++;
  if ((ok + empty + fail) % 20 === 0) {
    fs.writeFileSync(outPath, JSON.stringify(done), 'utf-8');
    console.log(`[backfill] 进度 ${ok + empty + fail}/${dates.length} (有数据 ${ok} / 空 ${empty} / 失败 ${fail})`);
  }
  await sleep(500);
}
fs.writeFileSync(outPath, JSON.stringify(done), 'utf-8');
console.log(`[backfill] 完成：有数据 ${ok} 天 / 平台无数据 ${empty} 天 / 失败 ${fail} 天 -> ${outPath}`);
await browser.close().catch(() => {});