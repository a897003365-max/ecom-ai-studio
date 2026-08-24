// 商品变化指挥中心 · 数值格式化（与设计稿口径一致：金额按「万」展示）
const fmt1 = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("zh-CN");

/** 金额（元）-> ¥X.X万 */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `¥${fmt1.format(value / 10000)}万`;
}

/** 0~1 小数 -> X.X% */
export function percent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

/** 百分点差 -> +X.Xpp / -X.Xpp */
export function pp(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}pp`;
}

/** 整数计数 */
export function count(value: number | null | undefined): string {
  return whole.format(value || 0);
}

/** 天数 */
export function days(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${fmt1.format(value)}天`;
}
