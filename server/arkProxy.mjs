// 火山 Ark LLM 代理：服务端持有 API key，避免泄露到客户端 bundle。
// 端点：POST /api/ark/call  →  转发到方舟 coding 端点（OpenAI 兼容，Bearer 鉴权）。
// 说明：本仓库 ARK_API_KEY 为方舟账号 key，deepseek-v4-flash-ga 仅通过 coding 端点启用；
//      标准 /api/v3/messages（Anthropic）与 /api/v3/chat/completions 对该模型均不可用。
import https from "node:https";

const ARK_ENDPOINT = "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions";
const ARK_TIMEOUT_MS = 60_000;
const ARK_MODEL = "deepseek-v4-flash-ga-260731";

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > 1024 * 1024) {
        req.destroy();
        reject(new Error("payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

export async function handleArkCall(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "POST only" });
    return;
  }
  const apiKey = process.env.ARK_API_KEY?.trim();
  if (!apiKey) {
    sendJson(res, 503, { error: "服务端未配置 ARK_API_KEY，请在 .env 中填入后重启服务" });
    return;
  }
  let payload;
  try {
    payload = await readJson(req);
  } catch (error) {
    sendJson(res, 400, { error: `请求体解析失败：${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  if (!payload.system || !Array.isArray(payload.messages) || payload.messages.length === 0) {
    sendJson(res, 400, { error: "缺少 system / messages 字段" });
    return;
  }

  const upstream = await new Promise((resolve, reject) => {
    const url = new URL(ARK_ENDPOINT);
    // 前端走 Anthropic 风格的 {system, messages}；chat/completions 需要把 system 并成首条 system 消息
    const body = JSON.stringify({
      model: payload.model ?? ARK_MODEL,
      max_tokens: payload.maxTokens ?? 2048,
      temperature: payload.temperature ?? 0.7,
      messages: [
        ...(payload.system ? [{ role: "system", content: payload.system }] : []),
        ...payload.messages,
      ],
    });
    const proxyReq = https.request(
      {
        hostname: url.hostname,

        path: url.pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          authorization: `Bearer ${apiKey}`,
        },
        timeout: ARK_TIMEOUT_MS,
      },
      (proxyRes) => {
        const chunks = [];
        proxyRes.on("data", (chunk) => chunks.push(chunk));
        proxyRes.on("end", () => resolve({ status: proxyRes.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        proxyRes.on("error", reject);
      },
    );
    proxyReq.on("timeout", () => proxyReq.destroy(new Error("upstream timeout")));
    proxyReq.on("error", reject);
    proxyReq.write(body);
    proxyReq.end();
  });

  if (upstream.status === 401 || upstream.status === 403) {
    sendJson(res, 502, { error: "火山 Ark 鉴权失败，请检查服务端 ARK_API_KEY 是否有效" });
    return;
  }
  if (upstream.status !== 200) {
    // 安全：上游 body 仅写入服务端日志，不透传给客户端
    console.error(`[arkProxy] upstream ${upstream.status}: ${upstream.body.slice(0, 500)}`);
    sendJson(res, 502, { error: `Ark 上游服务返回错误（状态 ${upstream.status}），请稍后重试` });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(upstream.body);
  } catch {
    sendJson(res, 502, { error: "上游响应非 JSON" });
    return;
  }
  const text = parsed.choices?.[0]?.message?.content ?? "";
  sendJson(res, 200, { text, usage: parsed.usage });
}
