export type PlatformBrandIconName =
  | "tmall-cat"
  | "jd-monogram"
  | "douyin-note"
  | "pinduoduo-heart"
  | "vipshop-monogram"
  | "kuaishou-camera"
  | "xiaohongshu-mark"
  | "tiktok-note"
  | "taobao-monogram"
  | "store";

export interface PlatformBrand {
  platform: string;
  brand: string;
  icon: PlatformBrandIconName;
  shortLabel: string;
  tone: string;
}

const PLATFORM_BRANDS: Record<string, Omit<PlatformBrand, "platform">> = {
  天猫: { brand: "tmall", icon: "tmall-cat", shortLabel: "天猫", tone: "#ff0036" },
  京东: { brand: "jd", icon: "jd-monogram", shortLabel: "JD", tone: "#e1251b" },
  抖音: { brand: "douyin", icon: "douyin-note", shortLabel: "抖音", tone: "#161823" },
  拼多多: { brand: "pinduoduo", icon: "pinduoduo-heart", shortLabel: "拼", tone: "#e02e24" },
  唯品: { brand: "vipshop", icon: "vipshop-monogram", shortLabel: "唯", tone: "#f10180" },
  唯品会: { brand: "vipshop", icon: "vipshop-monogram", shortLabel: "唯", tone: "#f10180" },
  快手: { brand: "kuaishou", icon: "kuaishou-camera", shortLabel: "快手", tone: "#ff5000" },
  小红书: { brand: "xiaohongshu", icon: "xiaohongshu-mark", shortLabel: "RED", tone: "#ff2442" },
  TikTok: { brand: "tiktok", icon: "tiktok-note", shortLabel: "TikTok", tone: "#161823" },
  淘宝: { brand: "taobao", icon: "taobao-monogram", shortLabel: "淘", tone: "#ff5000" },
  淘系: { brand: "tmall", icon: "tmall-cat", shortLabel: "天猫", tone: "#ff0036" },
};

export function platformBrand(platform: string): PlatformBrand {
  const normalized = String(platform || "未知渠道").trim() || "未知渠道";
  return {
    platform: normalized,
    ...(PLATFORM_BRANDS[normalized] ?? {
      brand: "generic",
      icon: "store" as const,
      shortLabel: normalized.slice(0, 2),
      tone: "#667085",
    }),
  };
}
