/**
 * vision-client.mjs
 *
 * 通义千问 Vision API (DashScope) 客户端封装
 * 特性：
 *   - 可配置并发度（默认 5，从 env 覆盖）
 *   - 自动重试（429/500/超时）
 *   - 错误宽容：单张失败不影响批次
 *   - 无 Key 时抛专用异常，供上层降级
 *
 * 输入：图片文件路径 + prompt
 * 输出：结构化 JSON 或错误标记
 */
import { readFileSync } from "node:fs";
import { extname, basename } from "node:path";

const DASHSCOPE_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

export class VisionKeyMissingError extends Error {
  constructor() {
    super("DASHSCOPE_API_KEY 未配置，无法调用 Vision API");
    this.name = "VisionKeyMissingError";
  }
}

export class VisionApiError extends Error {
  constructor(status, body) {
    super(`Vision API 调用失败 (HTTP ${status}): ${body}`);
    this.name = "VisionApiError";
    this.status = status;
    this.body = body;
  }
}

function getConfig() {
  return {
    apiKey: process.env.DASHSCOPE_API_KEY || "",
    concurrency: Math.max(1, Number(process.env.VISION_CONCURRENCY) || 5),
    maxRetries: Math.max(0, Number(process.env.VISION_MAX_RETRIES) || 2),
    model: process.env.VISION_MODEL || "qwen-vl-max",
    timeoutMs: Math.max(10000, Number(process.env.VISION_TIMEOUT_MS) || 90000),
  };
}

export function hasVisionKey() {
  return !!(process.env.DASHSCOPE_API_KEY && process.env.DASHSCOPE_API_KEY.trim());
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

// 睡眠工具
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 单张图片分析（含重试）
async function analyzeOne({ imagePath, prompt, config, attempt = 0 }) {
  if (!config.apiKey) throw new VisionKeyMissingError();

  const dataUrl = imageToDataUrl(imagePath);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  const payload = {
    model: config.model,
    input: {
      messages: [
        {
          role: "user",
          content: [
            { image: dataUrl },
            { text: prompt },
          ],
        },
      ],
    },
    parameters: {
      result_format: "message",
    },
  };

  try {
    const response = await fetch(DASHSCOPE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // 429 / 5xx 重试
      if ((response.status === 429 || response.status >= 500) && attempt < config.maxRetries) {
        const backoff = 1000 * Math.pow(2, attempt);
        await sleep(backoff);
        return analyzeOne({ imagePath, prompt, config, attempt: attempt + 1 });
      }
      throw new VisionApiError(response.status, body.slice(0, 300));
    }

    const data = await response.json();
    // dashscope 返回结构:
    // { output: { choices: [{ message: { content: [{ text: '...' }] } }] } }
    const choices = data?.output?.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new VisionApiError(200, "响应缺少 choices");
    }
    const content = choices[0]?.message?.content;
    const text = Array.isArray(content)
      ? content.map((c) => c.text || "").join("")
      : String(content ?? "");

    return { imagePath, imageFile: basename(imagePath), text, raw: data };
  } catch (error) {
    clearTimeout(timer);
    if (error.name === "AbortError") {
      if (attempt < config.maxRetries) {
        await sleep(1000 * Math.pow(2, attempt));
        return analyzeOne({ imagePath, prompt, config, attempt: attempt + 1 });
      }
      throw new VisionApiError(0, `超时 ${config.timeoutMs}ms`);
    }
    throw error;
  }
}

/**
 * 批量分析（自动并发控制）
 *
 * @param {Array<{imagePath: string, context?: any}>} items 待分析的图片列表
 * @param {(context: any) => string} promptBuilder 根据上下文生成 prompt
 * @param {(progress: {processed: number, total: number, current: string, error?: string}) => void} onProgress 进度回调
 * @returns {Promise<Array<{imagePath, imageFile, text?, error?, context}>>}
 */
export async function analyzeBatch(items, promptBuilder, onProgress) {
  const config = getConfig();
  if (!config.apiKey) throw new VisionKeyMissingError();

  const total = items.length;
  const results = new Array(total);
  let processed = 0;
  let index = 0;

  async function worker() {
    while (index < total) {
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
          error: results[myIndex].error,
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(config.concurrency, total) }, worker);
  await Promise.all(workers);
  return results;
}
