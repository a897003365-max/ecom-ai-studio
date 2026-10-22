#!/usr/bin/env node
/**
 * 京东POP（麻大师旗舰店）客服每日数据同步 —— shop.jd.com 客服/客服数据/店铺数据
 *
 * 依赖本机已登录「京东POP」账号的 Chrome CDP 实例：
 *   Chrome --remote-debugging-port=9222 --user-data-dir=E:\影刀平替项目\.chrome-automation-jdpop
 * （端口约定见 .learnings：9222=POP(.chrome-automation-jdpop)，9223=自营优选jdyx，9224=自营jdzy）
 *
 * API（POST，页面同源凭证）：
 *   查询 https://kf.jd.com/jingmai/T1/queryIndicatorDim
 *        body: startTime&endTime&transferType=1&tabType=dateDim|waiterDim&page&pageSize   （单次 ≤32 天）
 *   响应 { total, avg, code, pageData:{ totalCount, pageCount, result:[逐日/每人…] } }
 *
 * 网站数据链路（谁进数仓）：每人数据 waiterDim -> 京东pop<date>.xlsx（10列，列名对齐现有产物）
 *   -> 落 \\192.168.88.28\日更数据\...\接待数据\（88.28 真源目录）
 *   -> 11:00/18:00 EcomAIStudio-Warehouse-Sync 自动入仓（monitor 不自己触发 sync，规避双调度）。
 *   店铺级 dateDim 仅作原始档案（local-data/sources/kf-pop-daily/），网站不直接读。
 *
 * 用法：
 *   node scripts/kf-pop-daily-sync.mjs                      # 默认拉 2025-10-17 ~ T-1 全量，逐日落盘
 *   node scripts/kf-pop-daily-sync.mjs --start=2026-06-01 --end=2026-09-11
 *   node scripts/kf-pop-daily-sync.mjs --monitor            # T-1 全链路：waiterDim+xlsx 落源目录+归档
 *   node scripts/kf-pop-daily-sync.mjs --monitor --day=2026-09-10   # 调试：指定日期跑同链路
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawn } from 'child_process';

const CDP_URL = process.env.KF_POP_CDP || 'http://127.0.0.1:9222';
const CDP_PORT = Number(new URL(CDP_URL).port) || 9222;
const PROFILE = 'E:\\影刀平替项目\\.chrome-automation-jdpop'; // 唯一已登录 POP 的 profile，勿再启旧 .chrome-automation
const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'local-data', 'sources', 'kf-pop-daily');
const WAITER_DIR = path.join(ROOT, 'local-data', 'sources', 'kf-pop-waiter'); // waiterDim 逐日原始档案
const XLSX_SCRIPT = path.join(ROOT, 'scripts', 'kf-pop-waiter-xlsx.py');
// 88.28 真源目录（数仓 EcomAIStudio-Warehouse-Sync 扫描的就是这棵树）
const SRC_DEST = '\\\\192.168.88.28\\日更数据\\天猫旗舰店\\10-2京东客服绩效明细\\接待数据';
const SNAPSHOT = path.join(ROOT, 'local-data', 'warehouse', 'analytics-snapshot.json');
const DEFAULT_START = '2025-10-17'; // 后端 jd.daily 全局起点

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseDate = (s) => new Date(s + 'T00:00:00');
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const t1 = () => iso(new Date(Date.now() - 86400000));
const datesBetween = (s, e) => { const o = []; let d = parseDate(s); while (d <= parseDate(e)) { o.push(iso(d)); d = addDays(d, 1); } return o; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function cdpUp() { try { const r = await fetch(`${CDP_URL}/json/version`); return r.ok; } catch { return false; } }

async function ensureCdp() {
  for (let i = 1; i <= 3; i++) {
    try { return await chromium.connectOverCDP(CDP_URL); }
    catch (e) {
      if (i === 1) {
        console.warn(`[kf-pop] CDP ${CDP_URL} 未连接，尝试启动 POP Chrome...`);
        try {
          spawn(CHROME, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', 'https://shop.jd.com/jdm/home'], { detached: true, stdio: 'ignore' }).unref();
        } catch { /* fire and forget */ }
      }
      await sleep(6000 * i);
    }
  }
  throw new Error(`[kf-pop] 无法连接 CDP ${CDP_URL}；请先启动京东POP Chrome(9222)`);
}

