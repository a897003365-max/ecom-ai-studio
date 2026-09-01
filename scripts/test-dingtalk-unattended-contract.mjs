import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [schedule, syncScript, api, server, storage] = await Promise.all([
  readFile(new URL("./register-dingtalk-schedule.ps1", import.meta.url), "utf8"),
  readFile(new URL("./sync-dingtalk.mjs", import.meta.url), "utf8"),
  readFile(new URL("../server/dingtalk-api.mjs", import.meta.url), "utf8"),
  readFile(new URL("../server/index.mjs", import.meta.url), "utf8"),
  readFile(new URL("../server/storage.mjs", import.meta.url), "utf8"),
]);

assert(/New-ScheduledTaskPrincipal/.test(schedule), "无人值守计划任务缺少显式 Principal 配置");
assert(/-LogonType\s+S4U/i.test(schedule), "计划任务仍依赖用户交互登录");
assert(/-RestartCount\s+\d+/.test(schedule), "计划任务失败后没有自动重启次数");
assert(/-RestartInterval/.test(schedule), "计划任务失败后没有重启间隔");
assert(/-RunOnlyIfNetworkAvailable/.test(schedule), "计划任务没有网络可用条件");
assert(/DINGTALK_SYNC_ATTEMPTS/.test(syncScript), "同步脚本没有可配置的无人值守重试次数");
assert(/retry|重试/i.test(syncScript), "同步脚本没有失败重试逻辑");
assert(/500\|502\|503\|504/.test(syncScript), "同步脚本未将钉钉 HTTP 500 纳入瞬时错误重试范围");
assert(/AbortSignal\.timeout/.test(api), "钉钉请求没有超时控制，可能阻塞无人值守任务");
assert(/new Set\(\[500, 502, 503, 504\]\)/.test(api), "钉钉 API 请求层未对 HTTP 500 自动重试");
assert(/listSyncRuns\(/.test(server) && /dingtalk/.test(server), "服务端未暴露钉钉同步运行状态");
assert(/running|failed|success/.test(storage), "同步存储未保留可用于无人值守监控的运行状态");

console.log("dingtalk unattended contract ok");
