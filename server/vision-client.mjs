/**
 * vision-client.mjs
 *
 * 多 Provider Vision API 客户端（自动识别 + 限流故障转移）
 *
 * 支持的 provider（按 .env 里存在的 key 自动启用，默认顺序：ark 优先）：
 *   1. ark        火山方舟    ARK_API_KEY         模型 kimi-k2.7-code，走 coding 端点（ARK_VISION_MODEL / ARK_VISION_ENDPOINT 可覆盖）
 *   2. dashscope  阿里云百炼  DASHSCOPE_API_KEY   模型 qwen-vl-max（VISION_MODEL 可覆盖）
 *   3. openrouter OpenRouter  OPENROUTER_API_KEY  模型 google/gemma-4-31b-it:free（VISION_MODEL 带斜杠时覆盖）
 *
 * 兼容：DASHSCOPE_API_KEY 填了 sk-or-v1-* 会自动识别为 openrouter。
 * 顺序可用 VISION_PROVIDER_ORDER="dashscope,ark,openrouter" 覆盖。
 *
 * 故障转移：单 provider 内 429/5xx 指数退避重试；402/耗尽/连续失败 → 切换下一 provider。
 * （2026-08-27 修订：ark 默认模型 kimi-k2.7-code）
 *
 * 输入：图片文件路径 + prompt
 * 输出：结构化 JSON 或错误标记
 */
import { readFileSync } from "node:fs";
import { extname, basename } from "node:path";

const DASHSCOPE_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
// 用户账号是火山方舟 coding 套餐：模型走 /api/coding/v3/ 端点（report 模块已验证可用）
const ARK_ENDPOINT = "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions";

export class VisionKeyMissingError extends Error {
  constructor() {
    super("未配置任何 Vision key（DASHSCOPE_API_KEY / ARK_API_KEY / OPENROUTER_API_KEY 任一）");
    this.name = "VisionKeyMissingError";
  }
}

export class VisionApiError extends Error {
  constructor(status, body, provider) {
    super(`Vision API 调用失败 [${provider}] (HTTP ${status}): ${body}`);
    this.name = "VisionApiError";
    this.status = status;
    this.body = body;
    this.provider = provider;
  }
}

// ---------- Provider 注册表 ----------

function buildProviders() {
  const providers = [];
  const dashKey = (process.env.DASHSCOPE_API_KEY || "").trim();
  const arkKey = (process.env.ARK_API_KEY || "").trim();
  const orKey = (process.env.OPENROUTER_API_KEY || "").trim();
  const envModel = (process.env.VISION_MODEL || "").trim();

  // DASHSCOPE_API_KEY 误填 OpenRouter key 的兼容识别
  const dashIsOpenRouter = dashKey.startsWith("sk-or-v1-");

  // ark 优先：用户指定的主力视觉渠道（coding 套餐 kimi-k2.7-code）
  if (arkKey) {
    providers.push({
      id: "ark",
      apiKey: arkKey,
      endpoint: process.env.ARK_VISION_ENDPOINT || ARK_ENDPOINT,
      model: process.env.ARK_VISION_MODEL || "kimi-k2.7-code",
      style: "openai", // 方舟 coding /api/coding/v3/chat/completions 是 OpenAI 兼容
    });
  }
  if (dashKey && !dashIsOpenRouter) {
    providers.push({
      id: "dashscope",
      apiKey: dashKey,
      endpoint: DASHSCOPE_ENDPOINT,
      model: envModel && !envModel.includes("/") ? envModel : "qwen-vl-max",
      style: "dashscope",
    });
  }
  const effectiveOrKey = orKey || (dashIsOpenRouter ? dashKey : "");
  if (effectiveOrKey) {
    providers.push({
      id: "openrouter",
      apiKey: effectiveOrKey,
      endpoint: OPENROUTER_ENDPOINT,
      model: envModel.includes("/") ? envModel : "google/gemma-4-31b-it:free",
      style: "openai",
    });
  }

  // 显式顺序覆盖：VISION_PROVIDER_ORDER="ark,dashscope,openrouter"
  const order = (process.env.VISION_PROVIDER_ORDER || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (order.length > 0) {
    providers.sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }
  return providers;
}

function getConfig() {
  return {
    providers: buildProviders(),
    concurrency: Math.max(1, Number(process.env.VISION_CONCURRENCY) || 5),
    // 免费/共享池限流频繁：默认 4 次重试
    maxRetries: Math.max(0, Number(process.env.VISION_MAX_RETRIES) || 4),
    timeoutMs: Math.max(10000, Number(process.env.VISION_TIMEOUT_MS) || 90000),
  };
}

export function hasVisionKey() {
  return buildProviders().length > 0;
}

/** 供状态接口展示当前可用渠道（不泄露 key） */
export function visionProviderInfo() {
  return buildProviders().map((p) => ({ id: p.id, model: p.model }));
}

// 图片编码为 base64 data URL
function imageToDataUrl(filePath) {
  const buf = readFileSync(filePath);
  const ext = extname(filePath).toLowerCase().replace(".", "");
  const mime =
    ext === "jpg" || ext === "jpeg" ? "image/jpeg"
    : ext === "png" ? "image/png"
    : ext === "webp" ? "image/webp"
    : "application/octet-stream";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- 两种 API 风格的请求/解析 ----------

function buildPayload(provider, dataUrl, prompt) {
  if (provider.style === "dashscope") {
    return {
      model: provider.model,
      input: {
        messages: [
          { role: "user", content: [{ image: dataUrl }, { text: prompt }] },
        ],
      },
      parameters: { result_format: "message" },
    };
  }
  // OpenAI 兼容（ark / openrouter）
  return {
    model: provider.model,
    // kimi-k2.7-code 推理消耗 token：4000 不够会导致 JSON 中途截断（实测 5/27 失败均无右括号）
    max_tokens: Number(process.env.VISION_MAX_TOKENS) || 16000,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: prompt },
        ],
      },
    ],
  };
}

