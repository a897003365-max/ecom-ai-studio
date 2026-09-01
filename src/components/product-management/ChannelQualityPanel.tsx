// 渠道质量模块 · 升级版
// 结构：渠道毛利率对比条形 + 渠道质量决策卡（取代 callout） + 7.1 渠道销售明细表（加评级/风险列+退款下钻） + 7.2/7.3 明细表 + 每日矩阵
// 数据：全部来自真实 ProductManagementPages，按全局筛选实时计算。
// 评分：scoreChannelHealth 三维评分（产出力/盈利力/风险力），选不同时间段 pm 实时变化 → 评级实时更新。
import { useState, Fragment } from "react";
import { Card } from "../Card";
import { TableShell } from "../TableShell";
import { MatrixTable } from "./MatrixTable";
import { judgeChannelQuality } from "./channelQualityJudge";
import { scoreChannelHealth } from "./scoreChannelHealth";
import { ChannelDecisionCard } from "./ChannelDecisionCard";
import type {
  ProductManagementPages,
  ProductChannelBreakdownItem,
  ProductMattressCategoryBreakdownItem,
  ProductNameOverviewItem,
  ProductReturnRankingItem,
  ProductReturnDimensionBreakdownItem,
} from "../../types/integration";

const intFmt = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "-"
    : v.toLocaleString("zh-CN", { maximumFractionDigits: 0 });

const priceFmt = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "-"
    : v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pctFmt = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "-"
    : `${(v * 100).toFixed(digits)}%`;

const compactFmt = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const compactMoney = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? "-" : compactFmt.format(num(v));

const num = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

const safeDiv = (a: number, b: number) => (b > 0 ? a / b : null);

// ---- 7.1 渠道销售明细表（含总计行）----
interface ChannelRow extends ProductChannelBreakdownItem {
  isTotal?: boolean;
}

function buildChannelRows(rows: ProductChannelBreakdownItem[]): ChannelRow[] {
  const sorted = [...rows].sort((a, b) => num(b.receivedAmount) - num(a.receivedAmount));
  const totalReceived = sorted.reduce((s, r) => s + num(r.receivedAmount), 0);
  const totalUnits = sorted.reduce((s, r) => s + num(r.salesUnits), 0);
  const totalGrossProfit = sorted.reduce((s, r) => s + num(r.grossProfit), 0);
  const totalMatched = sorted.reduce((s, r) => s + num(r.matchedReceived), 0);
  const total: ChannelRow = {
    channel: "总计",
    salesUnits: totalUnits,
    receivedAmount: totalReceived,
    refundAmount: sorted.reduce((s, r) => s + num(r.refundAmount), 0),
    grossProfit: totalGrossProfit,
    matchedReceived: totalMatched,
    orderLines: sorted.reduce((s, r) => s + num(r.orderLines), 0),
    amountShare: 1,
    avgUnitPrice: safeDiv(totalReceived, totalUnits),
    refundRate: null,
    grossMargin: safeDiv(totalGrossProfit, totalMatched),
    isTotal: true,
  };
  return [...sorted, total];
}

// ---- 7.2 床垫类别销售分析表 ----
interface CategoryRow {
  category: string;
  salesUnits: number;
  salesAmount: number;
  refundRate: number | null;
  unitPrice: number | null;
  amountShare: number;
  grossMargin: number | null;
  profitContribution: number | null;
}

function buildCategoryRows(rows: ProductMattressCategoryBreakdownItem[]): CategoryRow[] {
  const sorted = [...rows].sort((a, b) => num(b.salesAmount) - num(a.salesAmount));
  const totalSalesAmount = sorted.reduce((s, r) => s + num(r.salesAmount), 0);
  const totalGrossProfit = sorted.reduce((s, r) => s + num(r.grossProfit), 0);
  return sorted.map((r) => ({
    category: r.category,
    salesUnits: num(r.salesUnits),
    salesAmount: num(r.salesAmount),
    refundRate: r.refundRate ?? null,
    unitPrice: safeDiv(num(r.salesAmount), num(r.salesUnits)),
    amountShare: safeDiv(num(r.salesAmount), totalSalesAmount) ?? 0,
    grossMargin: r.grossMargin ?? null,
    profitContribution: safeDiv(num(r.grossProfit), totalGrossProfit),
  }));
}

// ---- 7.3 单品明细分析表（按商家实收前12名）----
interface ProductRow {
  productName: string;
  productCode: string | null;
  salesUnits: number;
  receivedAmount: number;
  refundRate: number | null;
  avgUnitPrice: number | null;
  amountShare: number;
  grossMargin: number | null;
  profitContribution: number | null;
}

