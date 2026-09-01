import { useState } from "react";
import { FUNNEL, SHOT_TYPES } from "../../data/copyWorkbench";
import type { FunnelStage, ShotType, StoryboardBoard } from "../../types/copyWorkbench";
import { clsx } from "../../utils/format";

interface StoryboardPanelProps {
  boards: StoryboardBoard[];
  copyTitleOf: (copyId: string | null) => string | undefined;
  onNewEmpty: () => void;
  onUpdateBoard: (id: string, patch: Partial<StoryboardBoard>) => void;
  onRemoveBoard: (id: string) => void;
  onUpdateShot: (boardId: string, index: number, patch: Partial<StoryboardBoard["shots"][number]>) => void;
  onAddShot: (boardId: string) => void;
  onAlignFunnel: (boardId: string) => void;
  onRemoveShot: (boardId: string, index: number) => void;
  onMoveShot: (boardId: string, index: number, direction: -1 | 1) => void;
  openBoardId?: string | null;
  onConsumeOpenBoard?: () => void;
}

export function StoryboardPanel({ boards, copyTitleOf, onNewEmpty, onUpdateBoard, onRemoveBoard, onUpdateShot, onAddShot, onAlignFunnel, onRemoveShot, onMoveShot, openBoardId, onConsumeOpenBoard }: StoryboardPanelProps) {
  const [openId, setOpenId] = useState<string | null>(boards[0]?.id ?? null);

  // 父组件请求"展开指定 board"（如从文案看板跳过来）
  const [lastExtern, setLastExtern] = useState<string | null>(null);
  if (openBoardId && openBoardId !== lastExtern) {
    setLastExtern(openBoardId);
    setOpenId(openBoardId);
    onConsumeOpenBoard?.();
  }

  function toggle(id: string) {
    setOpenId((current) => (current === id ? null : id));
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold">分镜脚本</h3>
          <div className="mt-0.5 text-[11px] text-[var(--muted)]">6 级漏斗结构：开头钩子(2-3s) → 场景/痛点代入 → 老款/竞品背书 → 新品卖点展开 → 活动利益 → 行动指令</div>
        </div>
        <button className="btn-primary" onClick={onNewEmpty} type="button">
          ＋ 新建空白脚本
        </button>
      </div>

      {boards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-10 text-center text-xs text-[var(--muted)]">
          暂无分镜脚本。可在文案卡片上点「分镜」，或新建空白脚本。
        </div>
      ) : (
        <div className="grid gap-3">
          {boards.map((board) => {
            const open = openId === board.id;
            const total = board.shots.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0);
            const linked = copyTitleOf(board.copyId);
            return (
              <section className={clsx("card !p-0 overflow-hidden", open && "border-[var(--border-strong)]")} key={board.id}>
                <div
                  className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 hover:bg-[rgba(166,229,54,0.03)]"
                  onClick={() => toggle(board.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggle(board.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                >
                  <span className={clsx("text-[var(--muted-2)] transition-transform", open && "rotate-90")}>▸</span>
                  <span className="min-w-0 grow">
                    <span className="block truncate text-[14px] font-bold">{board.title}</span>
                    <span className="mt-0.5 block text-[11px] text-[var(--muted-2)]">
                      {board.product} · {board.shots.length} 个镜头{linked ? ` · 关联文案 ${linked}` : ""}
                      {board.sample ? " · 示例" : ""}
                    </span>
                  </span>
                  <span className={clsx("badge", total > 45 ? "badge-amber" : "badge-green")}>总时长 {total}s</span>
                  <button
                    className="btn !min-h-9 !px-2.5 !text-[var(--red)]"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (confirm("删除该分镜脚本？")) onRemoveBoard(board.id);
                    }}
                    type="button"
                    title="删除脚本"
                  >
                    删除
                  </button>
                </div>

                {open && (
                  <div className="border-t border-[var(--border)] px-4 py-3">
                    <div className="grid gap-2">
                      {board.shots.map((shot, index) => (
                        <div className="grid grid-cols-[36px_1fr] gap-2.5 rounded-[5px] border border-[var(--border)] bg-white/[0.02] p-2.5" key={index}>
                          <div
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold tabular-nums"
                            style={{ background: stageColor(shot.stage).bg, color: stageColor(shot.stage).fg }}
                            title={shot.stage}
                          >
                            {index + 1}
                          </div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div className="grid gap-1">
                              <label className="text-[10.5px] text-[var(--muted-2)]">漏斗阶段</label>
                              <select className="field !min-h-9 !text-[12px]" value={shot.stage} onChange={(event) => onUpdateShot(board.id, index, { stage: event.target.value as FunnelStage })}>
                                {FUNNEL.map((stage) => <option key={stage}>{stage}</option>)}
                              </select>
                            </div>
                            <div className="grid gap-1">
                              <label className="text-[10.5px] text-[var(--muted-2)]">景别</label>
                              <select className="field !min-h-9 !text-[12px]" value={shot.shotType} onChange={(event) => onUpdateShot(board.id, index, { shotType: event.target.value as ShotType })}>
                                {SHOT_TYPES.map((type) => <option key={type}>{type}</option>)}
                              </select>
                            </div>
                            <div className="grid gap-1 sm:col-span-2">
                              <label className="text-[10.5px] text-[var(--muted-2)]">画面描述 / 拍摄建议</label>
                              <textarea className="field !min-h-[52px] !max-h-32 !text-[12px]" rows={2} value={shot.visual} onChange={(event) => onUpdateShot(board.id, index, { visual: event.target.value })} />
                            </div>
                            <div className="grid gap-1 sm:col-span-2">
                              <label className="text-[10.5px] text-[var(--muted-2)]">口播台词</label>
                              <textarea className="field !min-h-[52px] !max-h-32 !text-[12px]" rows={2} value={shot.audio} onChange={(event) => onUpdateShot(board.id, index, { audio: event.target.value })} />
                            </div>
                            <div className="grid gap-1">
                              <label className="text-[10.5px] text-[var(--muted-2)]">字幕</label>
                              <input className="field !min-h-9 !text-[12px]" value={shot.subtitle ?? ""} onChange={(event) => onUpdateShot(board.id, index, { subtitle: event.target.value })} />
                            </div>
                            <div className="grid gap-1">
                              <label className="text-[10.5px] text-[var(--muted-2)]">时长（秒）</label>
                              <input className="field !min-h-9 !text-[12px]" type="number" min={1} max={120} value={shot.duration} onChange={(event) => onUpdateShot(board.id, index, { duration: Math.max(0, Math.min(120, Number(event.target.value) || 0)) })} />
                            </div>
                            <div className="flex items-end gap-1.5 sm:col-span-2">
                              <button className="btn !min-h-9 !px-2" disabled={index === 0} onClick={() => onMoveShot(board.id, index, -1)} type="button" title="上移">↑</button>
                              <button className="btn !min-h-9 !px-2" disabled={index === board.shots.length - 1} onClick={() => onMoveShot(board.id, index, 1)} type="button" title="下移">↓</button>
                              <button
                                className="btn !min-h-9 !px-2 !text-[var(--red)]"
                                onClick={() => {
                                  if (confirm(`删除镜头 ${index + 1}？`)) onRemoveShot(board.id, index);
                                }}
                                type="button"
                                title="删除镜头"
                              >
                                删除
                              </button>
                              <span className="grow" />
                              <span className={clsx("text-[11px]", total > 45 ? "text-[var(--orange)]" : "text-[var(--green)]")}>
                                {total > 45 ? "偏长，引流视频建议 15-45s" : "时长合适"}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button className="btn" onClick={() => onAddShot(board.id)} type="button">＋ 添加镜头</button>
                      <button className="btn" onClick={() => onAlignFunnel(board.id)} type="button">按 6 级漏斗补齐</button>
                      <span className="grow" />
                      <div className="flex items-center gap-1.5">
                        <label className="text-[10.5px] text-[var(--muted-2)]">脚本名称</label>
                        <input className="field !min-h-9 w-56 !text-[12px]" value={board.title} onChange={(event) => onUpdateBoard(board.id, { title: event.target.value })} />
                      </div>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 漏斗阶段语义色：开头钩子=品牌绿、痛点=橙、老款=灰、新品=蓝、活动=粉、CTA=紫
function stageColor(stage: FunnelStage): { bg: string; fg: string } {
  if (stage.includes("钩子")) return { bg: "rgba(166,229,54,0.14)", fg: "var(--brand)" };
  if (stage.includes("痛点")) return { bg: "rgba(243,182,63,0.16)", fg: "var(--orange)" };
  if (stage.includes("老款")) return { bg: "rgba(157,179,173,0.18)", fg: "var(--text-2)" };
  if (stage.includes("新品")) return { bg: "rgba(73,191,227,0.18)", fg: "var(--info)" };
  if (stage.includes("活动")) return { bg: "rgba(242,124,156,0.18)", fg: "var(--pink)" };
  if (stage.includes("CTA")) return { bg: "rgba(166,142,232,0.18)", fg: "var(--purple)" };
  return { bg: "rgba(166,229,54,0.14)", fg: "var(--brand)" };
}
