import { useEffect, useState } from "react";
import { COPY_STATUSES, FORMULAS_F, FORMULAS_H, HOOK_TYPES, WORKBENCH_PRODUCTS, todayStr } from "../../data/copyWorkbench";
import type { CopyItem, CopyStatus, HookType, WorkbenchProduct } from "../../types/copyWorkbench";
import { buildDraftPrompt, buildPlanPrompt, evaluateCompleteness, parsePlanJson } from "../../data/aiPlanGenerator";
import type { AIPlan, AIPlanStep } from "../../data/aiPlanGenerator";
import { callArk, ArkAuthError } from "../../services/volcengineClient";
import { WorkbenchModal } from "./WorkbenchModal";

interface CopyModalProps {
  copy: CopyItem | null;
  open: boolean;
  preset?: { hookType: HookType; formula: string; title: string };
  onClose: () => void;
  onSave: (input: Partial<CopyItem> & { title: string }) => void;
  onOpenFormulas?: () => void;
}

type AIStep = "off" | "collect" | "plan" | "draft";

export function CopyModal({ copy, open, preset, onClose, onSave, onOpenFormulas }: CopyModalProps) {
  const [title, setTitle] = useState("");
  const [product, setProduct] = useState<WorkbenchProduct>("豆芽Hit");
  const [hookType, setHookType] = useState<HookType>("场景共情代入");
  const [formula, setFormula] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [body, setBody] = useState("");
  const [persona, setPersona] = useState("");
  const [pain, setPain] = useState("");
  const [benefit, setBenefit] = useState("");
  const [cta, setCta] = useState("");
  const [status, setStatus] = useState<CopyStatus>("灵感");

  const [aiStep, setAiStep] = useState<AIStep>("off");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPlan, setAiPlan] = useState<AIPlan | null>(null);

  // 打开时同步当前值（以 key 变化触发重填），用 useEffect 避免 render 期 setState
  const modalKey = copy ? copy.id : preset ? `preset:${preset.formula}` : "new";
  const openKey = open ? modalKey : "";
  useEffect(() => {
    if (!open) return;
    setTitle(copy?.title ?? preset?.title ?? "");
    setProduct(copy?.product ?? "豆芽Hit");
    setHookType(copy?.hookType ?? preset?.hookType ?? "场景共情代入");
    setFormula(copy?.formula ?? preset?.formula ?? "");
    setDueDate(copy?.dueDate ?? todayStr());
    setBody(copy?.body ?? "");
    setPersona(copy?.persona ?? "");
    setPain(copy?.pain ?? "");
    setBenefit(copy?.benefit ?? "");
    setCta(copy?.cta ?? "");
    setStatus(copy?.status ?? "灵感");
    setAiStep("off");
    setAiError(null);
    setAiPlan(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅依赖 openKey 触发重填
  }, [openKey]);

  function gatherInput() {
    return { title, product, hookType, formula, persona, pain, benefit, cta, body };
  }

  function updatePlanStep(index: number, patch: Partial<AIPlanStep>) {
    setAiPlan((prev) => {
      if (!prev) return prev;
      return { ...prev, steps: prev.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) };
    });
  }

  async function handleAiEvaluate() {
    const result = evaluateCompleteness(gatherInput());
    if (!result.ready) {
      setAiStep("collect");
      setAiError(`还需补充：${result.missing.map((m) => m.label).join("、")}`);
      return;
    }
    setAiStep("plan");
    await handleAiPlan();
  }

  async function handleAiPlan() {
    setAiLoading(true);
    setAiError(null);
    try {
      const input = gatherInput();
      const formulaDesc = [...FORMULAS_F, ...FORMULAS_H].find((f) => f.code === input.formula)?.desc;
      const { system, user } = buildPlanPrompt(input, formulaDesc);
      const res = await callArk({ system, messages: [{ role: "user", content: user }] });
      const plan = parsePlanJson(res.text);
      if (!plan) throw new Error("AI 返回的计划格式无法解析，请重试或手动填写");
      setAiPlan(plan);
      setAiStep("plan");
    } catch (error) {
      setAiError(error instanceof ArkAuthError ? error.message : `生成计划失败：${(error as Error).message}`);
    } finally {
      setAiLoading(false);
    }
  }

  async function handleAiDraft() {
    if (!aiPlan) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const { system, user } = buildDraftPrompt(gatherInput(), aiPlan);
      const res = await callArk({ system, messages: [{ role: "user", content: user }] });
      setBody(res.text.trim());
      setAiStep("off");
    } catch (error) {
      setAiError(`生成文案失败：${(error as Error).message}`);
    } finally {
      setAiLoading(false);
    }
  }

  function save() {
    if (!title.trim()) {
      alert("请填写标题");
      return;
    }
    onSave({
      title: title.trim(),
      product,
      hookType,
      formula: formula.trim(),
      dueDate,
      body: body.trim(),
      persona: persona.trim(),
      pain: pain.trim(),
      benefit: benefit.trim(),
      cta: cta.trim(),
      status,
    });
  }

  return (
    <WorkbenchModal
      title={copy ? "编辑文案" : "新建文案"}
      open={open}
      onClose={onClose}
      onCancel={onClose}
      onSave={save}
      saveLabel={copy ? "保存修改" : "创建文案"}
      wide
    >
      {aiStep !== "off" && renderAiPanel()}
      <div className="grid gap-1">
        <label className="text-[11px] text-[var(--muted-2)]" htmlFor="copy-title">标题 / 选题</label>
        <input id="copy-title" className="field" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="如：试睡兜底·豆芽Hit开箱实测" />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-[11px] text-[var(--muted-2)]" htmlFor="copy-product">产品</label>
          <select id="copy-product" className="field" value={product} onChange={(event) => setProduct(event.target.value as WorkbenchProduct)}>
            {WORKBENCH_PRODUCTS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <label className="text-[11px] text-[var(--muted-2)]" htmlFor="copy-hook">钩子类型</label>
          <select id="copy-hook" className="field" value={hookType} onChange={(event) => setHookType(event.target.value as HookType)}>
            {HOOK_TYPES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-[11px] text-[var(--muted-2)]" htmlFor="copy-formula">套用公式（如 F-01 / H-12）</label>
          <input id="copy-formula" className="field" value={formula} onChange={(event) => setFormula(event.target.value)} placeholder="可留空" />
        </div>
        <div className="grid gap-1">
          <label className="text-[11px] text-[var(--muted-2)]" htmlFor="copy-duedate">截止日期</label>
          <input id="copy-duedate" className="field" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </div>
      </div>
      <div className="mt-3 grid gap-1">
        <label className="text-[11px] text-[var(--muted-2)]" htmlFor="copy-body">完整文案（钩子 → 痛点 → 卖点 → 利益 → CTA）</label>
        <textarea id="copy-body" className="field !min-h-[120px]" value={body} onChange={(event) => setBody(event.target.value)} placeholder="粘贴或撰写文案全文…" />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-[11px] text-[var(--muted-2)]" htmlFor="copy-persona">目标人群</label>
          <input id="copy-persona" className="field" value={persona} onChange={(event) => setPersona(event.target.value)} />
        </div>
        <div className="grid gap-1">
          <label className="text-[11px] text-[var(--muted-2)]" htmlFor="copy-pain">核心痛点</label>
          <input id="copy-pain" className="field" value={pain} onChange={(event) => setPain(event.target.value)} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-[11px] text-[var(--muted-2)]" htmlFor="copy-benefit">利益点</label>
          <input id="copy-benefit" className="field" value={benefit} onChange={(event) => setBenefit(event.target.value)} />
        </div>
        <div className="grid gap-1">
          <label className="text-[11px] text-[var(--muted-2)]" htmlFor="copy-cta">CTA 行动指令</label>
          <input id="copy-cta" className="field" value={cta} onChange={(event) => setCta(event.target.value)} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-[11px] text-[var(--muted-2)]" htmlFor="copy-status">状态</label>
          <select id="copy-status" className="field" value={status} onChange={(event) => setStatus(event.target.value as CopyStatus)}>
            {COPY_STATUSES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-end gap-2 pb-0.5">
          <button
            className="btn-primary !min-h-9"
            disabled={aiLoading}
            onClick={() => void handleAiEvaluate()}
            type="button"
            title="评估已填要素是否足够，不够则先询问补充，够则先让 AI 出 6 级计划让你确认再生成"
          >
            🤖 AI 一键生成
          </button>
          {onOpenFormulas && (
            <button className="btn !min-h-9" onClick={onOpenFormulas} type="button">
              去公式库套用
            </button>
          )}
        </div>
      </div>
    </WorkbenchModal>
  );

  // AI 一键生成面板（只渲染一次，复用 setState 闭包）
  function renderAiPanel() {
    const currentInput = { title, product, hookType, formula, persona, pain, benefit, cta, body };
    const evalResult = evaluateCompleteness(currentInput);
    const filledCount = Object.values(currentInput).filter((v) => v && String(v).trim()).length;
    return (
      <section className="mb-3 rounded-[8px] border border-[var(--brand)]/40 bg-[var(--surface)] p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-bold">🤖 AI 一键生成</span>
            <span className="badge badge-green">{filledCount}/9 要素已填</span>
            {aiLoading && <span className="text-[11px] text-[var(--muted-2)]">调用中…</span>}
          </div>
          <button className="btn !min-h-8" onClick={() => setAiStep("off")} type="button" aria-label="关闭 AI 面板">关闭</button>
        </div>

        {aiError && <div className="mb-2 rounded-[5px] border border-[var(--red)]/40 bg-[var(--red-bg)]/40 px-2.5 py-2 text-[12px] text-[var(--red)]">{aiError}</div>}

        {aiStep === "collect" && (
          <div className="space-y-2">
            {evalResult.missing.map((m) => (
              <div key={m.key} className="grid gap-1">
                <label className="text-[10.5px] text-[var(--muted-2)]" htmlFor={`ai-${m.key}`}>
                  {m.label}{m.required ? "（必填）" : "（推荐）"}
                </label>
                <input
                  id={`ai-${m.key}`}
                  className="field !text-[12px]"
                  value={String(currentInput[m.key] ?? "")}
                  placeholder={m.question}
                  onChange={(event) => {
                    const v = event.target.value;
                    if (m.key === "title") setTitle(v);
                    else if (m.key === "formula") setFormula(v);
                    else if (m.key === "pain") setPain(v);
                    else if (m.key === "cta") setCta(v);
                  }}
                />
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <button className="btn-primary !min-h-9" disabled={aiLoading} onClick={() => void handleAiPlan()} type="button">
                {aiLoading ? "调用中…" : "继续生成计划"}
              </button>
              <button className="btn !min-h-9" onClick={() => setAiStep("off")} type="button">稍后再说</button>
            </div>
          </div>
        )}

        {aiStep === "plan" && aiPlan && (
          <div className="space-y-2">
            <div className="text-[12px] text-[var(--muted)]">
              <strong className="text-[var(--text)]">{aiPlan.hookName}</strong>
              {aiPlan.reasoning && <span> · {aiPlan.reasoning}</span>}
            </div>
            {aiPlan.steps.map((step, i) => (
              <details key={step.stage} className="rounded-[5px] border border-[var(--border)] bg-[var(--bg-elevated)]" open={i === 0}>
                <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[12.5px] font-semibold">
                  <span className="badge badge-blue">{i + 1}</span>
                  {step.stage}
                  <span className="text-[11px] font-normal text-[var(--muted-2)]">— {step.angle}</span>
                </summary>
                <div className="grid gap-1 border-t border-[var(--border)] p-2.5">
                  <span className="text-[10.5px] text-[var(--muted-2)]">依据：{step.evidence || "（AI 自由发挥）"}</span>
                  <label className="text-[10.5px] text-[var(--muted-2)]" htmlFor={`plan-angle-${i}`}>策略角度（可改）</label>
                  <textarea
                    id={`plan-angle-${i}`}
                    className="field !min-h-[44px] !text-[12px]"
                    rows={2}
                    value={step.angle}
                    onChange={(event) => updatePlanStep(i, { angle: event.target.value })}
                  />
                </div>
              </details>
            ))}
            <div className="flex gap-2 pt-1">
              <button className="btn-primary !min-h-9" disabled={aiLoading} onClick={() => void handleAiDraft()} type="button">
                {aiLoading ? "生成中…" : "✅ 确认计划 · 生成全文"}
              </button>
              <button className="btn !min-h-9" disabled={aiLoading} onClick={() => void handleAiPlan()} type="button">重新生成计划</button>
              <button className="btn !min-h-9" onClick={() => setAiStep("off")} type="button">取消</button>
            </div>
          </div>
        )}
      </section>
    );
  }
}
