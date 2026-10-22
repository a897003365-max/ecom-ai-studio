// 小红书舆情分析 LLM provider 可达性与响应速度测试：
// 对 .env 中已配置的 DASHSCOPE / ARK / KIMI key，逐个发送与 server/sentiment.mjs 一致的请求，
// 各跑 N 轮，按平均延迟给出优先级建议（写入 SENTIMENT_PROVIDER_ORDER）。
// 用法：node scripts/test-llm-key-priority.mjs
// 说明：只输出 provider 名 / 状态 / 延迟，不输出任何 key 或完整响应体。
import "dotenv/config";
import https from "node:https";
import { performance } from "node:perf_hooks";

const ROUNDS = Number(process.env.LLM_ROUNDS) || 3;
const TIMEOUT_MS = 45_000;
const SYSTEM = "你是电商舆情分析师，只输出最简中文答案。";
const PROMPT = "请用一句话回答：2026 年 9 月 7 日是星期几？";

function httpsPostJson(url, body, headers) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: target.hostname,
        path: target.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

const providers = [
  {
    id: "dashscope",
    label: "DashScope qwen-max",
    key: process.env.DASHSCOPE_API_KEY,
    async call() {
      const res = await httpsPostJson(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
        {
          model: process.env.SENTIMENT_MODEL || "qwen-max",
          input: {
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: PROMPT },
            ],
          },
          parameters: { result_format: "message", temperature: 0.3 },
        },
        { Authorization: `Bearer ${this.key}` },
      );
      if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${res.body.slice(0, 200)}`);
      const p = JSON.parse(res.body);
      const text = p?.output?.choices?.[0]?.message?.content;
      if (!text) throw new Error("无输出文本");
      return text;
    },
  },
  {
    id: "ark",
    label: "Ark deepseek-v4-flash(max推理)",
    key: process.env.ARK_API_KEY,
    async call() {
      const res = await httpsPostJson(
        "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions",
        {
          model: process.env.ARK_SENTIMENT_MODEL || "deepseek-v4-flash-ga-260731",
          max_tokens: 16384,
          temperature: 0.3,
          reasoning_effort: process.env.ARK_REASONING || "max",
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: PROMPT },
          ],
        },
        { Authorization: `Bearer ${this.key}` },
      );
      if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${res.body.slice(0, 200)}`);
      const p = JSON.parse(res.body);
      const text = p?.choices?.[0]?.message?.content;
      if (!text) throw new Error("无输出文本");
      return text;
    },
  },
  {
    id: "kimi",
    label: `Kimi ${process.env.SENTIMENT_KIMI_MODEL || "kimi-k2.7-code-highspeed"}`,
    key: process.env.KIMI_API_KEY,
    async call() {
      const baseUrl = (process.env.KIMI_BASE_URL || "https://api.moonshot.cn").replace(/\/+$/, "");
      const effort = process.env.KIMI_REASONING;
      const body = {
        model: process.env.SENTIMENT_KIMI_MODEL || "kimi-k2.6",
        max_tokens: 16384,
        // k2.6 等推理模型只允许 temperature=1
        temperature: 1,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: PROMPT },
        ],
      };
      if (effort) body.reasoning_effort = effort;
      const res = await httpsPostJson(
        `${baseUrl}/v1/chat/completions`,
        body,
        { Authorization: `Bearer ${this.key}` },
      );
      if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${res.body.slice(0, 200)}`);
      const parsed = JSON.parse(res.body);
      const text = parsed?.choices?.[0]?.message?.content;
      if (!text) throw new Error("无输出文本");
      return text;
    },
  },
].filter((p) => p.key?.trim());

// 可选：LLM_ONLY=dashscope,kimi 只测指定 provider（排障用）
const onlyNames = (process.env.LLM_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const activeProviders = onlyNames.length ? providers.filter((p) => onlyNames.includes(p.id)) : providers;

if (activeProviders.length === 0) {
  console.log("未配置任何 DASHSCOPE_API_KEY / ARK_API_KEY / KIMI_API_KEY，无法测试。");
  process.exit(1);
}

const results = [];
for (const provider of activeProviders) {
  const times = [];
  const marks = [];
  let lastFail = null;
  for (let r = 1; r <= ROUNDS; r += 1) {
    const start = performance.now();
    try {
      await provider.call();
      marks.push("OK");
      times.push(Math.round(performance.now() - start));
    } catch (error) {
      lastFail = error.message;
      marks.push("FAIL");
      times.push(null);
    }
  }
  const okTimes = times.filter((t) => t !== null);
  results.push({
    id: provider.id,
    label: provider.label,
    okCount: okTimes.length,
    avg: okTimes.length ? Math.round(okTimes.reduce((a, b) => a + b, 0) / okTimes.length) : null,
    times,
    marks,
    lastFail,
  });
}

console.log(`=== LLM provider 速度测试（每个 ${ROUNDS} 轮，单位 ms）===\n`);
console.log("provider".padEnd(30), "R1", "R2", "R3", "均延迟", "状态");
for (const r of results) {
  const cells = r.times.map((t) => (t === null ? "  -  " : String(t).padEnd(5)));
  console.log(r.label.padEnd(30), ...cells, r.avg === null ? "-" : r.avg + "ms", `${r.okCount}/${ROUNDS} OK`);
  if (r.okCount < ROUNDS && r.lastFail) {
    console.log("  └ 失败原因：".padEnd(34), r.lastFail);
  }
}
console.log("");
const ranked = [...results].sort((a, b) => (a.avg === null ? 1e9 : a.avg) - (b.avg === null ? 1e9 : b.avg));
console.log("按平均延迟推荐优先级：");
console.log(ranked.map((r, i) => `${i + 1}. ${r.id}${r.avg === null ? "（不可用）" : `（平均 ${r.avg}ms）`}`).join("\n"));
console.log("\n建议写入 .env：SENTIMENT_PROVIDER_ORDER=" + ranked.map((r) => r.id).join(","));