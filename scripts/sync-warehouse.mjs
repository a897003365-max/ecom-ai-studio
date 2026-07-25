import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(projectRoot);

const logDir = join(projectRoot, "local-data", "logs");
const logPath = join(logDir, "warehouse-sync.log");
const runtimeDir = join(projectRoot, "local-data", "runtime");
const healthPath = join(runtimeDir, "warehouse-sync-health.json");

function safeMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1000);
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
  return Math.max(1, Math.min(3, Number(readLocalEnv("WAREHOUSE_SYNC_ATTEMPTS", "2")) || 2));
}

function retryDelay(attempt) {
  // 数仓同步是本地重活，失败多为 DuckDB 写冲突或文件占用，退避 60s/120s 封顶
  return Math.min(120_000, 60_000 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 1_000);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableSyncError(detail) {
  return /(timeout|etimedout|ebusy|elock|resource busy|locked|占用|冲突|连接)/i.test(detail);
}

const [{ checkWarehouse, syncWarehouse }, { beginSync, finishSync }, { acquireWarehouseLock }, { readLocalEnv }] = await Promise.all([
  import("../server/warehouse.mjs"),
  import("../server/storage.mjs"),
  import("../server/warehouse-lock.mjs"),
  import("../server/local-env.mjs"),
]);

// S4U 计划任务进程可能未把 HKCU\Environment 的 PYTHON 加载到进程环境块，从注册表补设，
// 确保 warehouse.mjs executeSync() 用绝对路径调用 python，不依赖 PATH
if (!process.env.PYTHON) {
  const py = readLocalEnv("PYTHON");
  if (py) process.env.PYTHON = py;
}

const dryRun = process.argv.includes("--dry-run");
const configuration = await checkWarehouse();
if (!configuration.configured) {
  const message = "本地数仓同步未执行：pipeline/sync.py 不可用";
  if (!dryRun) await writeHealth({ status: "failed", error: message, attempts: 0 });
  await log(message);
  throw new Error(message);
}

const lock = await acquireWarehouseLock("scheduled-script");
if (!lock) {
  const message = "本地数仓同步已在运行，本次跳过，避免 DuckDB 写冲突";
  await log(message);
  console.log(JSON.stringify({ ok: true, dryRun, skipped: true, reason: message }));
  process.exit(0);
}

if (dryRun) {
  await log("试运行：仅检查配置与锁，不执行同步");
  console.log(JSON.stringify({
    ok: true,
    dryRun,
    configured: configuration.configured,
    available: configuration.available,
    partitionCount: configuration.partitionCount,
    queryCount: configuration.queryCount,
    completedQueries: configuration.completedQueries,
    python: process.env.PYTHON || "python",
  }));
  await lock.release();
  process.exit(0);
}

const maxAttempts = retryAttempts(readLocalEnv);
const run = beginSync("warehouse");
let attempt = 0;

try {
  const startedAt = new Date().toISOString();
  await writeHealth({ status: "running", startedAt, attempts: maxAttempts });
  await log(`开始定时同步，最多尝试 ${maxAttempts} 次`);
  let snapshot;
  let lastError;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      await log(`同步尝试 ${attempt}/${maxAttempts}`);
      snapshot = await syncWarehouse();
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
  if (!snapshot) throw lastError ?? new Error("本地数仓同步未返回快照");
  finishSync(run.id, {
    status: "success",
    recordCount: snapshot.recordCount ?? 0,
    detail: "本地源文件已完成增量同步，DuckDB 聚合快照已更新",
    snapshot,
  });
  await writeHealth({
    status: "success",
    startedAt,
    finishedAt: new Date().toISOString(),
    attempts: attempt,
    recordCount: snapshot.recordCount ?? 0,
    period: snapshot.powerbiPages?.period ?? null,
  });
  await log(`同步成功：聚合记录 ${snapshot.recordCount ?? 0}`);
  console.log(JSON.stringify({
    ok: true,
    recordCount: snapshot.recordCount ?? 0,
    period: snapshot.powerbiPages?.period ?? null,
  }));
} catch (error) {
  const detail = safeMessage(error);
  finishSync(run.id, { status: "failed", detail });
  await writeHealth({ status: "failed", finishedAt: new Date().toISOString(), attempts: attempt, error: detail });
  await log(`同步失败：${detail}`);
  throw new Error(detail);
} finally {
  await lock.release();
}
