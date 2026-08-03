// 渠道质量模块 · 1:1 复刻《2026年5月订单经营最终复盘看板》渠道质量视图
// 结构：渠道毛利率对比条形 + 渠道质量判断 callout + 7.1 渠道销售明细表 + 7.2 床垫类别销售分析表 + 7.3 单品明细分析表(前12)
// 数据：全部来自真实 ProductManagementPages（channelBreakdown / mattressCategoryBreakdown / productNameOverview），
//       这些字段由后端按全局筛选（日期/订单状态/渠道平台/店铺简称）实时计算，前端不再硬编码。
import { Card } from "../Card";
import { TableShell } from "../TableShell";
import { MatrixTable } from "./MatrixTable";
import { judgeChannelQuality } from "./channelQualityJudge";
import type {
  ProductManagementPages,
  ProductChannelBreakdownItem,
  ProductMattressCategoryBreakdownItem,
  ProductNameOverviewItem,
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
  amountShare: number; // 类目销售金额占比 = salesAmount / totalSalesAmount
  grossMargin: number | null;
  profitContribution: number | null; // 毛利销售金额贡献占比 = grossProfit / totalGrossProfit
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
  receivedAmount: number; // 销售额采用"商家实收"口径
  refundRate: number | null;
  avgUnitPrice: number | null;
  amountShare: number; // 产品金额占比 = receivedAmount / totalReceived（即后端 amountShare）
  grossMargin: number | null;
  profitContribution: number | null; // 毛利销售金额贡献占比 = grossProfit / totalGrossProfit
}

function buildProductRows(rows: ProductNameOverviewItem[]): ProductRow[] {
  // 销售额采用"商家实收"，故按 receivedAmount 降序取前 12
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

  // 渠道分组：按商家实收降序，每个渠道含毛利率 + 商家实收两个指标
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
        <div className="cq-callout" data-testid="channel-quality-callout">
          <h3>{callout.title}</h3>
          <p>{callout.text}</p>
        </div>
      </div>

      {/* 7.1 渠道销售明细表 */}
      <Card title="7.1 渠道销售明细表">
        <TableShell minWidth={760} dataUi="cq-channel-table">
          <thead>
            <tr>
              <Th>渠道平台</Th>
              <Th right>销售数量</Th>
              <Th right>商家实收</Th>
              <Th right>毛利率</Th>
              <Th right>占比</Th>
              <Th right>件单价</Th>
            </tr>
          </thead>
          <tbody>
            {channelRows.map((r) => (
              <tr key={r.isTotal ? "__total__" : r.channel} className={r.isTotal ? "cq-total-row" : undefined}>
                <Td>{r.channel}</Td>
                <Td right>{intFmt(r.salesUnits)}</Td>
                <Td right>{intFmt(r.receivedAmount)}</Td>
                <Td right>{pctFmt(r.grossMargin)}</Td>
                <Td right>{pctFmt(r.amountShare)}</Td>
                <Td right>{priceFmt(r.avgUnitPrice)}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
        <p className="cq-note">销售额采用"商家实收"口径；占比为该渠道商家实收占全渠道商家实收比例。</p>
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
