import { Card } from "./Card";
import { PlatformBadge } from "./PlatformBadge";
import type { Platform } from "../types";

export interface ChannelPerformanceItem {
  platform: string;
  gmv: number;
  netRevenue: number;
  refund: number;
  recoveryRate: number;
  feeRate: number;
  refundRate: number;
}

interface ChannelPerformanceChartsProps {
  platforms: ChannelPerformanceItem[];
}

const compactCurrency = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  notation: "compact",
  maximumFractionDigits: 1,
});

function percent(value: number) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function width(value: number, maximum: number) {
  return `${Math.min(100, maximum ? Number(value || 0) / maximum * 100 : 0)}%`;
}

export function ChannelPerformanceCharts({ platforms }: ChannelPerformanceChartsProps) {
  const rows = [...platforms].sort((left, right) => right.gmv - left.gmv);
  const maxAmount = Math.max(...rows.flatMap((item) => [item.gmv, item.netRevenue, item.refund]), 1);
  const maxRateValue = Math.max(...rows.flatMap((item) => [item.recoveryRate, item.feeRate, item.refundRate]), 1);
  const maxRate = Math.max(1, Math.ceil(maxRateValue * 4) / 4);

  return (
    <div className="mb-5 grid min-w-0 gap-4 lg:grid-cols-2" data-testid="channel-performance-charts">
      <Card className="h-full min-w-0" title="渠道规模对比">
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-[var(--muted)]">
          <span><i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-[var(--blue)]" />GMV</span>
          <span><i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-[var(--brand)]" />回款额</span>
          <span><i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-[var(--red)]" />退款金额</span>
        </div>
        <div className="space-y-4">
          {rows.map((item) => (
            <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-3" key={item.platform}>
              <div className="pt-0.5"><PlatformBadge platform={item.platform as Platform} /></div>
              <div className="space-y-1.5">
                {([
                  ["GMV", item.gmv, "var(--blue)"],
                  ["回款", item.netRevenue, "var(--brand)"],
                  ["退款", item.refund, "var(--red)"],
                ] as const).map(([label, value, color]) => (
                  <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_4.25rem] items-center gap-2" key={label} title={`${item.platform} ${label} ${compactCurrency.format(value)}`}>
                    <span className="text-[9.5px] text-[var(--muted-2)]">{label}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
                      <div className="h-full rounded-full" style={{ background: color, width: width(value, maxAmount) }} />
                    </div>
                    <span className="text-right font-mono text-[10px] text-[var(--muted)]">{compactCurrency.format(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="h-full min-w-0" title="渠道效率与风险">
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-[var(--muted)]">
          <span><i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-[var(--brand)]" />回款率</span>
          <span><i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-[var(--orange)]" />费比</span>
          <span><i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-[var(--red)]" />退款率</span>
          <span className="ml-auto font-mono text-[var(--muted-2)]">刻度 0–{percent(maxRate)}</span>
        </div>
        <div className="space-y-4">
          {rows.map((item) => (
            <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-3" key={item.platform}>
              <div className="pt-0.5"><PlatformBadge platform={item.platform as Platform} /></div>
              <div className="space-y-1.5">
                {([
                  ["回款", item.recoveryRate, "var(--brand)"],
                  ["费比", item.feeRate, "var(--orange)"],
                  ["退款", item.refundRate, "var(--red)"],
                ] as const).map(([label, value, color]) => (
                  <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_3.25rem] items-center gap-2" key={label} title={`${item.platform} ${label}率 ${percent(value)}`}>
                    <span className="text-[9.5px] text-[var(--muted-2)]">{label}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
                      <div className="h-full rounded-full" style={{ background: color, width: width(value, maxRate) }} />
                    </div>
                    <span className={`text-right font-mono text-[10px] ${label === "退款" && value >= 0.4 ? "font-bold text-[var(--red)]" : "text-[var(--muted)]"}`}>{percent(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