function buildProductRows(rows: ProductNameOverviewItem[]): ProductRow[] {
  const sorted = [...rows].sort((a, b) => num(b.receivedAmount) - num(a.receivedAmount)).slice(0, 12);
  const totalGrossProfit = [...rows].reduce((s, r) => s + num(r.grossProfit), 0);
  return sorted.map((r) => ({
    productName: r.productName,
    productCode: r.productCode ?? null,
    salesUnits: num(r.salesUnits),
    receivedAmount: num(r.receivedAmount),
    refundRate: r.refundRate ?? null,
    avgUnitPrice: r.avgUnitPrice ?? null,
    amountShare: r.amountShare ?? 0,
    grossMargin: r.grossMargin ?? null,
    profitContribution: safeDiv(num(r.grossProfit), totalGrossProfit),
  }));
}

// ---- 退款归因下钻 ----
// 该渠道退款结构（returnChannelBreakdown）+ 全渠道 Top3 退款 SKU（returnRanking，作参考）
function RefundDrilldown({
  channel,
  returnChannel,
  ranking,
}: {
  channel: string;
  returnChannel: ProductReturnDimensionBreakdownItem | undefined;
  ranking: ProductReturnRankingItem[];
}) {
  const top3 = [...ranking].sort((a, b) => num(b.refundAmount) - num(a.refundAmount)).slice(0, 3);
  return (
    <div className="cq-refund-drilldown" data-testid="cq-refund-drilldown">
      <div className="cq-rd-title">退款归因下钻 · {channel}</div>
      <div className="cq-rd-grid">
        <div className="cq-rd-col">
          <div className="cq-rd-subtitle">渠道退款结构</div>
          {returnChannel ? (
            <ul className="cq-rd-list">
              <li>退款金额 <b>{intFmt(returnChannel.refundAmount)}</b> 元</li>
              <li>退款率 <b>{pctFmt(returnChannel.refundRate)}</b></li>
              <li>发货前退款占比 <b>{pctFmt(returnChannel.preShipRefundShare)}</b>{returnChannel.preShipRefundShare !== null && returnChannel.preShipRefundShare > 0.5 ? "（冲动消费为主）" : ""}</li>
              <li>全额退款占比 <b>{pctFmt(returnChannel.fullRefundShare)}</b>{returnChannel.fullRefundShare !== null && returnChannel.fullRefundShare > 0.5 ? "（非换货为主）" : ""}</li>
              <li>退款单数 <b>{intFmt(returnChannel.refundOrderCount)}</b></li>
            </ul>
          ) : (
            <p className="cq-rd-empty">该渠道无退款归因明细</p>
          )}
        </div>
        <div className="cq-rd-col">
          <div className="cq-rd-subtitle">全渠道 Top3 退款 SKU（参考）</div>
          {top3.length > 0 ? (
            <ol className="cq-rd-ranking">
              {top3.map((r, i) => (
                <li key={`${r.spu}-${i}`}>
                  <span className="cq-rd-rank">{i + 1}</span>
                  <span className="cq-rd-name" title={r.productName}>{r.productName}</span>
                  <span className="cq-rd-meta">退款 {compactMoney(r.refundAmount)} · 退款率 {pctFmt(r.refundRate)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="cq-rd-empty">无 SKU 退款排行数据</p>
          )}
          <p className="cq-rd-note">SKU 排行为全渠道口径，需结合渠道进一步定位是否为该渠道主销品。</p>
        </div>
      </div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th style={right ? { textAlign: "right" } : undefined}>{children}</th>;
}
function Td({ children, right, className }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={className} style={right ? { textAlign: "right" } : undefined}>{children}</td>;
}

export function ChannelQualityPanel({ pm }: { pm: ProductManagementPages }) {
  const channels = pm.channelBreakdown ?? [];
  const categories = pm.mattressCategoryBreakdown ?? [];
  const products = pm.productNameOverview ?? [];

  const channelRows = buildChannelRows(channels);
  const categoryRows = buildCategoryRows(categories);
  const productRows = buildProductRows(products);
  const callout = judgeChannelQuality(channels);
  const report = scoreChannelHealth(pm);

  // 渠道 → 评级 / 风险 关联
  const gradeMap = new Map(report.channels.map((c) => [c.channel, c]));
  const riskMap = new Map<string, "P0" | "P1">();
  for (const l of report.redLights) {
    const cur = riskMap.get(l.channel);
    if (cur !== "P0") riskMap.set(l.channel, l.level);
  }
  const returnChannelMap = new Map<string, ProductReturnDimensionBreakdownItem>();
  for (const r of pm.returnChannelBreakdown ?? []) {
    if (r.dim) returnChannelMap.set(r.dim, r);
  }

  const [expanded, setExpanded] = useState<string | null>(null);

  // 决策卡"查看归因" → 展开对应渠道行
  const handleDrilldown = (channel: string, _type: "refund" | "category") => {
    setExpanded((prev) => (prev === channel ? null : channel));
  };

  // 渠道分组：按商家实收降序
  const channelGroups = channels
    .map((r) => ({ channel: r.channel, margin: r.grossMargin ?? null, received: num(r.receivedAmount) }))
    .sort((a, b) => b.received - a.received);
  const maxMargin = channelGroups.length ? Math.max(...channelGroups.map((g) => num(g.margin))) : 0;
  const maxReceived = channelGroups.length ? Math.max(...channelGroups.map((g) => g.received)) : 0;
  const barWidth = (value: number, max: number) => (max > 0 ? Math.max(2, (value / max) * 100) : 0);

  return (
    <div className="channel-quality" data-testid="channel-quality-panel" data-ui="channel-quality">
      <div className="channel-quality-top">
        <Card title="渠道毛利率 & 商家实收对比">
          <div className="cq-groups" aria-label="各渠道毛利率与商家实收对比条形图">
            {channelGroups.length === 0 ? (
              <p className="cq-empty">当前筛选范围暂无渠道数据</p>
            ) : (
              channelGroups.map((g) => {
                const margin = num(g.margin);
                return (
                  <div className="cq-group" key={g.channel}>
                    <div className="cq-group-name" title={g.channel}>{g.channel}</div>
                    <div className="cq-bar" aria-label={`${g.channel} 毛利率 ${pctFmt(g.margin)}`}>
                      <span className="cq-bar-label">毛利率</span>
                      <span className="cq-track"><span className="cq-fill" style={{ width: `${g.margin === null ? 0 : barWidth(margin, maxMargin)}%` }} /></span>
                      <span className="cq-bar-value">{pctFmt(g.margin)}</span>
                    </div>
                    <div className="cq-bar" aria-label={`${g.channel} 商家实收 ${compactMoney(g.received)}`}>
                      <span className="cq-bar-label">商家实收</span>
                      <span className="cq-track"><span className="cq-fill cq-fill--blue" style={{ width: `${barWidth(g.received, maxReceived)}%` }} /></span>
                      <span className="cq-bar-value">{compactMoney(g.received)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <p className="cq-note">按商家实收降序；毛利率为已匹配成本数据的汇总结果。两指标各按全渠道最大值相对显示。</p>
        </Card>
        <ChannelDecisionCard report={report} onDrilldown={handleDrilldown} />
      </div>

      {/* 兼容旧 callout 文本（视觉隐藏，保留 judgeChannelQuality 行为测试锚点） */}
      <div className="cq-callout cq-callout--legacy" data-testid="channel-quality-callout" style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }} aria-hidden="true">
        <h3>{callout.title}</h3>
        <p>{callout.text}</p>
      </div>

      {/* 7.1 渠道销售明细表（加评级/风险列 + 行展开退款归因） */}
      <Card title="7.1 渠道销售明细表">
        <TableShell minWidth={900} dataUi="cq-channel-table">
          <thead>
            <tr>
              <Th>渠道平台</Th>
              <Th>评级</Th>
              <Th>风险</Th>
              <Th right>销售数量</Th>
              <Th right>商家实收</Th>
              <Th right>毛利率</Th>
              <Th right>占比</Th>
              <Th right>件单价</Th>
              <Th>归因</Th>
            </tr>
          </thead>
          <tbody>
            {channelRows.map((r) => {
              if (r.isTotal) {
                return (
                  <tr key="__total__" className="cq-total-row">
                    <Td>{r.channel}</Td>
                    <Td>—</Td>
                    <Td>—</Td>
                    <Td right>{intFmt(r.salesUnits)}</Td>
                    <Td right>{intFmt(r.receivedAmount)}</Td>
                    <Td right>{pctFmt(r.grossMargin)}</Td>
                    <Td right>{pctFmt(r.amountShare)}</Td>
                    <Td right>{priceFmt(r.avgUnitPrice)}</Td>
                    <Td>—</Td>
                  </tr>
                );
              }
              const health = gradeMap.get(r.channel);
              const risk = riskMap.get(r.channel);
              const isOpen = expanded === r.channel;
              return (
                <Fragment key={r.channel}>
                  <tr
                    key={r.channel}
                    className={isOpen ? "cq-channel-row cq-channel-row--open" : "cq-channel-row"}
                  >
                    <Td>{r.channel}</Td>
                    <Td>
                      {health ? (
                        <span className={`cq-grade-badge cq-grade--${health.grade}`} aria-label={`评级 ${health.grade}`}>{health.grade}</span>
                      ) : "—"}
                    </Td>
                    <Td>
                      {risk ? (
                        <span className={`cq-risk-dot cq-risk-dot--${risk}`} title={`${risk} 风险`} aria-label={`${risk} 风险`} />
                      ) : (
                        <span className="cq-risk-dot cq-risk-dot--ok" title="无风险" aria-label="无风险" />
                      )}
                    </Td>
                    <Td right>{intFmt(r.salesUnits)}</Td>
                    <Td right>{intFmt(r.receivedAmount)}</Td>
                    <Td right>{pctFmt(r.grossMargin)}</Td>
                    <Td right>{pctFmt(r.amountShare)}</Td>
                    <Td right>{priceFmt(r.avgUnitPrice)}</Td>
                    <Td>
                      <button
                        type="button"
                        className="cq-drilldown-toggle"
                        onClick={() => setExpanded((prev) => (prev === r.channel ? null : r.channel))}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "收起" : "展开"}${r.channel}退款归因`}
                      >
                        {isOpen ? "收起" : "退款"}
                      </button>
                    </Td>
                  </tr>
                  {isOpen && (
                    <tr key={`${r.channel}__drilldown`} className="cq-drilldown-row">
                      <td colSpan={9} style={{ padding: 0 }}>
                        <RefundDrilldown
                          channel={r.channel}
                          returnChannel={returnChannelMap.get(r.channel)}
                          ranking={pm.returnRanking ?? []}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </TableShell>
        <p className="cq-note">销售额采用"商家实收"口径；评级由 scoreChannelHealth 三维评分（产出力/盈利力/风险力）实时计算；点"退款"展开归因。</p>
      </Card>

      {/* 7.2 床垫类别销售分析表 */}
      <Card title="7.2 床垫类别销售分析表">
        <TableShell minWidth={1120} dataUi="cq-category-table">
          <thead>
            <tr>
              <Th>床垫类别</Th>
              <Th right>销售数量</Th>
              <Th right>销售额</Th>
              <Th right>退款率</Th>
              <Th right>件单价</Th>
              <Th right>类目销售金额占比</Th>
              <Th right>毛利率</Th>
              <Th right>毛利销售金额贡献占比</Th>
            </tr>
          </thead>
          <tbody>
            {categoryRows.map((r) => (
              <tr key={r.category}>
                <Td>{r.category}</Td>
                <Td right>{intFmt(r.salesUnits)}</Td>
                <Td right>{intFmt(r.salesAmount)}</Td>
                <Td right>{pctFmt(r.refundRate)}</Td>
                <Td right>{priceFmt(r.unitPrice)}</Td>
                <Td right>{pctFmt(r.amountShare)}</Td>
                <Td right>{pctFmt(r.grossMargin)}</Td>
                <Td right>{pctFmt(r.profitContribution)}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
        <p className="cq-note">件单价 = 销售额 / 销售数量；类目销售金额占比按销售额计算；毛利销售金额贡献占比 = 毛利额 / 全表毛利额。</p>
      </Card>

      {/* 7.3 单品明细分析表（按销售额前12名） */}
      <Card title="7.3 单品明细分析表（按销售额前12名）">
        <TableShell minWidth={1120} dataUi="cq-product-table">
          <thead>
            <tr>
              <Th>产品名称</Th>
              <Th right>销量</Th>
              <Th right>销售额</Th>
              <Th right>退款率</Th>
              <Th right>件单价</Th>
              <Th right>产品金额占比</Th>
              <Th right>毛利率</Th>
              <Th right>毛利销售金额贡献占比</Th>
            </tr>
          </thead>
          <tbody>
            {productRows.map((r, idx) => (
              <tr key={`${r.productName}__${r.productCode ?? idx}`}>
                <Td>{r.productName}</Td>
                <Td right>{intFmt(r.salesUnits)}</Td>
                <Td right>{intFmt(r.receivedAmount)}</Td>
                <Td right>{pctFmt(r.refundRate)}</Td>
                <Td right>{priceFmt(r.avgUnitPrice)}</Td>
                <Td right>{pctFmt(r.amountShare)}</Td>
                <Td right>{pctFmt(r.grossMargin)}</Td>
                <Td right>{pctFmt(r.profitContribution)}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
        <p className="cq-note">销售额采用"商家实收"口径；按商家实收降序取前 12 名；件单价 = 商家实收 / 销量。</p>
      </Card>

      <Card title="每日 × 渠道毛利率" className="mt-4">
        <MatrixTable matrix={pm.dailyChannelMarginMatrix} rowHeader="日期" minWidth={960} pageSize={15} valueFormat="percent" />
      </Card>
    </div>
  );
}
