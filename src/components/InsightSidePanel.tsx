import type { BrandRankingDataset, InsightsDataset } from "../types";
import { Card } from "./Card";
import { StatusTag } from "./StatusTag";
import { RatingBar } from "./RatingBar";
import { clsx } from "../utils/format";

interface InsightSidePanelProps {
  brandRanking: BrandRankingDataset | null;
  insights: InsightsDataset | null;
}

// 右侧常驻栏：品牌 CP 排行 TOP12 + 麻大师 P0/P1 行动清单
export function InsightSidePanel({ brandRanking, insights }: InsightSidePanelProps) {
  const topBrands = brandRanking?.ranking.slice(0, 12) ?? [];
  const own = insights?.ownBrandActions;

  return (
    <div className="grid gap-4">
      <Card title="品牌 CP 排行">
        <div className="grid gap-2 text-xs">
          {topBrands.map((b) => (
            <div
              key={b.brand}
              className={clsx(
                "flex items-center justify-between gap-2 rounded-md px-2 py-1.5",
                b.isOwnBrand && "bg-[var(--green)]/10 border border-[var(--green)]/40",
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-5 font-mono tabular-nums text-[var(--muted)]">{b.rank}</span>
                <span className={clsx("truncate font-semibold", b.isOwnBrand && "text-[var(--green)]")}>
                  {b.brand}
                  {b.isOwnBrand && <span className="ml-1">⭐</span>}
                </span>
                <span className="text-[var(--muted)]">×{b.count}</span>
              </div>
              <RatingBar value={b.avgCP} showLabel size="sm" />
            </div>
          ))}
          {!topBrands.length && <div className="text-[var(--muted)]">加载中或数据不可用</div>}
        </div>
      </Card>

      {own && (
        <Card
          title={`${own.brand} 优化行动`}
          action={
            <div className="flex items-center gap-2">
              <StatusTag label={`当前 ${own.currentScore.toFixed(2)}`} tone="green" />
              <StatusTag label={`第 ${own.currentRank}`} tone="muted" />
            </div>
          }
        >
          <div className="grid gap-3">
            {own.p0.map((a) => (
              <ActionCard key={a.id} action={a} priority="P0" />
            ))}
            {own.p1.map((a) => (
              <ActionCard key={a.id} action={a} priority="P1" />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ActionCard({
  action,
  priority,
}: {
  action: { title: string; issue: string; action: string; expectedGain: string };
  priority: "P0" | "P1";
}) {
  const tone = priority === "P0" ? "red" : "orange";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-bold text-sm">{action.title}</div>
        <StatusTag label={priority} tone={tone} />
      </div>
      <div className="grid gap-1.5 text-xs leading-5 text-[var(--muted)]">
        <div>
          <span className="text-[var(--muted)]">现状：</span>
          <span className="text-[var(--text)]">{action.issue}</span>
        </div>
        <div>
          <span className="text-[var(--muted)]">动作：</span>
          <span className="text-[var(--text)]">{action.action}</span>
        </div>
        <div>
          <span className="text-[var(--muted)]">预期：</span>
          <span className="text-[var(--green)]">{action.expectedGain}</span>
        </div>
      </div>
    </div>
  );
}
