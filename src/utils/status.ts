import type { ProductStatus, TaskStatus, TaskType, Tone } from "../types";

export const toneClassMap: Record<Tone, string> = {
  green: "tag-green",
  blue: "tag-blue",
  orange: "tag-orange",
  red: "tag-red",
  purple: "tag-purple",
  pink: "tag-pink",
  muted: "tag-muted",
};

export const fillClassMap: Record<Tone, string> = {
  green: "fill-green",
  blue: "fill-blue",
  orange: "fill-orange",
  red: "fill-red",
  purple: "fill-purple",
  pink: "fill-purple",
  muted: "fill-blue",
};

export const taskStatusText: Record<TaskStatus, string> = {
  pending: "待开始",
  running: "运行中",
  success: "已完成",
  failed: "失败",
  waiting: "等待中",
  retrying: "重试中",
  cancelled: "已取消",
};

export const productStatusText: Record<ProductStatus, string> = {
  ...taskStatusText,
  review: "待人工确认",
  confirmed: "人工已确认",
};

export const taskTypeText: Record<TaskType, string> = {
  content_generate: "文案生成",
  script_generate: "分镜生成",
  image_process: "图片处理",
  competitor_crawl: "竞品抓取",
  top100_crawl: "TOP100 抓取",
  data_sync: "数据同步",
  quality_check: "任务质检",
  export_package: "导出打包",
};

export const taskStatusTone: Record<TaskStatus, Tone> = {
  pending: "muted",
  running: "blue",
  success: "green",
  failed: "red",
  waiting: "orange",
  retrying: "blue",
  cancelled: "muted",
};

export const productStatusTone: Record<ProductStatus, Tone> = {
  ...taskStatusTone,
  review: "orange",
  confirmed: "green",
};

export function platformClass(platform: string): string {
  if (platform === "天猫") return "bg-[#e2231a]";
  if (platform === "京东") return "bg-[#c40000]";
  if (platform === "抖音") return "bg-[#111111] border border-[#444444]";
  if (platform === "快手") return "bg-[#ff7a00]";
  if (platform === "TikTok") return "bg-[#080808] border border-[#25f4ee]";
  return "bg-[var(--purple)]";
}
