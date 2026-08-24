// 火山引擎 Ark Claude 兼容 API 客户端（最简 fetch 封装，不引 SDK）
// ponytail: 不做 retry / 流式 / 缓存；通过同源 /api/ark/call 代理调用，API key 留在服务端
// 参考 https://www.volcengine.com/docs/82379/1099455（Anthropic Messages API 兼容）

const ARK_MODEL = "deepseek-v4-flash-ga-260731";

export interface ArkMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ArkRequest {
  system?: string;
  messages: ArkMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ArkResponse {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
}

export class ArkAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArkAuthError";
  }
}

export class ArkApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Ark API ${status}: ${body.slice(0, 200)}`);
    this.name = "ArkApiError";
    this.status = status;
    this.body = body;
  }
}

export async function callArk(req: ArkRequest): Promise<ArkResponse> {
  const body = {
    model: ARK_MODEL,
    maxTokens: req.maxTokens ?? 2048,
    temperature: req.temperature ?? 0.7,
    system: req.system,
    messages: req.messages,
  };
  const res = await fetch("/api/ark/call", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errText = "";
    try {
      const json = (await res.json()) as { error?: string };
      errText = json.error ?? "";
    } catch {
      errText = await res.text();
    }
    if (res.status === 502 && errText.includes("鉴权")) {
      throw new ArkAuthError(errText);
    }
    if (res.status === 503) {
      throw new ArkAuthError(errText);
    }
    throw new ArkApiError(res.status, errText);
  }
  return (await res.json()) as ArkResponse;
}
