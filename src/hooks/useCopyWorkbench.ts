import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BANNED, COPY_STATUSES, FUNNEL, nextCopyId, seedBoards, seedCopies, todayStr, uid } from "../data/copyWorkbench";
import type {
  ComplianceHit,
  CopyItem,
  CopyStatus,
  FunnelStage,
  ShotType,
  StoryboardBoard,
  StoryboardShot,
  WorkbenchProduct,
  WorkbenchState,
} from "../types/copyWorkbench";

const LS_COPIES = "wb_dywb_copies";
const LS_BOARDS = "wb_dywb_boards";
const LS_VERSION = "wb_dywb_v";
const LS_DEBOUNCE_MS = 400;

// localStorage schema 校验：损坏数据不静默回退，丢弃并打 console.warn
function isCopyItem(value: unknown): value is CopyItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string"
    && typeof v.title === "string"
    && typeof v.body === "string"
    && typeof v.status === "string"
    && typeof v.createdAt === "string";
}

function isBoardItem(value: unknown): value is StoryboardBoard {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string"
    && typeof v.title === "string"
    && Array.isArray(v.shots);
}

function loadState(): WorkbenchState {
  try {
    const copiesRaw = localStorage.getItem(LS_COPIES);
    const boardsRaw = localStorage.getItem(LS_BOARDS);
    if (copiesRaw && boardsRaw) {
      const copies = JSON.parse(copiesRaw) as unknown[];
      const boards = JSON.parse(boardsRaw) as unknown[];
      if (Array.isArray(copies) && copies.every(isCopyItem) && Array.isArray(boards) && boards.every(isBoardItem)) {
        return { copies, boards };
      }
      console.warn("[useCopyWorkbench] localStorage schema 校验失败，丢弃损坏数据");
    }
  } catch {
    // 解析失败时回退到示例数据
  }
  const copies = seedCopies();
  const boards = seedBoards(copies);
  return { copies, boards };
}

