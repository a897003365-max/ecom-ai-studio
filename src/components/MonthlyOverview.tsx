import { CircleGauge, Target } from "lucide-react";
import type { DingTalkMonthlyOverview } from "../types/integration";
import { ChannelRevenueChart } from "./ChannelRevenueChart";

interface MonthlyOverviewProps {
  overview: DingTalkMonthlyOverview;
  selectedChannel: string;
}

const compactMoney = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", notation: "compact", maximumFractionDigits: 1 });

function money(value: number) {
  return compactMoney.format(value || 0);
}

function percent(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(2)}%`;
}

export function MonthlyOverview({ overview, selectedChannel }: MonthlyOverviewProps) {
  const { metrics } = overview;
  return (
    <div className="monthly-overview-grid">
      <div className="monthly-overview-summary">
        <div className="monthly-kicker"><CircleGauge size={14} />{overview.label} · 最新完整口径</div>
        <div className="monthly-revenue-card">
          <div className="text-xs text-[var(--muted)]">月累计回款额（MTD）</div>
          <div className="monthly-revenue-value">{money(metrics.netRevenue)}</div>
          <div className="monthly-revenue-compare">
            <span>去年同期 <b>{money(metrics.priorYearNetRevenue)}</b></span>
            <span className={(metrics.yoy ?? 0) >= 0 ? "text-[var(--red)]" : "text-[var(--green)]"}>同比 {percent(metrics.yoy)}</span>
          </div>
        </div>
        <div className="monthly-mini-grid">
          <div><span>月站内费比</span><b>{percent(metrics.onsiteFeeRate)}</b><small>{money(metrics.onsiteSpend)}</small></div>
          <div><span>月站外费比</span><b>{percent(metrics.offsiteFeeRate)}</b><small>{money(metrics.offsiteSpend)}</small></div>
          <div><span>月总费率</span><b>{percent(metrics.totalFeeRate)}</b><small>站内 + 站外 / 回款</small></div>
          <div><span>月度目标完成率</span><b>{percent(metrics.completionRate)}</b><small>{money(metrics.netRevenue)} / {money(metrics.target)}</small></div>
        </div>
        <div className="monthly-target-progress">
          <div><span><Target size={13} />月度回款目标</span><b>{money(metrics.target)}</b></div>
          <div className="monthly-target-track"><i style={{ width: `${Math.min(100, Math.max(0, metrics.completionRate * 100))}%` }} /></div>
        </div>
      </div>
      <ChannelRevenueChart overview={overview} selectedChannel={selectedChannel} />
    </div>
  );
}
