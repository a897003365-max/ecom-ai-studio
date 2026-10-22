#!/usr/bin/env node
/**
 * 京东客服管家 (kf.jd.com) 京东自营·服务商工作量 数据同步与 T-1 缺口补下载
 *
 * 依赖本机已登录「京东自营(麻大师自营店)」账号的 Chrome CDP 实例：
 *   Chrome --remote-debugging-port=9224 --user-data-dir=E:\影刀平替项目\.chrome-automation-jdzy
 * 账号 profile 见 .learnings/SESSION-LOG.md（9224=jdzy 京东自营，非 jdyx 自营优选）。
 *
 * API（同源 kf.jd.com）：
 *   查询 GET /managementData/workload/queryList?page&pageSize=15&startTime&endTime&transferType=1&type=1  (≤31天/page)
 *   下载 GET /managementData/workload/exportList?startTime&endTime&transferType=1&type=1                 (≤31天)
 *
 * 用法：
 *   node scripts/kf-jd-workload-sync.mjs --presync            # 一次性归档近三个月，写逐日 json + 段 xls
 *   node scripts/kf-jd-workload-sync.mjs --gap                # 检查本地缺而平台有的日期并补下载
 *   node scripts/kf-jd-workload-sync.mjs --monitor            # 定时模式：检测 T-1 缺口，缺则立即补下载
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const CDP_URL = process.env.KF_JD_CDP || 'http://127.0.0.1:9224';
const CDP_PORT = Number(new URL(CDP_URL).port) || 9224;
const PROFILES_DIR = 'E:\\影刀平替项目\\.chrome-automation-jdzy';
const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'local-data', 'sources', 'kf-jd-daily');
const XLS_DIR = path.join(OUT_DIR, 'xls');
const STAGING_DIR = path.join(ROOT, 'local-data', 'warehouse', 'staging');

function iso(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function parseDate(s) { return new Date(s + 'T00:00:00'); }
function datesBetween(start, end) {
  const out = []; let d = parseDate(start);
  while (d <= parseDate(end)) { out.push(iso(d)); d = addDays(d, 1); }
  return out;
}
function todayStr() { return iso(new Date()); }
function t1Str() { return iso(new Date(Date.now() - 86400000)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function cdpReachable() {
  try { const r = await fetch(`${CDP_URL}/json/version`); return r.ok; } catch { return false; }
}

async function ensureCdp() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await chromium.connectOverCDP(CDP_URL); }
    catch (e) {
      if (attempt === 1) {
        console.warn(`[kf-jd] CDP ${CDP_URL} 未连接，尝试启动 jdzy Chrome...`);
        try {
          // spawn+unref fire-and-forget：execFileSync 会同步等 Chrome 退出（永不），定时任务将假死
          spawn(CHROME, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILES_DIR}`, '--no-first-run', '--no-default-browser-check', 'https://kf.jd.com/#/32'], { detached: true, stdio: 'ignore' }).unref();
        } catch { /* fire and forget */ }
      }
      await sleep(6000 * attempt);
    }
  }
  throw new Error(`[kf-jd] 无法连接 CDP ${CDP_URL}；请确认京东自营 Chrome(9224) 已启动并登录`);
}

/** 带退避重试：网络抖动/平台限流（"请求正在执行中"）时最多 attempts 次 */
async function withRetry(label, fn, attempts = 3, baseMs = 3000) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= attempts) throw e;
      console.warn(`[kf-jd] ${label} 第${i}次失败: ${e.message}，${baseMs * i}ms 后重试`);
      await sleep(baseMs * i);
    }
  }
}

async function getPage(browser) {
  const pages = browser.contexts().flatMap(c => c.pages());
  let page = pages.find(p => p.url().includes('kf.jd.com')) || pages[0];
  try { await page.goto('https://kf.jd.com/#/32', { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (_) {}
  // 关掉可能出现的弹窗
  await page.evaluate(() => {
    const sels = ['.ant-modal', '.ant-modal-mask', '.ant-modal-wrap'];
    for (const s of sels) [...document.querySelectorAll(s)].forEach(el => el.remove());
  }).catch(() => {});
  await page.waitForTimeout(600);
  return page;
}

async function queryRange(page, start, end) {
  const all = []; let pageNo = 1;
  for (;;) {
    const url = `/managementData/workload/queryList?page=${pageNo}&pageSize=15&startTime=${start}&endTime=${end}&transferType=1&type=1`;
    const res = await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'include' });
      return await r.text();
    }, url);
    let j; try { j = JSON.parse(res); } catch (_) { throw new Error(`queryList 非JSON: ${res.slice(0,120)}`); }
    if (j.code !== 'success') throw new Error(`queryList failure: ${(j.msg || j.result || '').slice(0,140)}`);
    const list = j.workKpiList || [];
    all.push(...list);
    const totalPage = j.totalPage || 1;
    if (pageNo >= totalPage || list.length === 0) break;
    pageNo++;
  }
  return all;
}

