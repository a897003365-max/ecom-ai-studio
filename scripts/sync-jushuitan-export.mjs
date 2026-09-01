// 9:45 daily schedule for 15-聚水潭商品数据 → D:\麻大师\日更数据\商品管理\15-聚水潭商品数据.xlsx
//
// 与 sync-warehouse.mjs / sync-dingtalk.mjs 保持同一模式：
//   1. 获取 warehouse lock（避免与 11:00 / 18:00 全量 sync 撞车）
//   2. 调用 Python pipeline/sync.py export-jushuitan --sync（一次原子操作：sync 失败则不写 Excel）
//   3. 写 local-data/runtime/jushuitan-export-health.json 让 /api/health 看到
//   4. 输出带文档加密（打开密码 / 编辑密码），密码从用户级环境变量读取
//   5. 目标文件被 WPS/Excel 打开（WinError 5 拒绝访问）时每 10 分钟重试到 10:30

import { appendFile, mkdir, rm, rename, writeFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(projectRoot);

const logDir = join(projectRoot, "local-data", "logs");
const logPath = join(logDir, "jushuitan-export.log");
const runtimeDir = join(projectRoot, "local-data", "runtime");
const healthPath = join(runtimeDir, "jushuitan-export-health.json");
const pythonScript = join(projectRoot, "pipeline", "sync.py");
const defaultTarget = "D:\\麻大师\\日更数据\\商品管理\\15-聚水潭商品数据.xlsx";
const BUSY_RETRY_INTERVAL_MS = 10 * 60 * 1000; // 占用冲突每 10 分钟重试
const DEADLINE_HOUR = 10;
const DEADLINE_MINUTE = 30;

function safeMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1500);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFileBusyError(detail) {
  // WinError 5 = 拒绝访问；WinError 32 = 被其他程序使用；中文 WPS/Excel 占用的常见报错变体
  return /winerror\s*(5|32)|拒绝访问|permissionerror|占用|being\s+used|access\s+is\s+denied|another process|另一进程|另一程序|正在使用此文件/i.test(
    detail,
  );
}

function busyDeadline() {
  // 目标：今天 10:30 前每 10 分钟重试。手动晚跑（>10:30）时给 5 分钟窗口兜底。
  const now = new Date();
  const deadline = new Date(now);
  deadline.setHours(DEADLINE_HOUR, DEADLINE_MINUTE, 0, 0);
  if (deadline.getTime() <= now.getTime()) {
    deadline.setTime(now.getTime() + 5 * 60 * 1000);
  }
  return deadline;
}

function quickDelay() {
  // 非占用类瞬时错误（如 ERP 抖动）：30s 退避
  return 30_000 + Math.floor(Math.random() * 1_000);
}

const [{ acquireWarehouseLock }, { readLocalEnv }] = await Promise.all([
  import("../server/warehouse-lock.mjs"),
  import("../server/local-env.mjs"),
]);

// 与 sync-warehouse.mjs 一致：补设 PYTHON 环境变量
if (!process.env.PYTHON) {
  const py = readLocalEnv("PYTHON");
  if (py) process.env.PYTHON = py;
}

const target = readLocalEnv("JUSHUITAN_EXPORT_TARGET", defaultTarget);
// 文档加密密码：不写进代码/日志，从用户级环境变量读取
const openPassword = readLocalEnv("JUSHUITAN_OPEN_PASSWORD", "");
const writePassword = readLocalEnv("JUSHUITAN_WRITE_PASSWORD", "");
const encrypted = Boolean(openPassword);
// 飞书 webhook 通知（数据新鲜度缺失时触发）。URL/secret 走环境变量，不硬编码。
const feishuWebhookUrl = readLocalEnv("FEISHU_JUSHUITAN_WEBHOOK_URL", "");
const feishuWebhookSecret = readLocalEnv("FEISHU_JUSHUITAN_WEBHOOK_SECRET", "");

