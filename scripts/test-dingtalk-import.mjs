import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDingTalkFile } from "../server/dingtalk.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const directory = await mkdtemp(join(tmpdir(), "ecom-dingtalk-"));
const filePath = join(directory, "dingtalk-fixture.csv");
const csv = [
  "日期,平台,店铺,商品名称,负责人,手机号,曝光,点击,消耗,支付订单,GMV,退款金额,收藏,加购,异常说明",
  "2026-07-08,抖音,测试店铺,床垫 A,张三,13800000000,1000,50,200,5,1200,20,12,18,",
  "2026-07-09,天猫,测试店铺,床垫 B,李四,13900000000,2000,80,300,8,2100,0,20,24,预算偏高",
].join("\n");

try {
  await writeFile(filePath, csv, "utf8");
  const snapshot = await parseDingTalkFile({ filePath, fileName: "dingtalk-fixture.csv" });
  const serialized = JSON.stringify(snapshot);

  assert(snapshot.recordCount === 2, "钉钉数据行数解析错误");
  assert(snapshot.totals.gmv === 3300, "钉钉 GMV 汇总错误");
  assert(snapshot.totals.spend === 500, "钉钉消耗汇总错误");
  assert(snapshot.platforms.length === 2, "钉钉平台拆分错误");
  assert(snapshot.privacy.rawRowsPersisted === false, "钉钉原始行不应持久化");
  assert(snapshot.privacy.blockedHeaders.includes("手机号"), "手机号列未被拦截");
  assert(!serialized.includes("13800000000"), "快照包含手机号");
  assert(!serialized.includes("张三"), "快照包含负责人原值");
  assert(!serialized.includes("床垫 A"), "快照包含商品原值");
  console.log(`dingtalk parser ok: ${snapshot.recordCount} rows, ${snapshot.platforms.length} platforms`);
} finally {
  await unlink(filePath).catch(() => undefined);
  await rmdir(directory).catch(() => undefined);
}
