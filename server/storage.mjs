import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dataDir = process.env.DATA_DIR || join(process.cwd(), "local-data");
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, "ecom-ai-studio.sqlite"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS sync_runs (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    record_count INTEGER NOT NULL DEFAULT 0,
    detail TEXT,
    snapshot_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sync_runs_source_time
    ON sync_runs(source_id, started_at DESC);

  CREATE TABLE IF NOT EXISTS task_runs (
    id TEXT PRIMARY KEY,
    task_type TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_task_runs_time
    ON task_runs(created_at DESC);

  CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    category TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function beginSync(sourceId) {
  const run = {
    id: id("sync"),
    sourceId,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  db.prepare(`
    INSERT INTO sync_runs (id, source_id, status, started_at)
    VALUES (?, ?, ?, ?)
  `).run(run.id, run.sourceId, run.status, run.startedAt);
  return run;
}

export function finishSync(runId, { status, recordCount = 0, detail = "", snapshot = null }) {
  const finishedAt = new Date().toISOString();
  db.prepare(`
    UPDATE sync_runs
    SET status = ?, finished_at = ?, record_count = ?, detail = ?, snapshot_json = ?
    WHERE id = ?
  `).run(status, finishedAt, recordCount, detail, snapshot ? JSON.stringify(snapshot) : null, runId);
  return { runId, status, finishedAt, recordCount, detail };
}

export function latestSnapshot(sourceId) {
  const row = db.prepare(`
    SELECT id, source_id, status, started_at, finished_at, record_count, detail, snapshot_json
    FROM sync_runs
    WHERE source_id = ? AND status = 'success' AND snapshot_json IS NOT NULL
    ORDER BY started_at DESC
    LIMIT 1
  `).get(sourceId);
  if (!row) return null;
  return {
    id: row.id,
    sourceId: row.source_id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    recordCount: row.record_count,
    detail: row.detail,
    snapshot: parseJson(row.snapshot_json, {}),
  };
}

export function latestSnapshotMeta(sourceId) {
  // 轻量新鲜度探针：只读 finished_at，不解析 snapshot_json，供缓存校验用
  const row = db.prepare(`
    SELECT finished_at
    FROM sync_runs
    WHERE source_id = ? AND status = 'success' AND snapshot_json IS NOT NULL
    ORDER BY started_at DESC
    LIMIT 1
  `).get(sourceId);
  return row ? { finishedAt: row.finished_at } : null;
}

export function listSyncRuns(limit = 20) {
  return db.prepare(`
    SELECT id, source_id, status, started_at, finished_at, record_count, detail
    FROM sync_runs
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit).map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    recordCount: row.record_count,
    detail: row.detail,
  }));
}

export function upsertTask(task) {
  const now = new Date().toISOString();
  const createdAt = task.createdAt ?? task.startedAt ?? now;
  const status = task.status ?? "pending";
  db.prepare(`
    INSERT INTO task_runs (id, task_type, status, created_at, updated_at, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run(task.id, task.type, status, createdAt, now, JSON.stringify(task));
  return { ...task, createdAt, updatedAt: now };
}

export function listTasks(limit = 100) {
  return db.prepare(`
    SELECT payload_json, created_at, updated_at
    FROM task_runs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit).map((row) => ({
    ...parseJson(row.payload_json, {}),
    persistedCreatedAt: row.created_at,
    persistedUpdatedAt: row.updated_at,
  }));
}

export function getTask(taskId) {
  const row = db.prepare(`
    SELECT payload_json, created_at, updated_at
    FROM task_runs
    WHERE id = ?
  `).get(taskId);
  if (!row) return null;
  return {
    ...parseJson(row.payload_json, {}),
    persistedCreatedAt: row.created_at,
    persistedUpdatedAt: row.updated_at,
  };
}

export function updateTaskAction(taskId, action) {
  const task = getTask(taskId);
  if (!task) return null;
  const statusByAction = {
    retry: "retrying",
    confirm: "success",
    cancel: "cancelled",
    export: "pending",
  };
  const updated = {
    ...task,
    status: statusByAction[action] ?? task.status,
    progress: action === "confirm" ? 100 : task.progress,
    type: action === "export" ? "export_package" : task.type,
  };
  return upsertTask(updated);
}

export function recordUpload(upload) {
  const createdAt = new Date().toISOString();
  const item = { id: id("upload"), createdAt, status: "waiting_parse", ...upload };
  db.prepare(`
    INSERT INTO uploads (id, file_name, category, size_bytes, storage_path, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(item.id, item.fileName, item.category, item.sizeBytes, item.storagePath, item.status, item.createdAt);
  return item;
}

export function updateUploadStatus(uploadId, status) {
  db.prepare("UPDATE uploads SET status = ? WHERE id = ?").run(status, uploadId);
  const row = db.prepare(`
    SELECT id, file_name, category, size_bytes, storage_path, status, created_at
    FROM uploads
    WHERE id = ?
  `).get(uploadId);
  if (!row) return null;
  return {
    id: row.id,
    fileName: row.file_name,
    category: row.category,
    sizeBytes: row.size_bytes,
    storagePath: row.storage_path,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function latestUpload(category) {
  const row = db.prepare(`
    SELECT id, file_name, category, size_bytes, storage_path, status, created_at
    FROM uploads
    WHERE category = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(category);
  if (!row) return null;
  return {
    id: row.id,
    fileName: row.file_name,
    category: row.category,
    sizeBytes: row.size_bytes,
    storagePath: row.storage_path,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function listUploads(limit = 30) {
  return db.prepare(`
    SELECT id, file_name, category, size_bytes, storage_path, status, created_at
    FROM uploads
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit).map((row) => ({
    id: row.id,
    fileName: row.file_name,
    category: row.category,
    sizeBytes: row.size_bytes,
    storagePath: row.storage_path,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export { dataDir };