async function getPage(browser) {
  let page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('kf-manage') || p.url().includes('shop.jd.com'));
  if (!page) page = browser.contexts()[0].pages()[0];
  if (!page.url().includes('kf-manage')) {
    await page.goto('https://shop.jd.com/jdm/kefu/kf-manage-lite/#/DataAnalysis/ReceptionData', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
  return page;
}

/** 带退避重试：网络抖动/平台限流（"请求正在执行中"）时最多 attempts 次 */
async function withRetry(label, fn, attempts = 3, baseMs = 3000) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= attempts) throw e;
      console.warn(`[kf-pop] ${label} 第${i}次失败: ${e.message}，${baseMs * i}ms 后重试`);
      await sleep(baseMs * i);
    }
  }
}

function normalizeDay(item) {
  let day = item.sdate ?? item.dayStr ?? item.date;
  if (typeof day === 'number') day = iso(new Date(day));
  else if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(day)) day = day.slice(0, 10);
  return { ...item, dayStr: day };
}

async function postIndicator(page, body) {
  const res = await page.evaluate(async (b) => {
    const r = await fetch('https://kf.jd.com/jingmai/T1/queryIndicatorDim', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: b,
    });
    return await r.text();
  }, body);
  let j; try { j = JSON.parse(res); } catch { throw new Error(`非JSON响应: ${res.slice(0, 100)}`); }
  if (j.code !== 'success') throw new Error(`API failure: ${(j.msg || j.result || '').slice(0, 120)}`);
  return j;
}

async function queryRange(page, start, end) {
  const all = []; let pageNo = 1;
  for (;;) {
    const body = `startTime=${start}&endTime=${end}&transferType=1&tabType=dateDim&page=${pageNo}&pageSize=10`;
    const j = await postIndicator(page, body);
    const rows = (j.pageData && j.pageData.result) || [];
    all.push(...rows.map(normalizeDay));
    const pageCount = (j.pageData && j.pageData.pageCount) || 1;
    if (pageNo >= pageCount || rows.length === 0) break;
    pageNo++;
    await sleep(700);
  }
  return all;
}

/** 单日每人数据（网站进仓的数据源）：waiterDim 单页 pageSize=50 */
async function queryWaiterDay(page, day) {
  const body = `startTime=${day}&endTime=${day}&transferType=1&tabType=waiterDim&page=1&pageSize=50`;
  const j = await postIndicator(page, body);
  return (j.pageData && j.pageData.result) || [];
}

function chunk32(start, end) {
  const segs = []; let d0 = parseDate(start);
  while (d0 <= parseDate(end)) {
    const d1 = addDays(d0, 30) > parseDate(end) ? parseDate(end) : addDays(d0, 30);
    segs.push([iso(d0), iso(d1)]);
    d0 = addDays(d1, 1);
  }
  return segs;
}

function saveDaily(rows) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let n = 0;
  for (const r of rows) {
    if (!r.dayStr) continue;
    fs.writeFileSync(path.join(OUT_DIR, `${r.dayStr}.json`), JSON.stringify(r, null, 2), 'utf-8');
    n++;
  }
  return n;
}

