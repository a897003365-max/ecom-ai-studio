import { useCallback, useState } from "react";
import { useCopyWorkbench } from "../../hooks/useCopyWorkbench";
import type { CopyItem, HookFormula } from "../../types/copyWorkbench";
import { COPY_STATUSES, COPY_STATUS_BADGE, todayStr } from "../../data/copyWorkbench";
import { clsx } from "../../utils/format";
import { StatusTag } from "../StatusTag";
import { CopyKanban } from "./CopyKanban";
import { FormulaLibrary } from "./FormulaLibrary";
import { ComplianceChecker } from "./ComplianceChecker";
import { StoryboardPanel } from "./StoryboardPanel";

export type WorkbenchTab = "kanban" | "boards" | "formulas" | "compliance";

export type WorkbenchTaskType = "content_generate" | "script_generate" | "quality_check" | "export_package";

interface CopyWorkbenchProps {
  onAction: (title: string, detail?: string) => void;
  onCreateTask: (task: {
    name: string;
    type: WorkbenchTaskType;
    module: string;
    batch: string;
    inputFiles?: string[];
    timeline?: string[];
  }) => void;
  initialTab?: WorkbenchTab;
}

const WORKBENCH_TABS: Array<{ id: WorkbenchTab; label: string }> = [
  { id: "kanban", label: "文案看板" },
  { id: "boards", label: "分镜脚本" },
  { id: "formulas", label: "钩子公式库" },
  { id: "compliance", label: "合规检查" },
];

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

