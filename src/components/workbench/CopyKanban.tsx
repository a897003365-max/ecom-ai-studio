import { useEffect, useMemo, useState } from "react";
import { COPY_STATUSES, COPY_STATUS_BADGE, todayStr } from "../../data/copyWorkbench";
import type { CopyItem, HookFormula } from "../../types/copyWorkbench";
import { clsx } from "../../utils/format";
import { StatusTag } from "../StatusTag";
import { CopyModal } from "./CopyModal";

interface CopyKanbanProps {
  copies: CopyItem[];
  filter: string;
  onFilter: (status: string) => void;
  onAdd: (input: Partial<CopyItem> & { title: string }) => void;
  onUpdate: (id: string, patch: Partial<CopyItem>) => void;
  onRemove: (id: string) => void;
  onAdvance: (id: string) => void;
  onToBoard: (copyId: string) => void;
  pendingFormula?: HookFormula | null;
  onConsumeFormula?: () => void;
  onOpenFormulas: () => void;
}

export function CopyKanban({ copies, filter, onFilter, onAdd, onUpdate, onRemove, onAdvance, onToBoard, pendingFormula, onConsumeFormula, onOpenFormulas }: CopyKanbanProps) {
  const [modal, setModal] = useState<{ kind: "new" } | { kind: "edit"; copy: CopyItem } | { kind: "preset"; formula: HookFormula } | null>(null);
  const today = todayStr();

  // 公式库「用作新文案」→ 打开带预填的弹窗
  useEffect(() => {
    if (!pendingFormula) return;
    setModal({ kind: "preset", formula: pendingFormula });
    onConsumeFormula?.();
  }, [pendingFormula, onConsumeFormula]);

  const list = useMemo(() => {
    const sorted = copies.slice().sort((a, b) => ((a.dueDate || "9999") < (b.dueDate || "9999") ? -1 : 1));
    return filter === "全部" ? sorted : sorted.filter((copy) => copy.status === filter);
  }, [copies, filter]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold">文案看板</h3>
          <div className="mt-0.5 text-[11px] text-[var(--muted)]">10 字段体系：文案ID / 钩子 / 人群 / 痛点 / 卖点 / CTA · 状态流转：灵感 → 写作中 → 待合规 → 待分镜 → 已发布</div>
        </div>
        <button className="btn-primary" onClick={() => setModal({ kind: "new" })} type="button">
          ＋ 新建文案
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="按状态筛选">
        {["全部", ...COPY_STATUSES].map((status) => {
          const count = status === "全部" ? copies.length : copies.filter((copy) => copy.status === status).length;
          return (
            <button
              aria-pressed={filter === status}
              className={clsx("chip", filter === status && "is-on")}
              key={status}
              onClick={() => onFilter(status)}
              type="button"
            >
              {status}
              <span className="ml-1.5 text-[10.5px] tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-10 text-center text-xs text-[var(--muted)]">
          暂无文案。点击「新建文案」开始，或从「钩子公式库」一键套用公式。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {list.map((copy) => {
            const overdue = Boolean(copy.dueDate && copy.dueDate < today && copy.status !== "已发布");
            const nextIndex = COPY_STATUSES.indexOf(copy.status);
            const next = nextIndex < COPY_STATUSES.length - 1 ? COPY_STATUSES[nextIndex + 1] : null;
            return (
              <article className={clsx("card !p-3.5", overdue && "border-[rgba(255,102,88,0.4)] bg-[rgba(255,102,88,0.05)]")} key={copy.id}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-[10.5px] text-[var(--muted-2)] tabular-nums">{copy.id}</span>
                  <span className="grow" />
                  <StatusTag label={copy.status} tone={COPY_STATUS_BADGE[copy.status]} />
                  {copy.sample && <StatusTag label="示例" tone="muted" />}
                </div>
                <div className="mb-2 text-[13.5px] font-bold leading-snug">{copy.title}</div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <StatusTag label={copy.product} tone="green" />
                  <StatusTag label={copy.hookType} tone="blue" />
                  {copy.formula && <StatusTag label={copy.formula} tone="purple" />}
                </div>
                <div className="mb-2 max-h-[120px] overflow-auto whitespace-pre-wrap break-words rounded-[5px] bg-white/[0.04] px-2.5 py-2 text-xs leading-[1.7] text-[var(--muted)]">
                  {copy.body || "（空文案）"}
                </div>
                {(copy.persona || copy.pain) && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {copy.persona && <StatusTag label={`人群 · ${copy.persona}`} tone="muted" />}
                    {copy.pain && <StatusTag label={`痛点 · ${copy.pain}`} tone="muted" />}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-dashed border-[var(--border)] pt-2">
                  <span className={clsx("text-[11px]", overdue ? "font-bold text-[var(--red)]" : "text-[var(--muted-2)]")}>
                    {copy.dueDate ? (overdue ? `截止 ${copy.dueDate}（逾期）` : `截止 ${copy.dueDate}`) : "未设截止"}
                  </span>
                  <span className="grow" />
                  <button className="btn !min-h-9 !px-2.5" disabled={!next} onClick={() => onAdvance(copy.id)} type="button" title={next ? `推进到「${next}」` : "已是最终状态"}>
                    {next ? `推进 · ${next}` : "已完成"}
                  </button>
                  <button className="btn !min-h-9 !px-2.5" onClick={() => onToBoard(copy.id)} type="button" title="转分镜脚本">
                    分镜
                  </button>
                  <button className="btn !min-h-9 !px-2.5" onClick={() => setModal({ kind: "edit", copy })} type="button" title="编辑">
                    编辑
                  </button>
                  <button
                    className="btn !min-h-9 !px-2.5 !text-[var(--red)]"
                    onClick={() => {
                      if (confirm(`删除该文案？关联分镜脚本会保留但解除关联。`)) onRemove(copy.id);
                    }}
                    type="button"
                    title="删除"
                  >
                    删除
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <CopyModal
        copy={modal?.kind === "edit" ? modal.copy : null}
        open={modal !== null}
        preset={modal?.kind === "preset" ? { hookType: modal.formula.hook, formula: modal.formula.code, title: `${modal.formula.name}·新文案` } : undefined}
        onClose={() => setModal(null)}
        onSave={(input) => {
          if (modal?.kind === "edit") {
            onUpdate(modal.copy.id, input);
          } else {
            onAdd(input);
          }
          setModal(null);
        }}
        onOpenFormulas={onOpenFormulas}
      />
    </div>
  );
}