/** 调本机 python 生成单日 京东pop<day>.xlsx 落真源目录；返回 'written' | 'exists' | 'skip_empty' */
function genWaiterXlsx(day, rows) {
  fs.mkdirSync(WAITER_DIR, { recursive: true });
  const srcJson = path.join(WAITER_DIR, `${day}.json`);
  fs.writeFileSync(srcJson, JSON.stringify({ [day]: rows }), 'utf-8');
  if (!rows || rows.length === 0) return 'skip_empty';
  const dest = path.join(SRC_DEST, `京东pop${day}.xlsx`);
  if (fs.existsSync(dest)) return 'exists';
  const args = [XLSX_SCRIPT, `--day=${day}`, `--src=${srcJson}`, `--dest=${SRC_DEST}`];
  for (const exe of ['python', 'E:\\Anaconda3\\python.exe']) {
    try {
      const out = execFileSync(exe, args, { encoding: 'utf-8', timeout: 120000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      console.log(`[kf-pop] ${out.trim()}`);
      return fs.existsSync(dest) ? 'written' : 'missing';
    } catch (e) {
      if (exe !== 'python') throw e; // 两个解释器都失败才抛
      if (!String(e.message).includes('ENOENT')) throw e; // python 存在但脚本报错：直接抛
    }
  }
  throw new Error('未找到可用的 python 解释器');
}

/** 读后端快照 jd.daily 中 store=京东POP 缺失的日期（在其全局范围内） */
function backendPopMissing() {
  try {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf-8'));
    const daily = snap.powerbiPages.customerService.jd.daily;
    const all = [...new Set(daily.map(r => r.date))].sort();
    const pop = new Set(daily.filter(r => r.store === '京东POP').map(r => r.date));
    return { range: [all[0], all[all.length - 1]], missing: all.filter(d => !pop.has(d)) };
  } catch (e) { console.warn('[kf-pop] 读后端快照失败:', e.message); return null; }
}

function writeHealth(ref, status, detail, extra = {}) {
  const p = path.join(ROOT, 'local-data', 'runtime', 'kf-pop-daily-health.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ task: 'kf-pop-daily-sync', refDate: ref, status, detail, at: new Date().toISOString(), ...extra }, null, 2), 'utf-8');
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const end = args.end || t1();
  const start = args.monitor ? (args.day || end) : (args.start || DEFAULT_START);
  console.log(`[kf-pop] ${args.monitor ? 'monitor-T1' : 'range'} ${start} ~ ${end} (${datesBetween(start, end).length} 天)`);

  const browser = await ensureCdp();
  try {
    const page = await getPage(browser);

    if (args.monitor) {
      const day = args.day || end; // --day 调试用；默认 T-1
      // 1) 每人数据（网站进仓数据源）——带重试
      const rows = await withRetry(`waiterDim ${day}`, () => queryWaiterDay(page, day));
      if (!rows.some(r => (r.waiter ?? '').trim())) {
        console.log(`[kf-pop] T-1(${day}) 平台尚无每人数据，跳过（等次日或平台延迟）`);
        writeHealth(day, 'platform_missing', 'waiterDim empty'); return;
      }
      // 2) 生成 京东pop<day>.xlsx 落 88.28 真源目录（已存在则跳过，影刀重导出不覆盖）
      const xlsx = genWaiterXlsx(day, rows);
      // 3) 店铺级 dateDim 归档（非关键，失败不阻断）
      let dimSaved = 0;
      try {
        const dim = await withRetry(`dateDim ${day}`, () => queryRange(page, day, day));
        dimSaved = saveDaily(dim);
      } catch (e) { console.warn(`[kf-pop] dateDim 归档失败（不阻断）: ${e.message}`); }
      // 4) 不触发 sync：88.28 的 EcomAIStudio-Warehouse-Sync（11:00/18:00）会扫到新文件入仓
      console.log(`[kf-pop] T-1(${day}) 完成：每人数据 ${rows.length} 行，xlsx=${xlsx}，dateDim 归档 ${dimSaved} 天`);
      console.log(`[kf-pop] 等待 11:00 数仓任务自动入仓（源目录 ${SRC_DEST}）`);
      writeHealth(day, 'ok', `T1 ${day} waiterRows=${rows.length} xlsx=${xlsx} dateDim=${dimSaved}`, { waiterRows: rows.length, xlsx });
      return;
    }

    const segs = chunk32(start, end);
    console.log(`[kf-pop] 分 ${segs.length} 段（每段≤31天）`);
    let all = [];
    for (const [s, e] of segs) {
      try {
        const rows = await withRetry(`查询 ${s}~${e}`, () => queryRange(page, s, e));
        console.log(`[kf-pop]   ${s}~${e}: ${rows.length} 日`);
        all.push(...rows);
        await sleep(1200);
      } catch (err) { console.error(`[kf-pop]   段失败 ${s}~${e}: ${err.message}`); }
    }
    const saved = saveDaily(all);
    const days = [...new Set(all.map(r => r.dayStr).filter(Boolean))].sort();
    console.log(`[kf-pop] API 覆盖 ${days.length} 天 (${days[0]}..${days[days.length - 1]})，逐日 JSON 写 ${saved} 天`);

    // 对照后端缺失
    const bm = backendPopMissing();
    if (bm) {
      const apiDays = new Set(days);
      const winDays = new Set(datesBetween(Math.max(start === DEFAULT_START ? bm.range[0] : start, bm.range[0]), end === t1() ? bm.range[1] : Math.min(end, bm.range[1])));
      const backMissing = bm.missing.filter(d => d >= start && d <= end);
      const fillable = backMissing.filter(d => apiDays.has(d));
      const notAvail = backMissing.filter(d => !apiDays.has(d));
      console.log(`\n[kf-pop] === 后端(京东POP)缺 ${backMissing.length} 天 vs API 可补 ===`);
      console.log(`  可补: ${fillable.length} 天${fillable.length ? '（已全部落盘 ' + OUT_DIR + '）' : ''}`);
      if (notAvail.length) console.log(`  API 也无: ${notAvail.length} 天 -> ${notAvail.slice(0, 20).join(',')}${notAvail.length > 20 ? ' ...' : ''}`);
      console.log(`  后端全局范围: ${bm.range[0]}..${bm.range[1]}，POP 现有 ${bm.range[1] ? '' : ''}（详见快照）`);
    }
    writeHealth(end, 'ok', `range ${start}~${end} apiDays=${days.length} saved=${saved}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(e => { console.error('[kf-pop] 致命错误:', e.message); writeHealth(t1(), 'error', e.message.slice(0, 200)); process.exit(1); });
