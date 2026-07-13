import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const warehouseRoot = join(projectRoot, "local-data", "warehouse");
const snapshotPath = join(warehouseRoot, "analytics-snapshot.json");
const statePath = join(warehouseRoot, "state.json");
const migrationStatusPath = join(projectRoot, "migration", "power-query-m", "migration-status.json");
const syncScript = join(projectRoot, "pipeline", "sync.py");

let activeSync = null;

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

export async function readWarehouseSnapshot() {
  return readJson(snapshotPath, null);
}

export async function checkWarehouse() {
  const [snapshot, state, migration] = await Promise.all([
    readWarehouseSnapshot(),
    readJson(statePath, { files: {} }),
    readJson(migrationStatusPath, null),
  ]);
  const files = Object.values(state?.files ?? {});
  const partitionCount = files.filter((item) => item?.parquet).length;
  const failedPartitionCount = files.filter((item) => item?.error).length;
  const databasePath = join(warehouseRoot, "ecom.duckdb");
  const databaseSize = existsSync(databasePath) ? (await stat(databasePath)).size : 0;
  return {
    configured: existsSync(syncScript),
    available: Boolean(snapshot && existsSync(databasePath)),
    syncing: Boolean(activeSync),
    snapshot,
    partitionCount,
    failedPartitionCount,
    queryCount: migration?.queryCount ?? 0,
    completedQueries: migration?.completedQueries ?? 0,
    sourceFileCount: migration?.sourceFileCount ?? 0,
    rowCount: migration?.rowCount ?? 0,
    databaseSize,
    databasePath,
    snapshotPath,
  };
}

async function executeSync() {
  const python = process.env.PYTHON || "python";
  const { stdout } = await execFileAsync(python, [syncScript, "sync"], {
    cwd: projectRoot,
    timeout: 60 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  const result = JSON.parse(stdout);
  if (!result.ok) throw new Error("本地数仓同步完成，但经营事实表为空");
  const snapshot = await readWarehouseSnapshot();
  if (!snapshot) throw new Error("本地数仓未生成 analytics-snapshot.json");
  return { ...snapshot, syncSummary: result };
}

export async function syncWarehouse() {
  if (!activeSync) {
    activeSync = executeSync().finally(() => {
      activeSync = null;
    });
  }
  return activeSync;
}
