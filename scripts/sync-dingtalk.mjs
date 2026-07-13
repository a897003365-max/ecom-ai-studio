import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(projectRoot);

const logDir = join(projectRoot, "local-data", "logs");
const logPath = join(logDir, "dingtalk-sync.log");

function safeMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted-url]")
    .replace(/(access[_-]?token|xsec_token|app[_-]?secret|cookie)\s*[=:]\s*[^\s&,;]+/gi, "$1=[redacted]")
    .slice(0, 1000);
}

async function log(message) {
  await mkdir(logDir, { recursive: true });
  await appendFile(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

const [{ checkDingTalkApi, syncDingTalkApi }, { beginSync, finishSync }] = await Promise.all([
  import("../server/dingtalk-api.mjs"),
  import("../server/storage.mjs"),
]);

const configuration = checkDingTalkApi();
if (!configuration.configured) {
  const message = "钉钉同步未执行：环境变量配置不完整";
  await log(message);
  throw new Error(message);
}

const dryRun = process.argv.includes("--dry-run");
const run = dryRun ? null : beginSync("dingtalk");

try {
  await log(`开始${dryRun ? "试运行" : "定时"}同步`);
  const snapshot = await syncDingTalkApi();
  if (run) {
    finishSync(run.id, {
      status: "success",
      recordCount: snapshot.recordCount,
      detail: "钉钉共享表已完成只读同步与脱敏聚合",
      snapshot,
    });
  }
  await log(`同步成功：工作表 ${snapshot.quality.sheetCount}，聚合记录 ${snapshot.recordCount}`);
  console.log(JSON.stringify({
    ok: true,
    dryRun,
    sheetCount: snapshot.quality.sheetCount,
    recordCount: snapshot.recordCount,
    period: snapshot.period,
  }));
} catch (error) {
  const detail = safeMessage(error);
  if (run) finishSync(run.id, { status: "failed", detail });
  await log(`同步失败：${detail}`);
  throw new Error(detail);
}
