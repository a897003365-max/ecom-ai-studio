import type { HookType, WorkbenchProduct } from "../types/copyWorkbench";

export interface AIDraftInput {
  title: string;
  product: WorkbenchProduct;
  hookType: HookType;
  formula: string;
  persona: string;
  pain: string;
  benefit: string;
  cta: string;
}

export interface AIPlanStep {
  stage: "开头钩子" | "场景痛点" | "老款背书" | "新品卖点" | "活动利益" | "行动指令";
  angle: string;        // 自由发挥的策略角度
  evidence: string;     // 依据哪些用户输入
}

export interface AIPlan {
  steps: AIPlanStep[];   // 6 级漏斗对应 6 步
  hookName: string;      // 选用的钩子名（用户可见）
  reasoning: string;     // AI 给用户的简短说明
}

// 评估完整性：复用已有 3 项核心 + 1 推荐
export function evaluateCompleteness(input: AIDraftInput) {
  const missing: { key: keyof AIDraftInput; label: string; question: string; required: boolean }[] = [];
  if (!input.title.trim()) missing.push({ key: "title", label: "标题/选题", question: "文案要围绕什么选题？请用一句话描述", required: true });
  if (!input.pain.trim()) missing.push({ key: "pain", label: "核心痛点", question: "目标用户的痛点是什么？", required: true });
  if (!input.cta.trim()) missing.push({ key: "cta", label: "CTA 行动指令", question: "希望观众做什么？", required: true });
  if (!input.formula.trim()) missing.push({ key: "formula", label: "套用公式（推荐）", question: "需要选一个钩子公式吗？", required: false });
  return { ready: missing.filter((m) => m.required).length === 0, missing };
}

// 6 级漏斗 stage 标签（与 FUNNEL 对齐）
const STAGES: AIPlanStep["stage"][] = ["开头钩子", "场景痛点", "老款背书", "新品卖点", "活动利益", "行动指令"];

const SYSTEM_PROMPT = `你是抖音电商床垫/家居直播间的爆款文案策划师，遵循合规底线（不用「0胶水/零甲醛/护脊/100%/最好/绝对/治疗/根治/清仓搬家/最后一天/全网最低」等高危词，医疗化表述改为「支撑/承托/睡醒轻松」等）。

你的任务分两步：
1) 用户给出选题/产品/钩子/公式/人群/痛点/利益/CTA 后，**先输出「文案计划」**：6 段（开头钩子/场景痛点/老款背书/新品卖点/活动利益/行动指令），每段说明「采用什么策略角度」「依据用户哪些输入」。
2) 用户确认计划后，**再依据计划输出完整文案**：约 120-160 字，结构清晰、可直接念出口播。

JSON 输出格式：
第一步（计划）：
{
  "hookName": "选用的钩子名（短）",
  "reasoning": "一句话说明整体策略方向",
  "steps": [
    {"stage":"开头钩子","angle":"…","evidence":"…"},
    {"stage":"场景痛点","angle":"…","evidence":"…"},
    {"stage":"老款背书","angle":"…","evidence":"…"},
    {"stage":"新品卖点","angle":"…","evidence":"…"},
    {"stage":"活动利益","angle":"…","evidence":"…"},
    {"stage":"行动指令","angle":"…","evidence":"…"}
  ]
}
第二步（文案）：纯文本，不带 JSON、不带标签前缀。`;

export function buildPlanPrompt(input: AIDraftInput, formulaDesc?: string): { system: string; user: string } {
  const userJson = JSON.stringify({
    title: input.title,
    product: input.product,
    hookType: input.hookType,
    formula: input.formula,
    formulaDesc: formulaDesc ?? "",
    persona: input.persona,
    pain: input.pain,
    benefit: input.benefit,
    cta: input.cta,
  }, null, 2);
  return {
    system: SYSTEM_PROMPT,
    user: `请先输出「文案计划」JSON。\n\n用户输入：\n\`\`\`json\n${userJson}\n\`\`\``,
  };
}

export function buildDraftPrompt(input: AIDraftInput, plan: AIPlan): { system: string; user: string } {
  const planText = plan.steps.map((s) => `【${s.stage}】策略：${s.angle}\n依据：${s.evidence}`).join("\n\n");
  return {
    system: SYSTEM_PROMPT,
    user: `用户已确认计划，请依据计划输出完整文案（约 120-160 字，可直接念出口播）。\n\n计划：\n${planText}\n\n用户原始输入：\n${JSON.stringify({ title: input.title, product: input.product, hookType: input.hookType, formula: input.formula, persona: input.persona, pain: input.pain, benefit: input.benefit, cta: input.cta }, null, 2)}`,
  };
}

// 从 LLM 文本中解析 JSON（首段 {...} 块）
export function parsePlanJson(text: string): AIPlan | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const json = JSON.parse(match[0]) as { hookName?: string; reasoning?: string; steps?: AIPlanStep[] };
    if (!Array.isArray(json.steps) || json.steps.length !== 6) return null;
    return {
      hookName: json.hookName ?? "未命名",
      reasoning: json.reasoning ?? "",
      steps: json.steps.map((s, i) => ({
        stage: STAGES[i] ?? s.stage,
        angle: s.angle ?? "",
        evidence: s.evidence ?? "",
      })),
    };
  } catch {
    return null;
  }
}
