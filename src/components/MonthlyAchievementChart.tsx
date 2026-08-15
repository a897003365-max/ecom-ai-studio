import { Card } from "./Card";
import type { DingTalkMonthlyAchievement } from "../types/integration";

interface MonthlyAchievementChartProps {
  data: DingTalkMonthlyAchievement[];
}

const moneyFormatter = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function amountLabel(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  return `${(value / 10_000).toFixed(value >= 10_000_000 ? 0 : 1)}万`;
}

function exactMoney(value: number) {
  return `¥${moneyFormatter.format(value || 0)}`;
}

function percent(value: number) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function niceMaximum(value: number) {
  if (value <= 0) return 1;
  const exponent = 10 ** Math.floor(Math.log10(value));
  const step = exponent / 2;
  return Math.ceil(value * 1.08 / step) * step;
}

export function MonthlyAchievementChart({ data }: MonthlyAchievementChartProps) {
  const rows = data.slice(-12);
  const width = 900;
  const height = 330;
  const margin = { top: 34, right: 62, bottom: 48, left: 72 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxAmount = niceMaximum(Math.max(...rows.flatMap((item) => [item.netRevenue, item.target]), 1));
  const maxRate = Math.max(1.6, Math.ceil(Math.max(...rows.map((item) => item.completionRate), 0) * 4) / 4);
  const groupWidth = rows.length ? plotWidth / rows.length : plotWidth;
  const barGap = 6;
  const barWidth = Math.min(18, Math.max(9, groupWidth * 0.23));
  const amountY = (value: number) => margin.top + plotHeight - value / maxAmount * plotHeight;
  const rateY = (value: number) => margin.top + plotHeight - Math.min(value, maxRate) / maxRate * plotHeight;
  const x = (index: number) => margin.left + groupWidth * index + groupWidth / 2;
  const rateSegments: string[] = [];
  let currentRateSegment: string[] = [];
  rows.forEach((item, index) => {
    if (item.target > 0) {
      currentRateSegment.push(`${x(index)},${rateY(item.completionRate)}`);
      return;
    }
    if (currentRateSegment.length > 1) rateSegments.push(currentRateSegment.join(" "));
    currentRateSegment = [];
  });
  if (currentRateSegment.length > 1) rateSegments.push(currentRateSegment.join(" "));
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <Card className="h-full min-w-0" title="近12月销售达成">
      <div data-testid="monthly-achievement-chart">
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-[var(--muted)]">
          <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-[var(--blue)]" />净销售额</span>
          <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#78d8f0" }} />销售目标</span>
          <span><i className="mr-1.5 inline-block h-0.5 w-3 align-middle bg-[var(--purple)]" />达成率</span>
          <span className="ml-auto text-[var(--muted-2)]">目标仅显示已配置月份 · 当月按 MTD</span>
        </div>
        <div className="overflow-x-auto pb-1">
          <svg aria-label="近12月净销售额、销售目标与达成率" className="min-w-[760px]" role="img" viewBox={`0 0 ${width} ${height}`}>
            {ticks.map((tick) => {
              const y = margin.top + plotHeight - tick * plotHeight;
              return (
                <g key={tick}>
                  <line stroke="var(--border)" strokeDasharray="4 5" x1={margin.left} x2={width - margin.right} y1={y} y2={y} />
                  <text fill="var(--muted-2)" fontSize="10" textAnchor="end" x={margin.left - 10} y={y + 3}>{amountLabel(maxAmount * tick)}</text>
                  <text fill="var(--muted-2)" fontSize="10" textAnchor="start" x={width - margin.right + 10} y={y + 3}>{percent(maxRate * tick)}</text>
                </g>
              );
            })}

            {rows.map((item, index) => {
              const center = x(index);
              const actualY = amountY(item.netRevenue);
              const targetY = amountY(item.target);
              const actualX = item.target > 0 ? center - barGap / 2 - barWidth : center - barWidth / 2;
              const targetX = center + barGap / 2;
              return (
                <g key={item.month}>
                  <rect fill="var(--blue)" height={margin.top + plotHeight - actualY} rx="2" width={barWidth} x={actualX} y={actualY}>
                    <title>{`${item.month} 净销售额 ${exactMoney(item.netRevenue)}`}</title>
                  </rect>
                  {item.target > 0 && (
                    <rect fill="#78d8f0" height={margin.top + plotHeight - targetY} opacity="0.82" rx="2" stroke="#b7effa" strokeWidth="1" width={barWidth} x={targetX} y={targetY}>
                      <title>{`${item.month} 销售目标 ${exactMoney(item.target)}`}</title>
                    </rect>
                  )}
                  <text fill="var(--muted)" fontSize="10" textAnchor="middle" x={center} y={height - 20}>{item.month.slice(2)}</text>
                </g>
              );
            })}

            {rateSegments.map((points, index) => (
              <polyline key={`rate-line-${index}`} fill="none" points={points} stroke="var(--purple)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
            ))}
            {rows.map((item, index) => item.target > 0 && (
              <g key={`${item.month}-rate`}>
                <circle cx={x(index)} cy={rateY(item.completionRate)} fill="var(--panel-solid)" r="4" stroke="var(--purple)" strokeWidth="2.5">
                  <title>{`${item.month} 达成率 ${percent(item.completionRate)}`}</title>
                </circle>
                <text fill="var(--purple)" fontSize="9" fontWeight="600" textAnchor="middle" x={x(index)} y={Math.max(12, rateY(item.completionRate) - 8)}>{percent(item.completionRate)}</text>
              </g>
            ))}
          </svg>
        </div>
      </div>
    </Card>
  );
}
