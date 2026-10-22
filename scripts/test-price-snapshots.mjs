import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = join(dirname(fileURLToPath(import.meta.url)), 'export-price-snapshots.mjs');
function fixture(items, historical = [], period = '2026-09-06_21_30_55', samplePeriod = '2026-09-06 21:30:55') {
  const root = mkdtempSync(join(tmpdir(), 'tmall-snapshots-'));
  for (const dir of ['scripts', 'src/data', 'local-data/intelligence/price-snapshots']) mkdirSync(join(root, dir), {recursive: true});
  copyFileSync(script, join(root, 'scripts/export-price-snapshots.mjs'));
  const periods = [{period, items}, ...historical];
  writeFileSync(join(root, 'src/data/tmallCompetitorData.ts'),
    `export const tmallPricePeriods: any[] = ${JSON.stringify(periods, null, 2)};\n` +
    `export const tmallCompetitorPrices: any[] = ${JSON.stringify(items)};\n` +
    `export const tmallTop100Fallback: any = {"generatedAt":"2026-09-07T01:23:45.000","samplePeriod":${JSON.stringify(samplePeriod)}};\n`);
  return {root, out:join(root,'local-data/intelligence/price-snapshots'), run:()=>spawnSync(process.execPath,[join(root,'scripts/export-price-snapshots.mjs')],{cwd:root,env:{...process.env,DATA_DIR:join(root,'local-data')},encoding:'utf8'})};
}
test('brackets inside product names are JSON string content', ()=>{
  const f=fixture([{id:'tmall-111',productName:'mattress ] "name"',couponPrice:'¥120'}]);
  const result=f.run(); assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(readFileSync(join(f.out,'2026-09-06_21_30_55.json'))).items.length,1);
});
test('rebuilding current prices does not truncate existing historical snapshots', ()=>{
  const f=fixture([{id:'tmall-111',couponPrice:'¥120'}],[{period:'2026-08-25',items:[{id:'tmall-111',couponPrice:'¥60'}]}]);
  const old=JSON.stringify({period:'2026-08-25',items:[{id:'tmall-111'},{id:'tmall-old'}]});
  writeFileSync(join(f.out,'2026-08-25.json'),old);
  const result=f.run(); assert.equal(result.status,0,result.stderr);
  assert.equal(readFileSync(join(f.out,'2026-08-25.json'),'utf8'),old);
});
test('malformed period cannot escape the snapshots directory', ()=>{
  const f=fixture([{id:'tmall-111',couponPrice:'¥120'}],[{period:'../escape',items:[]}]);
  const result=f.run(); assert.notEqual(result.status,0);
});
test('business period label is accepted and used as snapshot name', ()=>{
  const period='26.10.13（双11预售预热）';
  const f=fixture([{id:'tmall-111',couponPrice:'¥120'}],[],period,period);
  const result=f.run(); assert.equal(result.status,0,result.stderr);
  const snap=JSON.parse(readFileSync(join(f.out,`${period}.json`),'utf8'));
  assert.equal(snap.period,period);
  assert.equal(snap.items.length,1);
});
