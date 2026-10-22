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
// 麻大师跌出 TOP12 时在榜末追加一行固定展示（真实排名照实显示，中间省略号表示截断）
export function InsightSidePanel({ brandRanking, insights }: InsightSidePanelProps) {
  const ranking = brandRanking?.ranking ?? [];
  const topBrands = ranking.slice(0, 12);
  const ownBrand = ranking.find((b) => b.isOwnBrand);
  const pinOwnBrand = ownBrand && !topBrands.some((b) => b.isOwnBrand);
  const own = insights?.ownBrandActions;

  const renderBrandRow = (b: BrandRankingDataset["ranking"][number]) => (
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
  );

  return (
    <div className="grid gap-4">
      <Card title="品牌 CP 排行">
        <div className="grid gap-2 text-xs">
          {topBrands.map(renderBrandRow)}
          {pinOwnBrand && (
            <div className="text-center leading-4 text-[var(--muted)]" aria-hidden="true">…</div>
          )}
          {pinOwnBrand && renderBrandRow(ownBrand)}
          {!topBrands.length && <div className="text-[var(--muted)]">加载中或数据不可用</div>}
        </div>
      </Card>

      {own && (
        <Card
          title={`${own.brand} 优化行动`}
          action={
            <div className="flex items-center gap-2">
              <StatusTag label={`当前 ${(ownBrand?.avgCP ?? own.currentScore).toFixed(2)}`} tone="green" />
              <StatusTag label={ownBrand ? `第 ${ownBrand.rank}/${ranking.length}` : `第 ${own.currentRank}`} tone="muted" />
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

// 已发布历史周期的行动文本含评分维度代号（CN/CJ/CI/CO），展示层统一换成大白话；
// 新周期由 build-intelligence-dataset.mjs 直接产出大白话，不再命中此表
const PLAIN_ACTION_TEXT: Record<string, string> = {
  "CN 紧迫感 2→4，综合评分 4→4.5，进入 TOP5": "紧迫感从 2 分提到 4 分，综合评分从 4 提到 4.5，进入 TOP5",
  "CJ 差异化 3→4，CI 卖点表达 4→5": "差异化从 3 分提到 4 分，卖点表达从 4 分提到 5 分",
  "视觉完成度 CO 提升 0.5 分": "视觉完成度提升 0.5 分",
  "3/3 主图 CN=2（唯一评分低于 3 的维度）": "3 张主图的紧迫感都只拿到 2 分（唯一低于 3 分的维度）",
};
const plainActionText = (text: string) => PLAIN_ACTION_TEXT[text] ?? text;

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
          <span className="text-[var(--text)]">{plainActionText(action.issue)}</span>
        </div>
        <div>
          <span className="text-[var(--muted)]">动作：</span>
          <span className="text-[var(--text)]">{action.action}</span>
        </div>
        <div>
          <span className="text-[var(--muted)]">预期：</span>
          <span className="text-[var(--green)]">{plainActionText(action.expectedGain)}</span>
        </div>
      </div>
    </div>
  );
}