async function exportXls(page, ctx, start, end) {
  const outName = `workload_${start}_${end}.xls`;
  const outPath = path.join(XLS_DIR, outName);
  if (fs.existsSync(outPath)) { console.log(`[kf-jd] xls 已存在跳过: ${outName}`); return outName; }
  for (let attempt = 1; attempt <= 2; attempt++) {
    const dlP = new Promise(res => ctx.once('download', d => res(d)));
    await page.evaluate((e) => { window.open(e, '_self'); }, `//kf.jd.com/managementData/workload/exportList?startTime=${start}&endTime=${end}&transferType=1&type=1`);
    const dl = await Promise.race([dlP, new Promise(res => setTimeout(() => res(null), 8000))]);
    if (dl) {
      await sleep(1500);
      try {
        const tmp = await dl.path();
        fs.copyFileSync(tmp, outPath);
        console.log(`[kf-jd] xls 归档: ${outPath} (${fs.statSync(outPath).size}B)`);
        return outName;
      } catch (e) { console.warn('[kf-jd] xls 保存失败', e.message); return null; }
    }
    console.warn(`[kf-jd] exportList 无下载事件 ${start}~${end}（第${attempt}次）`);
    if (attempt < 2) await sleep(4000);
  }
  return null;
}

function saveDaily(rows) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let n = 0;
  for (const r of rows) {
    const day = r.dayStr;
    if (!day) continue;
    fs.writeFileSync(path.join(OUT_DIR, `${day}.json`), JSON.stringify(r, null, 2), 'utf-8');
    n++;
  }
  return n;
}

/** python+duckdb 读 staging 京东客服 10-2/10-3/10-4 的日期覆盖，返回缺失清单 */
function stagingJdMissing(start, end) {
  const staging = STAGING_DIR.replace(/\\/g, '/');
  const py = [
    'import duckdb, glob, json, sys',
    'from datetime import date, timedelta',
    "start, end = sys.argv[1], sys.argv[2]",
    `base = r'${staging}'`,
    'win = [(date.fromisoformat(start) + timedelta(days=i)).isoformat() for i in range((date.fromisoformat(end) - date.fromisoformat(start)).days + 1)]',
    'con = duckdb.connect()',
    'out = {}',
    "for q, label in [('q13_3d6374ff26','10-2京东营销明细'),('q14_72420ee9b4','10-3京东绩效数据'),('q15_12d4e0f4ab','10-4员工日报统计')]:",
    "    fs = glob.glob(base + '/%s/*.parquet' % q)",
    '    try:',
    "        slist = '[' + ','.join('\"' + f.replace(chr(34),'') + '\"' for f in fs) + ']'",
    '        sql = "SELECT DISTINCT TRY_CAST(日期 AS DATE) FROM read_parquet(" + slist + ")"',
    '        rows = con.execute(sql).fetchall()',
    '    except Exception as e:',
    "        out[label] = ['ERR:' + str(e)[:60]]; continue",
    '    have = {str(r[0])[:10] for r in rows if r[0]}',
    '    out[label] = [d for d in win if d not in have]',
    'print(json.dumps(out, ensure_ascii=False))',
  ].join('\n');
  try {
    const res = execFileSync('python', ['-c', py, start, end], { encoding: 'utf-8', timeout: 90000 });
    return JSON.parse(res);
  } catch (e) {
    console.warn('[kf-jd] staging 对照失败:', e.message.slice(0, 160));
    return null;
  }
}

function parseArgs(argv) {
  const a = { presync: false, gap: false, monitor: false, start: null, end: null };
  for (const arg of argv) {
    if (arg === '--presync') a.presync = true;
    if (arg === '--gap') a.gap = true;
    if (arg === '--monitor') a.monitor = true;
    if (arg.startsWith('--start=')) a.start = arg.split('=')[1];
    if (arg.startsWith('--end=')) a.end = arg.split('=')[1];
  }
  return a;
}

