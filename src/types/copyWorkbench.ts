import type { Tone } from "./index";

// ---------- 抖音文案 · 分镜工作台（嵌入自 archive/workbench-snapshots/douyin-copy-workbench.html；2026-08-11 从根目录归档） ----------

export type CopyStatus = "灵感" | "写作中" | "待合规" | "待分镜" | "已发布";

export type HookType =
  | "价格对比锚定"
  | "场景共情代入"
  | "反向挑衅断言"
  | "行业内幕揭露"
  | "稀缺性+损失厌恶"
  | "品牌背书锚定"
  | "悬念好奇心"
  | "视觉冲击颜值"
  | "核心痛点直击"
  | "强势指令";

export type WorkbenchProduct = "豆芽Hit" | "豆7pro" | "黄麻" | "其他";

export type FunnelStage =
  | "开头钩子(2-3s)"
  | "场景/痛点代入"
  | "老款/竞品背书"
  | "新品卖点展开"
  | "活动利益"
  | "行动指令(CTA)";

export type ShotType = "特写" | "近景" | "中景" | "全景" | "空镜/字幕卡";

export interface CopyItem {
  id: string;
  title: string;
  product: WorkbenchProduct;
  hookType: HookType;
  formula?: string;
  persona?: string;
  pain?: string;
  benefit?: string;
  cta?: string;
  body: string;
  status: CopyStatus;
  dueDate?: string;
  sample?: boolean;
  createdAt: string;
}

export interface StoryboardShot {
  stage: FunnelStage;
  visual: string;
  audio: string;
  subtitle?: string;
  duration: number;
  shotType: ShotType;
}

export interface StoryboardBoard {
  id: string;
  copyId: string | null;
  title: string;
  product: WorkbenchProduct;
  createdAt: string;
  sample?: boolean;
  shots: StoryboardShot[];
}

export interface HookFormula {
  code: string;
  name: string;
  desc: string;
  hook: HookType;
  src: string;
}

export interface BannedWord {
  w: string;
  s: string;
}

export interface ComplianceHit {
  w: string;
  s: string;
  n: number;
}

export interface WorkbenchState {
  copies: CopyItem[];
  boards: StoryboardBoard[];
}

export type WorkbenchStatusTone = Record<CopyStatus, Tone>;
