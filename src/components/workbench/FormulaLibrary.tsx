import { FORMULAS_F, FORMULAS_H, HOOK_TYPES } from "../../data/copyWorkbench";
import type { HookFormula } from "../../types/copyWorkbench";
import { StatusTag } from "../StatusTag";

interface FormulaLibraryProps {
  onUseFormula: (formula: HookFormula) => void;
}

export function FormulaLibrary({ onUseFormula }: FormulaLibraryProps) {
  const renderCard = (formula: HookFormula) => (
    <article className="card !p-3.5" key={formula.code}>
      <div className="mb-1 text-[11px] font-bold tracking-[0.08em] text-[var(--brand)] tabular-nums">{formula.code}</div>
      <h4 className="mb-1 text-[14px] font-bold">{formula.name}</h4>
      <p className="mb-2.5 flex-1 text-xs leading-[1.6] text-[var(--muted)]">{formula.desc}</p>
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <StatusTag label={formula.hook} tone="blue" />
        <span className="text-[10.5px] text-[var(--muted-2)]">来源 {formula.src}</span>
      </div>
      <div className="flex justify-end">
        <button className="btn !min-h-9" onClick={() => onUseFormula(formula)} type="button">
          用作新文案
        </button>
      </div>
    </article>
  );

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-[15px] font-bold">钩子公式库</h3>
        <div className="mt-0.5 text-[11px] text-[var(--muted)]">来自竞品拆解批次 2026-07-20 / 2026-07-20-2，点击「用作新文案」直接套用</div>
      </div>

      <div className="mb-2 text-[13px] font-bold text-[var(--muted)]">10 种钩子类型</div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {HOOK_TYPES.map((hook, index) => (
          <StatusTag key={hook} label={`${String(index + 1).padStart(2, "0")} · ${hook}`} tone="blue" />
        ))}
      </div>

      <div className="mb-2 text-[13px] font-bold text-[var(--muted)]">床垫类公式（F 系列）</div>
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{FORMULAS_F.map(renderCard)}</div>

      <div className="mb-2 text-[13px] font-bold text-[var(--muted)]">床类迁移公式（H 系列 · 豆芽Hit 重点可迁移）</div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{FORMULAS_H.map(renderCard)}</div>
    </div>
  );
}