// 飞书自定义机器人（签名校验）：HMAC-SHA256，key = "{timestamp}\n{secret}"，消息为空。
// （飞书官方算法：hmac.new(string_to_sign, msg=b'')，即 key 是 timestamp\nsecret）
async function sendFeishuText(text) {
  if (!feishuWebhookUrl || !feishuWebhookSecret) {
    await log(`飞书未配置（FEISHU_JUSHUITAN_WEBHOOK_URL/SECRET），跳过低数据通知`);
    return false;
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sign = createHmac("sha256", `${timestamp}\n${feishuWebhookSecret}`).digest("base64");
  const body = { timestamp, sign, msg_type: "text", content: { text } };
  try {
    const response = await fetch(feishuWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    const ok = result?.StatusCode === 0 || result?.code === 0;
    await log(`飞书通知 ${ok ? "发送成功" : `发送失败 code=${result?.code ?? "?"}`}：${text.slice(0, 60)}`);
    return ok;
  } catch (error) {
    await log(`飞书通知异常：${safeMessage(error)}`);
    return false;
  }
}

const lock = await acquireWarehouseLock("jushuitan-export-script");
if (!lock) {
  const message = "本地数仓同步或聚水潭导出正在运行，本次跳过";
  await log(message);
  console.log(JSON.stringify({ ok: true, skipped: true, reason: message }));
  process.exit(0);
}

const startedAt = new Date().toISOString();
const deadline = busyDeadline();
await writeHealth({ status: "running", startedAt, target, encrypted, deadline: deadline.toISOString() });
await log(`开始聚水潭导出，target=${target}，加密=${encrypted}，占用重试截止 ${deadline.toISOString()}`);

function buildArgs() {
  const args = [
    pythonScript,
    "export-jushuitan",
    "--sync",
    "--target",
    target,
    "--health-file",
    healthPath,
  ];
  if (encrypted) {
    args.push("--open-password", openPassword, "--write-password", writePassword);
  }
  return args;
}

function runPython() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON || "python", buildArgs(), {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        try {
          resolve({ code, payload: JSON.parse(stdout) });
        } catch (error) {
          reject(new Error(`无法解析 python 输出：${stdout.slice(0, 500)}`));
        }
      } else {
        reject(new Error(`python 退出码 ${code}：${stderr.slice(-1000) || stdout.slice(-1000)}`));
      }
    });
  });
}

let payload = null;
let attempt = 0;
let lastError = null;
let busyWaited = false;

try {
  while (true) {
    attempt += 1;
    try {
      await log(`尝试 ${attempt}`);
      payload = await runPython();
      break;
    } catch (error) {
      lastError = error;
      const detail = safeMessage(error);
      const now = new Date();
      if (isFileBusyError(detail) && now.getTime() < deadline.getTime()) {
        // 目标文件被 WPS/Excel 打开：等 10 分钟再试，直到 10:30
        busyWaited = true;
        const waitMs = Math.min(BUSY_RETRY_INTERVAL_MS, deadline.getTime() - now.getTime());
        await log(`目标文件被占用（可能正被 WPS 打开），${waitMs / 60000} 分钟后重试：${detail}`);
        await writeHealth({
          status: "waiting_file_unlock",
          startedAt,
          target,
          encrypted,
          attempts: attempt,
          reason: detail,
          nextRetryAt: new Date(now.getTime() + waitMs).toISOString(),
          deadline: deadline.toISOString(),
        });
        await sleep(waitMs);
        continue;
      }
      if (!isFileBusyError(detail) && attempt < 3) {
        // 非占用瞬时错误：短退避重试（上限 3 次）
        const delay = quickDelay();
        await log(`尝试 ${attempt} 失败，${Math.round(delay / 1000)}s 后重试：${detail}`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }

  const exportInfo = payload?.payload?.export ?? {};
  await writeHealth({
    status: "success",
    startedAt,
    finishedAt: new Date().toISOString(),
    attempts: attempt,
    target,
    encrypted,
    busyWaited,
    rows: exportInfo.rows ?? 0,
    columns: exportInfo.columns ?? 0,
    fileSize: exportInfo.file_size ?? 0,
    durationSeconds: exportInfo.duration_seconds ?? 0,
  });
  await log(
    `导出成功：rows=${exportInfo.rows} cols=${exportInfo.columns} size=${
      (exportInfo.file_size ?? 0) / 1024 / 1024
    }MB 最新付款日期=${exportInfo.max_payment_date ?? "?"} 数据新鲜=${exportInfo.data_fresh ?? true}` +
      (busyWaited ? "（占用等待后成功）" : ""),
  );
  // 数据新鲜度检查：输出缺昨天数据 → 飞书通知
  if (exportInfo.data_fresh === false) {
    const alertText =
      `⚠️ 聚水潭商品数据疑似滞后\n` +
      `最新付款日期：${exportInfo.max_payment_date ?? "无数据"}\n` +
      `生成时间：${new Date().toISOString()}\n` +
      `请检查聚水潭源文件是否已导出最新数据，或 9:45 任务是否漏跑。`;
    await sendFeishuText(alertText);
  }
  console.log(
    JSON.stringify({
      ok: true,
      rows: exportInfo.rows,
      columns: exportInfo.columns,
      fileSize: exportInfo.file_size,
      durationSeconds: exportInfo.duration_seconds,
      encrypted,
      busyWaited,
      maxPaymentDate: exportInfo.max_payment_date ?? null,
      dataFresh: exportInfo.data_fresh ?? true,
    }),
  );
} catch (error) {
  const detail = safeMessage(error);
  await writeHealth({
    status: "failed",
    startedAt,
    finishedAt: new Date().toISOString(),
    attempts: attempt,
    target,
    encrypted,
    error: detail,
  });
  await log(`导出失败：${detail}`);
  throw new Error(detail);
} finally {
  await lock.release();
}