function chunk31(start, end) {
  const segs = []; let d0 = parseDate(start);
  while (d0 <= parseDate(end)) {
    const d1 = addDays(d0, 30) > parseDate(end) ? parseDate(end) : addDays(d0, 30);
    segs.push([iso(d0), iso(d1)]);
    d0 = addDays(d1, 1);
  }
  return segs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(XLS_DIR, { recursive: true });

  let start, end, mode;
  if (args.monitor) {
    start = t1Str(); end = t1Str(); mode = 'monitor-T1';
  } else {
    start = args.start || iso(addDays(parseDate(t1Str()), -89)); // 近三个月含 T-1
    end = args.end || t1Str(); mode = args.presync ? 'presync' : 'gap-check';
  }
  const winDays = datesBetween(start, end);
  console.log(`[kf-jd] mode=${mode} 区间 ${start} ~ ${end} (${winDays.length} 天)`);

  // 一次性确保 CDP 连接（monitor 也复用同一条连接，避免并发查询触发平台限流）
  const browser = await ensureCdp();
  try {
    const page = await getPage(browser);
    const ctx = browser.contexts()[0];

    // T-1 模式：先探测该日平台是否已有数据；有则直接补下载后退出（避免重复查询）
    if (args.monitor) {
      const probe = await withRetry(`T-1 探测 ${start}`, () => queryRange(page, start, end));
      const have = new Set(probe.map(r => r.dayStr));
      if (!have.has(end)) {
        console.log(`[kf-jd] T-1(${end}) 平台尚无数据，跳过（可能源端未出）`);
        writeHealth(end, 'platform_missing', 'no action');
        return;
      }
      console.log(`[kf-jd] T-1(${end}) 平台已有数据，补下载`);
      const saved = saveDaily(probe);
      await exportXls(page, ctx, start, end);
      writeHealth(end, 'ok', `T1 ${end} platform=yes local_json=${saved}`);
      console.log(`[kf-jd] 完成 T-1(${end}) 补下载，逐日 JSON 写 ${saved} 天`);
      return;
    }

    const segments = chunk31(start, end);
    let allRows = [];
    for (const [s, e] of segments) {
      try {
        const rows = await withRetry(`查询 ${s}~${e}`, () => queryRange(page, s, e));
        console.log(`[kf-jd]   查询 ${s}~${e}: ${rows.length} 日`);
        allRows.push(...rows);
        // 归档 xls（若缺）
        if (args.presync || args.gap) await exportXls(page, ctx, s, e);
        await sleep(1500); // 平台对连续查询有限流，段间稍等
      } catch (err) {
        console.error(`[kf-jd]   段失败 ${s}~${e}: ${err.message}`);
      }
    }

    // 逐日 JSON（本地档案）
    const saved = saveDaily(allRows);
    const platformDays = new Set(allRows.map(r => r.dayStr).filter(Boolean));
    const nowHaveLocal = new Set(fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')));
    const localMissing = winDays.filter(d => !nowHaveLocal.has(d));
    const siteHasButLocalMissing = localMissing.filter(d => platformDays.has(d));

    console.log(`[kf-jd] 逐日 JSON 已写 ${saved} 天 -> ${OUT_DIR}`);
    console.log(`[kf-jd] 平台覆盖: ${platformDays.size}/${winDays.length} 天  | 本地缺: ${localMissing.length} 天`);
    if (siteHasButLocalMissing.length) {
      console.log(`[kf-jd] ⚠ 平台有但本地缺（应补下载）: ${siteHasButLocalMissing.join(',')}`);
    }

    // 对齐数仓 staging 京东客服缺口
    if (args.gap || args.presync) {
      const m = stagingJdMissing(start, end);
      if (m) {
        console.log(`\n[kf-jd] === 数仓 staging 京东客服缺 vs 平台可补 ===`);
        for (const [label, days] of Object.entries(m)) {
          const real = days.filter(d => !d.startsWith('ERR:'));
          const siteDay = (d) => platformDays.has(d) ? '有' : '无';
          console.log(`  ${label} 缺 ${real.length} 天`);
          console.log(`    数仓缺: ${real.join(',') || '无'}`);
          if (real.length) console.log(`    其中平台可补: ${real.filter(siteDay).join(',') || '无'}`);
        }
      }
    }
    writeHealth(end, 'ok', `${winDays.length}d platform=${platformDays.size} local=${saved} staging_resolved`);
  } finally {
    await browser.close().catch(() => {});
  }
}

function writeHealth(refDate, status, detail) {
  const p = path.join(ROOT, 'local-data', 'runtime', 'kf-jd-workload-health.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ task: 'kf-jd-workload-sync', refDate, status, detail, at: new Date().toISOString() }, null, 2), 'utf-8');
}

main().catch(e => { console.error('[kf-jd] 致命错误:', e.message); writeHealth(t1Str(), 'error', e.message.slice(0, 200)); process.exit(1); });