function parseResponse(provider, data) {
  if (provider.style === "dashscope") {
    const choices = data?.output?.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new VisionApiError(200, "响应缺少 choices", provider.id);
    }
    const content = choices[0]?.message?.content;
    return Array.isArray(content) ? content.map((c) => c.text || "").join("") : String(content ?? "");
  }
  const choices = data?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new VisionApiError(200, "响应缺少 choices", provider.id);
  }
  const content = choices[0]?.message?.content;
  return Array.isArray(content) ? content.map((c) => c.text || "").join("") : String(content ?? "");
}

// 判断错误是否值得换 provider（402 额度尽 / 模型不存在）vs 仅重试（429/5xx/超时）
function shouldFailover(status) {
  return status === 402 || status === 404;
}

// ---------- 单张分析：provider 内重试 + provider 间故障转移 ----------

async function analyzeWithProvider({ provider, dataUrl, prompt, config, attempt = 0 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(provider.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildPayload(provider, dataUrl, prompt)),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if ((response.status === 429 || response.status >= 500) && attempt < config.maxRetries) {
        // 限流退避：429 用更长等待（共享池），5xx 短退避
        const base = response.status === 429 ? 8000 : 2000;
        await sleep(base * Math.pow(2, attempt));
        return analyzeWithProvider({ provider, dataUrl, prompt, config, attempt: attempt + 1 });
      }
      throw new VisionApiError(response.status, body.slice(0, 300), provider.id);
    }
    return parseResponse(provider, await response.json());
  } catch (error) {
    clearTimeout(timer);
    if (error.name === "AbortError") {
      if (attempt < config.maxRetries) {
        await sleep(2000 * Math.pow(2, attempt));
        return analyzeWithProvider({ provider, dataUrl, prompt, config, attempt: attempt + 1 });
      }
      throw new VisionApiError(0, `超时 ${config.timeoutMs}ms`, provider.id);
    }
    throw error;
  }
}

async function analyzeOne({ imagePath, prompt, config }) {
  if (config.providers.length === 0) throw new VisionKeyMissingError();
  const dataUrl = imageToDataUrl(imagePath);

  const errors = [];
  for (const provider of config.providers) {
    try {
      const text = await analyzeWithProvider({ provider, dataUrl, prompt, config });
      return { imagePath, imageFile: basename(imagePath), text, provider: provider.id };
    } catch (error) {
      errors.push(`${provider.id}: ${error.message.slice(0, 120)}`);
      if (error instanceof VisionApiError && shouldFailover(error.status)) {
        console.warn(`[vision] ${provider.id} 不可用(${error.status})，切换到下一 provider`);
        continue;
      }
      console.warn(`[vision] ${provider.id} 失败：${error.message}，尝试下一 provider`);
    }
  }
  // 聚合所有 provider 的失败原因，不再只报最后一个
  const aggregate = new VisionApiError(0, `全部渠道失败 | ${errors.join(" | ")}`, "all");
  throw aggregate;
}

/**
 * 批量分析（自动并发控制 + 多 provider 故障转移）
 *
 * @param {Array<{imagePath: string, context?: any}>} items 待分析的图片列表
 * @param {(context: any) => string} promptBuilder 根据上下文生成 prompt
 * @param {(progress: {processed: number, total: number, current: string, error?: string, provider?: string, result?: object}) => void} onProgress 进度回调（result 为刚完成的单条完整结果，供增量落盘）
 * @param {{shouldCancel?: () => boolean}} options 取消钩子：返回 true 时停止派发新任务
 * @returns {Promise<{results: Array, cancelled: boolean}>}
 */
export async function analyzeBatch(items, promptBuilder, onProgress, options = {}) {
  const config = getConfig();
  if (config.providers.length === 0) throw new VisionKeyMissingError();

  const total = items.length;
  const results = new Array(total);
  let processed = 0;
  let index = 0;
  let cancelled = false;

  async function worker() {
    while (index < total) {
      if (options.shouldCancel && options.shouldCancel()) {
        cancelled = true;
        return;
      }
      const myIndex = index++;
      const item = items[myIndex];
      const prompt = promptBuilder(item.context);
      try {
        const out = await analyzeOne({ imagePath: item.imagePath, prompt, config });
        results[myIndex] = { ...out, context: item.context };
      } catch (error) {
        results[myIndex] = {
          imagePath: item.imagePath,
          imageFile: basename(item.imagePath),
          context: item.context,
          error: error.message,
        };
      }
      processed++;
      if (onProgress) {
        onProgress({
          processed,
          total,
          current: basename(item.imagePath),
          error: results[myIndex]?.error,
          provider: results[myIndex]?.provider,
          result: results[myIndex],
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(config.concurrency, total) }, worker);
  await Promise.all(workers);
  return { results: results.filter(Boolean), cancelled };
}