export function CopyWorkbench({ onAction, onCreateTask, initialTab = "kanban" }: CopyWorkbenchProps) {
  const [tab, setTab] = useState<WorkbenchTab>(initialTab);
  const [filter, setFilter] = useState("全部");
  const [pendingFormula, setPendingFormula] = useState<HookFormula | null>(null);
  const [openBoardId, setOpenBoardId] = useState<string | null>(null);
  const workbench = useCopyWorkbench();
  const { copies, boards, stats, todayItems } = workbench;

  function createTask(type: WorkbenchTaskType, name: string, batch: string) {
    const now = new Date().toTimeString().slice(0, 5);
    onCreateTask({
      name,
      type,
      module: "内容生产",
      batch,
      inputFiles: ["商品卖点表.xlsx", "合规替代表.xlsx"],
      timeline: [`${now} 从文案分镜工作台创建任务`, `${now} 等待 Agent 执行`],
    });
  }

  function handleExport() {
    try {
      const payload = { app: "douyin-copy-workbench", version: 1, exportedAt: new Date().toISOString(), copies, boards };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `抖音文案分镜工作台-备份-${todayStamp()}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        anchor.remove();
      }, 500);
      onAction("备份文件已导出", "包含全部文案与分镜脚本");
    } catch (error: unknown) {
      onAction("导出失败", error instanceof Error ? error.message : "浏览器不支持文件下载");
    }
  }

  function handleImport(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const importedCopies = Array.isArray(data.copies) ? data.copies : Array.isArray(data) ? data : null;
        const importedBoards = Array.isArray(data.boards) ? data.boards : [];
        if (!importedCopies) throw new Error("bad format");
        if (!confirm(`导入将覆盖当前全部数据（共 ${importedCopies.length} 条文案、${importedBoards.length} 个脚本），确认继续？`)) return;
        // 不可变：返回新对象而非 mutate
        const sanitizedCopies = importedCopies.map((copy: CopyItem) => ({ ...copy, sample: false }));
        workbench.replaceAll(sanitizedCopies, importedBoards);
        onAction("导入成功", `${importedCopies.length} 条文案、${importedBoards.length} 个脚本`);
      } catch {
        alert("导入失败：文件格式不正确，请选择本工作台导出的 JSON 备份文件。");
      }
    };
    reader.readAsText(file);
  }

  function useFormula(formula: HookFormula) {
    setPendingFormula(formula);
    setTab("kanban");
    setFilter("全部");
  }

  const consumeFormula = useCallback(() => setPendingFormula(null), []);
  const consumeOpenBoard = useCallback(() => setOpenBoardId(null), []);

  return (
    <div>
      {/* 工作台统计条 */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="文案总数" value={stats.total} tone="default" />
        <StatTile label="待合规" value={stats.pendingCompliance} tone="orange" />
        <StatTile label="待分镜" value={stats.pendingBoard} tone="purple" />
        <StatTile label="已发布" value={stats.published} tone="green" />
        <StatTile label="分镜脚本" value={stats.boards} tone="blue" />
        <StatTile label="今日到期" value={todayItems.length} tone="red" />
      </div>

      {/* 今天要处理（原 workbench HTML 核心一节） */}
      <TodayStrip
        items={todayItems}
        onJumpToKanban={() => { setTab("kanban"); setFilter("全部"); }}
        onGotoCopy={(id) => { setTab("kanban"); setFilter("全部"); onAction("已定位到该文案", id); }}
        onAdvance={(id) => { workbench.advanceCopy(id); onAction("已推进到下一状态", id); }}
      />

      {/* 工具条：备份 + 任务入口（合并为一行） */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
        <span className="mr-1 text-[10.5px] font-semibold tracking-wide text-[var(--muted-2)]">数据</span>
        <button className="btn !min-h-8" onClick={handleExport} type="button">导出 JSON</button>
        <button className="btn !min-h-8" onClick={() => document.getElementById("workbench-import")?.click()} type="button">导入</button>
        <button className="btn !min-h-8" onClick={() => { if (confirm("将删除全部示例文案与示例脚本（你自己创建的数据不受影响），确认？")) workbench.clearSamples(); }} type="button">清空示例</button>
        <button className="btn !min-h-8 !text-[var(--red)]" onClick={() => { if (confirm("确认清空全部文案与分镜脚本？此操作不可恢复！")) workbench.clearAll(); }} type="button">清空全部</button>
        <input id="workbench-import" className="hidden" type="file" accept=".json,application/json" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleImport(file);
          event.target.value = ""; // 允许重复选同一文件
        }} />
        <span className="mx-1 h-4 w-px bg-[var(--border)]" />
        <span className="mr-1 text-[10.5px] font-semibold tracking-wide text-[var(--muted-2)]">任务入队</span>
        <button className="btn !min-h-8" onClick={() => createTask("content_generate", "批量生成文案：COPY-WEB", `COPY-WEB-${todayStamp()}`)} type="button">批量文案</button>
        <button className="btn !min-h-8" onClick={() => createTask("script_generate", "生成分镜脚本：SCRIPT-WEB", `SCRIPT-WEB-${todayStamp()}`)} type="button">生成分镜</button>
        <button className="btn !min-h-8" onClick={() => createTask("quality_check", "批量质检：QC-WEB", `QC-WEB-${todayStamp()}`)} type="button">批量质检</button>
        <button className="btn !min-h-8" onClick={() => createTask("export_package", "导出内容生产结果包", `EXPORT-CONTENT-${todayStamp()}`)} type="button">导出结果</button>
      </div>

      {/* Tab 切换 */}
      <div className="mb-4 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-[var(--border)]" role="tablist">
        {WORKBENCH_TABS.map((item) => (
          <button
            className={tab === item.id ? "tab-trigger is-active shrink-0" : "tab-trigger shrink-0"}
            key={item.id}
            onClick={() => setTab(item.id)}
            role="tab"
            aria-selected={tab === item.id}
            type="button"
          >
            {item.label}
            {item.id === "kanban" && <span className="ml-1.5 text-[10px] tabular-nums text-[var(--muted-2)]">{copies.length}</span>}
            {item.id === "boards" && <span className="ml-1.5 text-[10px] tabular-nums text-[var(--muted-2)]">{boards.length}</span>}
          </button>
        ))}
      </div>

      {tab === "kanban" && (
        <CopyKanban
          copies={copies}
          filter={filter}
          onFilter={setFilter}
          onAdd={workbench.addCopy}
          onUpdate={workbench.updateCopy}
          onRemove={workbench.removeCopy}
          onAdvance={workbench.advanceCopy}
          pendingFormula={pendingFormula}
          onConsumeFormula={consumeFormula}
          onToBoard={(copyId) => {
            const board = workbench.createBoardFromCopy(copyId);
            if (board) {
              const isNew = !boards.some((b) => b.copyId === copyId);
              onAction(isNew ? "已按 6 级漏斗生成脚本骨架" : "已跳到该文案的分镜脚本", board.id);
              setOpenBoardId(board.id);
              setTab("boards");
            } else {
              onAction("该文案不存在", "请刷新或重新创建");
            }
          }}
          onOpenFormulas={() => setTab("formulas")}
        />
      )}
      {tab === "boards" && (
        <StoryboardPanel
          boards={boards}
          copyTitleOf={(copyId) => (copyId ? copies.find((copy) => copy.id === copyId)?.title : undefined)}
          onNewEmpty={workbench.newEmptyBoard}
          onUpdateBoard={workbench.updateBoard}
          onRemoveBoard={workbench.removeBoard}
          onUpdateShot={workbench.updateShot}
          onAddShot={workbench.addShot}
          onAlignFunnel={workbench.alignFunnel}
          onRemoveShot={workbench.removeShot}
          onMoveShot={workbench.moveShot}
          openBoardId={openBoardId}
          onConsumeOpenBoard={consumeOpenBoard}
        />
      )}
      {tab === "formulas" && <FormulaLibrary onUseFormula={useFormula} />}
      {tab === "compliance" && <ComplianceChecker onCheck={workbench.checkCompliance} onAutoFix={workbench.autoFix} onAction={onAction} />}
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone: "default" | "orange" | "purple" | "green" | "blue" | "red" }) {
  const color =
    tone === "orange" ? "text-[var(--orange)]"
    : tone === "purple" ? "text-[var(--purple)]"
    : tone === "red" ? "text-[var(--red)]"
    : tone === "green" ? "text-[var(--green)]"
    : tone === "blue" ? "text-[var(--blue)]"
    : "text-[var(--brand)]";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <div className="text-[10.5px] text-[var(--muted-2)]">{label}</div>
      <div className={`mt-0.5 text-[22px] font-bold tabular-nums leading-none ${color}`}>{value}</div>
    </div>
  );
}

// 今天要处理：列出今天到期的文案（未发布），支持一键推进/跳转
function TodayStrip({ items, onGotoCopy, onAdvance }: { items: CopyItem[]; onJumpToKanban: () => void; onGotoCopy: (id: string) => void; onAdvance: (id: string) => void }) {
  const today = todayStr();
  return (
    <section className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 shadow-[var(--shadow-card)]">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[13.5px] font-bold">
          <span className="inline-block h-2 w-2 rounded-[2px] bg-[var(--brand)]" />
          今天要处理 · {today}
        </h2>
        <span className="text-[11px] text-[var(--muted-2)]">未完成且截止 ≤ 今天 · 按截止日升序</span>
      </div>
      {items.length === 0 ? (
        <div className="px-1 py-2 text-[12px] text-[var(--muted-2)]">今天没有到期任务。点击右上「＋ 新建文案」或「钩子公式库」套用公式开始。</div>
      ) : (
        <div className="grid gap-1.5">
          {items.map((copy) => {
            const overdue = copy.dueDate! < today;
            const nextIndex = COPY_STATUSES.indexOf(copy.status);
            const next = nextIndex < COPY_STATUSES.length - 1 ? COPY_STATUSES[nextIndex + 1] : null;
            return (
              <div
                className={clsx("flex flex-wrap items-center gap-2 rounded-[5px] px-2.5 py-1.5", overdue ? "bg-[rgba(255,102,88,0.08)] ring-1 ring-[rgba(255,102,88,0.3)]" : "bg-white/[0.04] ring-1 ring-[var(--border)]")}
                key={copy.id}
              >
                <span className={clsx("badge", overdue ? "badge-red" : "badge-green")}>{overdue ? "已逾期" : "今日到期"}</span>
                <div className="min-w-[160px] grow">
                  <div className="text-[12.5px] font-semibold">{copy.title}</div>
                  <div className="text-[11px] text-[var(--muted-2)]">{copy.id} · {copy.product} · 当前：{copy.status}</div>
                </div>
                <StatusTag label={copy.status} tone={COPY_STATUS_BADGE[copy.status]} />
                {next && (
                  <button className="btn !min-h-8 !px-2.5" onClick={() => onAdvance(copy.id)} type="button">
                    推进到「{next}」
                  </button>
                )}
                <button className="btn !min-h-8 !px-2.5" onClick={() => onGotoCopy(copy.id)} type="button">
                  在看板打开
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