export function useCopyWorkbench() {
  const [state, setState] = useState<WorkbenchState>(() => {
    if (localStorage.getItem(LS_VERSION)) {
      return loadState();
    }
    // 首次进入：写入示例数据便于浏览
    const copies = seedCopies();
    const boards = seedBoards(copies);
    return { copies, boards };
  });

  // 防抖写入 localStorage：避免每次 state 变更都同步序列化（避免 keystroke 同步阻塞）
  const writeTimer = useRef<number | null>(null);
  useEffect(() => {
    if (writeTimer.current !== null) {
      window.clearTimeout(writeTimer.current);
    }
    writeTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(LS_COPIES, JSON.stringify(state.copies));
        localStorage.setItem(LS_BOARDS, JSON.stringify(state.boards));
        localStorage.setItem(LS_VERSION, "1");
      } catch {
        // 存储空间不足时静默降级为会话内状态
      }
      writeTimer.current = null;
    }, LS_DEBOUNCE_MS);
    return () => {
      if (writeTimer.current !== null) {
        window.clearTimeout(writeTimer.current);
        writeTimer.current = null;
      }
    };
  }, [state]);

  const copies = state.copies;
  const boards = state.boards;

  // ---------- 文案 CRUD ----------

  const addCopy = useCallback((input: Partial<CopyItem> & { title: string }) => {
    const now = todayStr();
    const item: CopyItem = {
      id: nextCopyId(),
      title: input.title,
      product: input.product ?? "豆芽Hit",
      hookType: input.hookType ?? "场景共情代入",
      formula: input.formula ?? "",
      persona: input.persona ?? "",
      pain: input.pain ?? "",
      benefit: input.benefit ?? "",
      cta: input.cta ?? "",
      body: input.body ?? "",
      status: input.status ?? "灵感",
      dueDate: input.dueDate ?? now,
      sample: false,
      createdAt: now,
    };
    setState((current) => ({ ...current, copies: [item, ...current.copies] }));
    return item;
  }, []);

  const updateCopy = useCallback((id: string, patch: Partial<CopyItem>) => {
    setState((current) => ({
      ...current,
      copies: current.copies.map((copy) => (copy.id === id ? { ...copy, ...patch } : copy)),
    }));
  }, []);

  const removeCopy = useCallback((id: string) => {
    setState((current) => ({
      copies: current.copies.filter((copy) => copy.id !== id),
      boards: current.boards.map((board) => (board.copyId === id ? { ...board, copyId: null } : board)),
    }));
  }, []);

  const advanceCopy = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      copies: current.copies.map((copy) => {
        if (copy.id !== id) return copy;
        const index = COPY_STATUSES.indexOf(copy.status);
        if (index >= COPY_STATUSES.length - 1) return copy;
        return { ...copy, status: COPY_STATUSES[index + 1] as CopyStatus };
      }),
    }));
  }, []);

  const clearSamples = useCallback(() => {
    setState((current) => ({
      copies: current.copies.filter((copy) => !copy.sample),
      boards: current.boards.filter((board) => !board.sample),
    }));
  }, []);

  const clearAll = useCallback(() => {
    setState({ copies: [], boards: [] });
  }, []);

  const replaceAll = useCallback((copies: CopyItem[], boards: StoryboardBoard[]) => {
    setState({ copies, boards });
  }, []);

  // ---------- 分镜 CRUD ----------

  const createBoardFromCopy = useCallback((copyId: string): StoryboardBoard | null => {
    const copy = state.copies.find((item) => item.id === copyId);
    if (!copy) return null;
    // 已存在分镜 → 直接复用（让 UI 跳到分镜脚本页 + 展开）
    const existing = state.boards.find((board) => board.copyId === copyId);
    if (existing) return existing;
    const board: StoryboardBoard = {
      id: uid("SB"),
      copyId: copy.id,
      title: copy.title,
      product: copy.product,
      createdAt: todayStr(),
      sample: false,
      shots: FUNNEL.map((stage) => ({
        stage: stage as FunnelStage,
        visual: "",
        audio: "",
        duration: stage.includes("钩子") ? 3 : 5,
        shotType: "近景" as ShotType,
      })),
    };
    setState((current) => ({
      ...current,
      boards: [board, ...current.boards],
      copies: current.copies.map((item) => (item.id === copyId ? { ...item, status: "待分镜" as CopyStatus } : item)),
    }));
    return board;
  }, [state.copies]);

  const newEmptyBoard = useCallback((): StoryboardBoard => {
    const board: StoryboardBoard = {
      id: uid("SB"),
      copyId: null,
      title: `未命名脚本 ${todayStr()}`,
      product: "豆芽Hit" as WorkbenchProduct,
      createdAt: todayStr(),
      sample: false,
      shots: FUNNEL.map((stage) => ({
        stage: stage as FunnelStage,
        visual: "",
        audio: "",
        duration: 5,
        shotType: "近景" as ShotType,
      })),
    };
    setState((current) => ({ ...current, boards: [board, ...current.boards] }));
    return board;
  }, []);

  const updateBoard = useCallback((id: string, patch: Partial<StoryboardBoard>) => {
    setState((current) => ({
      ...current,
      boards: current.boards.map((board) => (board.id === id ? { ...board, ...patch } : board)),
    }));
  }, []);

  const removeBoard = useCallback((id: string) => {
    setState((current) => ({ ...current, boards: current.boards.filter((board) => board.id !== id) }));
  }, []);

  const updateShot = useCallback((boardId: string, index: number, patch: Partial<StoryboardShot>) => {
    setState((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.id !== boardId) return board;
        const shots = board.shots.map((shot, i) => (i === index ? { ...shot, ...patch } : shot));
        return { ...board, shots };
      }),
    }));
  }, []);

  const addShot = useCallback((boardId: string) => {
    setState((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.id !== boardId) return board;
        const stage = FUNNEL[Math.min(board.shots.length, FUNNEL.length - 1)] as FunnelStage;
        const shot: StoryboardShot = { stage, visual: "", audio: "", duration: 5, shotType: "近景" };
        return { ...board, shots: [...board.shots, shot] };
      }),
    }));
  }, []);

  const alignFunnel = useCallback((boardId: string) => {
    setState((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.id !== boardId) return board;
        const shots = FUNNEL.map((stage, i) => {
          const existing = board.shots[i];
          return existing ? { ...existing, stage: stage as FunnelStage } : { stage: stage as FunnelStage, visual: "", audio: "", duration: 5, shotType: "近景" as ShotType };
        });
        return { ...board, shots };
      }),
    }));
  }, []);

  const removeShot = useCallback((boardId: string, index: number) => {
    setState((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.id !== boardId) return board;
        return { ...board, shots: board.shots.filter((_, i) => i !== index) };
      }),
    }));
  }, []);

  const moveShot = useCallback((boardId: string, index: number, direction: -1 | 1) => {
    setState((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.id !== boardId) return board;
        const target = index + direction;
        if (target < 0 || target >= board.shots.length) return board;
        const shots = board.shots.slice();
        [shots[index], shots[target]] = [shots[target], shots[index]];
        return { ...board, shots };
      }),
    }));
  }, []);

  // ---------- 合规检查 ----------

  const checkCompliance = useCallback((text: string): { hits: ComplianceHit[]; cleaned: string } => {
    const hits: ComplianceHit[] = [];
    for (const banned of BANNED) {
      if (text.includes(banned.w)) {
        const n = text.split(banned.w).length - 1;
        hits.push({ w: banned.w, s: banned.s, n });
      }
    }
    return { hits, cleaned: text };
  }, []);

  const autoFix = useCallback((text: string): string => {
    let output = text;
    for (const banned of BANNED) {
      if (output.includes(banned.w)) {
        output = output.split(banned.w).join(suggestFix(banned.w));
      }
    }
    // 去重连续空格（删除被替换为空的高危词会留下双空格）
    return output.replace(/[ \t]{2,}/g, " ").replace(/^[ \t]+|[ \t]+$/gm, "");
  }, []);

  // ---------- 派生数据 ----------

  const stats = useMemo(() => {
    const byStatus = (status: CopyStatus) => copies.filter((copy) => copy.status === status).length;
    return {
      total: copies.length,
      pendingCompliance: byStatus("待合规"),
      pendingBoard: byStatus("待分镜"),
      published: byStatus("已发布"),
      boards: boards.length,
    };
  }, [copies, boards]);

  const todayItems = useMemo(() => {
    const today = todayStr();
    return copies
      .filter((copy) => copy.status !== "已发布" && copy.dueDate && copy.dueDate <= today)
      .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  }, [copies]);

  return {
    copies,
    boards,
    stats,
    todayItems,
    addCopy,
    updateCopy,
    removeCopy,
    advanceCopy,
    clearSamples,
    clearAll,
    replaceAll,
    createBoardFromCopy,
    newEmptyBoard,
    updateBoard,
    removeBoard,
    updateShot,
    addShot,
    alignFunnel,
    removeShot,
    moveShot,
    checkCompliance,
    autoFix,
  };
}

// 与独立工作台 HTML 保持一致的替换建议
const FIX_MAP: Record<string, string> = {
  "0胶水": "零胶水工艺（有检测报告）",
  零甲醛: "甲醛释放量达国标要求",
  不含甲醛: "甲醛释放量达国标要求",
  护脊: "科学承托",
  舒缓腰背: "睡醒轻松",
  抗菌: "抑菌面料（附检测报告）",
  完美解决: "针对性改善",
  绝对: "",
  最好: "主推",
  第一: "领先",
  "100%": "",
  治疗: "",
  神医: "",
  根治: "",
  清仓搬家: "活动专场",
  最后一天: "活动截止日以页面为准",
  全网最低: "直播间福利价",
};

function suggestFix(word: string): string {
  return FIX_MAP[word] !== undefined ? FIX_MAP[word] : "";
}
