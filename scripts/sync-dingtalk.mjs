import { appendFile, mkdir, rm, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(projectRoot);

const logDir = join(projectRoot, "local-data", "logs");
const logPath = join(logDir, "dingtalk-sync.log");
const runtimeDir = join(projectRoot, "local-data", "runtime");
const healthPath = join(runtimeDir, "dingtalk-sync-health.json");

function safeMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted-url]")
    .replace(/(access[_-]?token|xsec_token|app[_-]?(?:key|secret)|workbook[_-]?id|operator[_-]?id|cookie)\s*[=:]\s*[^\s&,;]+/gi, "$1=[redacted]")
    .slice(0, 1000);
}

async function log(message) {
  await mkdir(logDir, { recursive: true });
  await appendFile(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

async function writeHealth(payload) {
  await mkdir(runtimeDir, { recursive: true });
  const next = { ...payload, updatedAt: new Date().toISOString() };
  const tempPath = `${healthPath}.${process.pid}.tmp`;
  await writeFile(tempPath, JSON.stringify(next, null, 2), "utf8");
  try {
    await rename(tempPath, healthPath);
  } catch {
    await writeFile(healthPath, JSON.stringify(next, null, 2), "utf8");
    await rm(tempPath, { force: true });
  }
}

function retryAttempts(readLocalEnv) {
  return Math.max(1, Math.min(5, Number(readLocalEnv("DINGTALK_SYNC_ATTEMPTS", "3")) || 3));
}

function retryDelay(attempt) {
  return Math.min(60_000, 5_000 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 500);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableSyncError(detail) {
  return /(500|502|503|504|429|fetch failed|econn|etimedout|eai_again|网络|连接)/i.test(detail);
}

const [{ checkDingTalkApi, syncDingTalkApi }, { beginSync, finishSync }, { acquireDingTalkLock }, { readLocalEnv }] = await Promise.all([
  import("../server/dingtalk-api.mjs"),
  import("../server/storage.mjs"),
  import("../server/dingtalk-lock.mjs"),
  import("../server/local-env.mjs"),
]);

const dryRun = process.argv.includes("--dry-run");
const maxAttempts = retryAttempts(readLocalEnv);
const configuration = checkDingTalkApi();
if (!configuration.configured) {
  const message = "钉钉同步未执行：环境变量配置不完整";
  if (!dryRun) await writeHealth({ status: "failed", error: message, attempts: 0 });
  await log(message);
  throw new Error(message);
}

const lock = await acquireDingTalkLock("scheduled-script");
if (!lock) {
  const message = "钉钉同步已在运行，本次跳过，避免并发请求触发钉钉 503";
  await log(message);
  console.log(JSON.stringify({ ok: true, dryRun, skipped: true, reason: message }));
  process.exit(0);
}
const run = dryRun ? null : beginSync("dingtalk");
let attempt = 0;

try {
  const startedAt = new Date().toISOString();
  if (!dryRun) await writeHealth({ status: "running", startedAt, attempts: maxAttempts });
  await log(`开始${dryRun ? "试运行" : "定时"}同步，最多尝试 ${maxAttempts} 次`);
  let snapshot;
  let lastError;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      await log(`同步尝试 ${attempt}/${maxAttempts}`);
      snapshot = await syncDingTalkApi();
      break;
    } catch (error) {
      lastError = error;
      const detail = safeMessage(error);
      if (attempt >= maxAttempts || !isRetryableSyncError(detail)) throw error;
      const delay = retryDelay(attempt);
      await log(`同步尝试 ${attempt} 失败，${delay}ms 后重试：${detail}`);
      await sleep(delay);
    }
  }
  if (!snapshot) throw lastError ?? new Error("钉钉同步未返回快照");
  if (run) {
    finishSync(run.id, {
      status: "success",
      recordCount: snapshot.recordCount,
      detail: "钉钉共享表已完成只读同步与脱敏聚合",
      snapshot,
    });
  }
  if (!dryRun) await writeHealth({
    status: "success",
    startedAt,
    finishedAt: new Date().toISOString(),
    attempts: attempt,
    sheetCount: snapshot.quality.sheetCount,
    recordCount: snapshot.recordCount,
    period: snapshot.period,
  });
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
  if (!dryRun) await writeHealth({ status: "failed", finishedAt: new Date().toISOString(), attempts: attempt, error: detail });
  await log(`同步失败：${detail}`);
  throw new Error(detail);
} finally {
  await lock.release();
}
