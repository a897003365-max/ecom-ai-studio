import { useEffect, useMemo, useState } from "react";
import { AnalysisProgress, useAnalyzeStatus } from "../components/AnalysisProgress";
import { Card } from "../components/Card";
import { DetailDrawer } from "../components/DetailDrawer";
import { InsightSidePanel } from "../components/InsightSidePanel";
import { MetricCard } from "../components/MetricCard";
import { PageHeader } from "../components/PageHeader";
import { PlatformBadge } from "../components/PlatformBadge";
import { RatingBar } from "../components/RatingBar";
import { StatusTag } from "../components/StatusTag";
import { TableShell } from "../components/TableShell";
import { Tabs } from "../components/Tabs";
import { Thumbnail } from "../components/Thumbnail";
import { competitorStores } from "../data/mock";
import { competitorImageUrl, getBrandRanking, getInsights, getTop100Dataset } from "../services/intelligenceApi";
import { getCompetitorPrices } from "../services/localApi";
import type { BrandRankingDataset, CompetitorPriceItem, InsightsDataset, TaskCreateInput, Top100Dataset, Top100ItemV2 } from "../types";
import { clsx } from "../utils/format";

type IntelligenceTab = "top100" | "price";

interface IntelligencePageProps {
  onAction: (title: string, detail?: string) => void;
  onCreateTask: (task: TaskCreateInput) => void;
  canManage: boolean;
}

export function IntelligencePage({ onAction, onCreateTask, canManage }: IntelligencePageProps) {
  const [tab, setTab] = useState<IntelligenceTab>("top100");
  const [top100, setTop100] = useState<Top100Dataset | null>(null);
  const [brandRanking, setBrandRanking] = useState<BrandRankingDataset | null>(null);
  const [insights, setInsights] = useState<InsightsDataset | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [drawerItem, setDrawerItem] = useState<Top100ItemV2 | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [prevPhase, setPrevPhase] = useState<string>("idle");
  const analyzeStatus = useAnalyzeStatus(1500);
  const [priceItems, setPriceItems] = useState<CompetitorPriceItem[] | null>(null);
  const [priceDegraded, setPriceDegraded] = useState<string | null>(null);

  useEffect(() => {
    getCompetitorPrices()
      .then((payload) => {
        setPriceItems(payload.items);
        setPriceDegraded(payload.degraded ? payload.reason || "业务管理后台不可用" : null);
      })
      .catch((error: unknown) => {
        setPriceItems([]);
        setPriceDegraded(error instanceof Error ? error.message : String(error));
      });
  }, []);

  async function loadAll() {
    setRefreshing(true);
    setDataError(null);
    try {
      const [t, b, i] = await Promise.all([getTop100Dataset(), getBrandRanking(), getInsights()]);
      setTop100(t);
      setBrandRanking(b);
      setInsights(i);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  // 派生指标
  const metrics = useMemo(() => {
    if (!top100) return null;
    const shops = new Set(top100.items.map((i) => i.shop).filter(Boolean));
    const ownRank = top100.items.find((i) => i.isOwnBrand)?.cpRank ?? "-";
    return {
      analyzed: top100.items.length,
      total: top100.sourceCount ?? top100.items.length,
      fieldCount: top100.fieldCount ?? 85,
      shops: shops.size,
      ownRank,
      samplePeriod: top100.samplePeriod,
    };
  }, [top100]);

  function refreshAnalysis() {
    loadAll().then(() => {
      const label = metrics
        ? `已刷新 ${metrics.total} 款竞品分析结果`
        : `重新读取本地离线分析`;
      onAction("已刷新分析", label);
    });
  }

  async function startAnalyzeAndRefresh() {
    if (!canManage) {
      onAction("当前账号无分析权限", "请联系管理员开通“执行竞品分析”权限");
      return;
    }
    if (!analyzeStatus?.hasSourceXlsx) {
      onAction(
        "未检测到原始表",
        "请先完成竞品原始数据导入后再启动分析"
      );
      return;
    }
    setAnalyzing(true);
    try {
      const useMock = !analyzeStatus.hasVisionKey;
      const res = await fetch("/api/intelligence/analyze-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mock: useMock }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onAction(
        useMock ? "示例分析已启动" : "分析已启动",
        useMock ? "视觉分析服务尚未配置，本次使用内置示例数据" : "正在分析竞品图片，请稍候"
      );
    } catch (error) {
      onAction("分析启动失败", error instanceof Error ? error.message : String(error));
    } finally {
      setAnalyzing(false);
    }
  }

  // pipeline 完成后自动刷新前端数据
  useEffect(() => {
    const currentPhase = analyzeStatus?.state.phase ?? "idle";
    if (prevPhase !== "done" && currentPhase === "done") {
      loadAll().then(() => {
        onAction("分析已完成", `已更新前端数据集`);
      });
    }
    setPrevPhase(currentPhase);
  }, [analyzeStatus?.state.phase]);

  function createReportTask(type: TaskCreateInput["type"], name: string, batch: string) {
    onCreateTask({
      name,
      type,
      module: "竞品情报",
      batch,
      inputFiles: ["local-data/intelligence/top100.json", "local-data/intelligence/brand-ranking.json"],
      timeline: ["从竞品情报页创建任务", "等待离线分析结果导出"],
    });
  }

  return (
    <div>
      <PageHeader
        title="竞品情报与 TOP100"
        subtitle={
          metrics
            ? `覆盖 ${metrics.total} 款竞品，聚合价格、卖点与主图特征；样本周期 ${metrics.samplePeriod}。`
            : "集中查看竞品榜单、价格变化和主图分析结果。"
        }
        actions={
          <>
            <button className="btn-select" type="button">618 大促 · 床垫类目 ▾</button>
            <button
              className="btn"
              onClick={startAnalyzeAndRefresh}
              disabled={!canManage || analyzing || (analyzeStatus?.state.running ?? false) || !analyzeStatus?.hasSourceXlsx}
              type="button"
              title={
                !canManage
                  ? "当前账号仅可查看，不能启动竞品分析"
                  : !analyzeStatus?.hasSourceXlsx
                  ? "未检测到竞品原始表，请先完成数据导入"
                  : analyzeStatus?.hasVisionKey
                    ? "启动完整 pipeline：抽图 → Vision 分析 → 生成前端数据"
                    : "视觉分析服务尚未配置，本次将使用内置示例数据"
              }
              style={
                !canManage || !analyzeStatus?.hasSourceXlsx
                  ? { opacity: 0.6, cursor: "not-allowed" }
                  : undefined
              }
            >
              🚀 {analyzeStatus?.state.running ? "分析中…" : "分析并刷新"}
              {analyzeStatus && !analyzeStatus.hasVisionKey && !analyzeStatus.state.running && (
                <span className="ml-1 text-xs">（示例）</span>
              )}
            </button>
            <button
              className="btn"
              onClick={refreshAnalysis}
              disabled={refreshing}
              type="button"
              title="重新读取最近一次分析结果，不重新运行分析"
            >
              🔄 {refreshing ? "刷新中…" : "只刷新"}
            </button>
            <button
              className="btn"
              disabled
              type="button"
              title="网页采集功能尚未开放，当前使用已导入的竞品分析结果。"
              style={{ opacity: 0.5, cursor: "not-allowed" }}
            >
              🌐 网页实时抓取（需单独立项）
            </button>
          </>
        }
      />

      <Tabs<IntelligenceTab>
        value={tab}
        tabs={[
          { id: "top100", label: "行业 TOP100 主图抓取" },
          { id: "price", label: "竞品价格监控" },
        ]}
        onChange={setTab}
      />

      {tab === "top100" ? (
        <>
          {analyzeStatus && <AnalysisProgress status={analyzeStatus} />}

          {dataError && (
            <Card className="mb-4 border-[var(--red)]/40 bg-[var(--red)]/10">
              <div className="text-sm">
                <span className="font-bold text-[var(--red)]">加载离线分析失败：</span>
                <span className="text-[var(--muted)]">{dataError}</span>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  请确认 <code>local-data/intelligence/*.json</code> 已生成：
                  <code>node scripts/build-intelligence-dataset.mjs</code>
                </div>
              </div>
            </Card>
          )}

          <div className="metric-grid mb-5">
            <MetricCard metric={{ label: "已分析主图", value: metrics ? `${metrics.analyzed}/${metrics.total}` : "-", progress: metrics && metrics.total > 0 ? (metrics.analyzed / metrics.total) * 100 : 0, tone: "blue" }} />
            <MetricCard metric={{ label: "覆盖店铺数", value: String(metrics?.shops ?? "-"), tone: "purple" }} />
            <MetricCard metric={{ label: "麻大师 CP 排名", value: `#${metrics?.ownRank ?? "-"}`, tone: "green" }} />
            <MetricCard metric={{ label: "样本周期", value: metrics?.samplePeriod ?? "-", tone: "orange" }} />
          </div>

          {/* 4 流派卡片行 */}
          {insights && (
            <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {insights.schools.map((s) => (
                <div
                  key={s.id}
                  className={clsx(
                    "rounded-lg border p-4",
                    s.isOwnSchool
                      ? "border-[var(--green)] bg-[var(--green)]/10"
                      : "border-[var(--border)] bg-white/[0.02]"
                  )}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <div className={clsx("text-sm font-bold", s.isOwnSchool && "text-[var(--green)]")}>
                        流派 {s.id}：{s.name}
                      </div>
                      <div className="text-xs text-[var(--muted)]">{s.subtitle}</div>
                    </div>
                    {s.isOwnSchool && <span className="text-lg">⭐</span>}
                  </div>
                  <div className="mb-2 text-xs">
                    {s.representatives.map((r) => (
                      <span key={r} className="mr-1 inline-block rounded bg-white/[0.05] px-1.5 py-0.5">
                        {r}
                      </span>
                    ))}
                  </div>
                  <ul className="grid gap-1 text-xs leading-5 text-[var(--muted)]">
                    {s.features.map((f) => (
                      <li key={f}>• {f}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* 表格 + 右侧栏 */}
          <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
            <Card
              title="TOP100 榜单（按综合 CP 评分排序）"
              action={
                <div className="flex flex-wrap gap-2">
                  <button className="btn" onClick={() => createReportTask("export_package", "导出 TOP100 Excel", "EXPORT-TOP100-20260713")} type="button">导出 Excel</button>
                  <button className="btn" onClick={() => createReportTask("quality_check", "生成 TOP100 分析报告", "REPORT-TOP100-20260713")} type="button">生成分析报告</button>
                </div>
              }
            >
              <TableShell minWidth={1280}>
                <thead>
                  <tr>
                    <th style={{ width: 48 }}>CP#</th>
                    <th style={{ width: 88 }}>主图</th>
                    <th>商品名</th>
                    <th>品牌</th>
                    <th>店铺</th>
                    <th>平台</th>
                    <th>价格带</th>
                    <th>月销</th>
                    <th>核心营销手法</th>
                    <th style={{ width: 120 }}>综合 CP</th>
                    <th style={{ width: 90 }}>详情</th>
                  </tr>
                </thead>
                <tbody>
                  {top100?.items.map((item) => {
                    const imgUrl = competitorImageUrl(item.imageFile);
                    return (
                      <tr
                        key={item.row}
                        className={clsx(
                          "cursor-pointer transition-colors hover:bg-white/[0.04]",
                          item.isOwnBrand && "bg-[var(--green)]/5"
                        )}
                        onClick={() => setDrawerItem(item)}
                      >
                        <td className="font-mono tabular-nums font-bold">{item.cpRank}</td>
                        <td>
                          {imgUrl ? (
                            <img
                              src={imgUrl}
                              alt={item.productName}
                              loading="lazy"
                              className="h-14 w-14 rounded-md border border-[var(--border)] object-cover"
                            />
                          ) : (
                            <Thumbnail icon="🛏️" index={item.row} />
                          )}
                        </td>
                        <td className="max-w-xs">
                          <div className={clsx("font-semibold truncate", item.isOwnBrand && "text-[var(--green)]")}>
                            {item.isOwnBrand && "⭐ "}
                            {item.productName}
                          </div>
                          <div className="text-xs text-[var(--muted)] truncate">{item.headline}</div>
                        </td>
                        <td>{item.brand}</td>
                        <td className="text-xs text-[var(--muted)]">{item.shop}</td>
                        <td><PlatformBadge platform={item.platform as any} /></td>
                        <td className="text-xs">{item.priceRange}</td>
                        <td className="text-xs text-[var(--muted)]">{item.salesRange}</td>
                        <td className="max-w-[220px]">
                          <div className="truncate text-xs" title={item.marketingCore}>{item.marketingCore}</div>
                        </td>
                        <td><RatingBar value={item.scores.CP_total} /></td>
                        <td>
                          <button
                            className="btn"
                            onClick={(e) => { e.stopPropagation(); setDrawerItem(item); }}
                            type="button"
                          >
                            查看
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!top100 && !dataError && (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-sm text-[var(--muted)]">加载中…</td>
                    </tr>
                  )}
                </tbody>
              </TableShell>
            </Card>

            <InsightSidePanel brandRanking={brandRanking} insights={insights} />
          </div>

          <DetailDrawer item={drawerItem} onClose={() => setDrawerItem(null)} />
        </>
      ) : (
        <>
          {priceDegraded && (
            <Card className="mb-4 border-[var(--orange)]/40 bg-[var(--orange)]/10">
              <div className="text-sm">
                <span className="font-bold text-[var(--orange)]">业务管理后台数据不可用：</span>
                <span className="text-[var(--muted)]">{priceDegraded}</span>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  请在 <code>.env</code> 配置 <code>YUDAO_USERNAME</code> / <code>YUDAO_PASSWORD</code>，并确认 yudao 业务管理后台已启动。
                </div>
              </div>
            </Card>
          )}
        <div className="grid gap-4 xl:grid-cols-[0.75fr_1.6fr_0.75fr]">
          <Card title="竞品店铺列表">
            <TableShell minWidth={620}>
              <thead>
                <tr>
                  <th>店铺</th>
                  <th>平台</th>
                  <th>商品数</th>
                  <th>预警</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {competitorStores.map((store) => (
                  <tr key={store.store}>
                    <td>
                      <div className="font-semibold">{store.store}</div>
                      <div className="text-xs text-[var(--muted)]">{store.brand} · {store.lastCrawl}</div>
                    </td>
                    <td><PlatformBadge platform={store.platform} /></td>
                    <td>{store.productCount}</td>
                    <td className={store.warningCount > 0 ? "text-[var(--red)]" : "text-[var(--muted)]"}>{store.warningCount}</td>
                    <td><StatusTag label={store.status} tone={store.warningCount > 0 ? "red" : "green"} /></td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </Card>

          <Card
            title="商品价格列表"
            action={
              <div className="flex flex-wrap gap-2">
                <button className="btn" onClick={() => createReportTask("export_package", "导出价格监控 Excel", "EXPORT-PRICE-20260713")} type="button">导出 Excel</button>
                <button className="btn" onClick={() => createReportTask("quality_check", "生成价格监控分析报告", "REPORT-PRICE-20260713")} type="button">生成分析报告</button>
              </div>
            }
          >
            <TableShell minWidth={1460}>
              <thead>
                <tr>
                  <th>商品名</th>
                  <th>主图</th>
                  <th>店铺</th>
                  <th>品牌</th>
                  <th>平台</th>
                  <th>原价</th>
                  <th>券后价</th>
                  <th>活动信息</th>
                  <th>2026-07-06 价格</th>
                  <th>价格变化</th>
                  <th>30 日最低</th>
                  <th>上新状态</th>
                  <th>预警状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {priceItems?.map((item, index) => (
                  <tr key={item.id}>
                    <td className="font-semibold">{item.productName}</td>
                    <td><Thumbnail icon={item.mainImage} index={index} /></td>
                    <td>{item.store}</td>
                    <td>{item.brand}</td>
                    <td><PlatformBadge platform={item.platform} /></td>
                    <td>{item.originalPrice}</td>
                    <td className="text-[var(--green)]">{item.couponPrice}</td>
                    <td>{item.campaignInfo}</td>
                    <td>{item.previousPrice}</td>
                    <td className={item.priceChange.includes("▼") ? "text-[var(--red)]" : item.priceChange.includes("▲") ? "text-[var(--green)]" : "text-[var(--muted)]"}>{item.priceChange}</td>
                    <td>{item.low30d}</td>
                    <td>{item.newStatus}</td>
                    <td><StatusTag label={item.warningStatus} tone={item.tone} /></td>
                    <td><button className="btn" onClick={() => onAction("查看价格轨迹", `${item.productName} 的历史价格变化已打开`)} type="button">查看</button></td>
                  </tr>
                ))}
                {priceItems === null && (
                  <tr>
                    <td colSpan={14} className="py-8 text-center text-sm text-[var(--muted)]">加载中…</td>
                  </tr>
                )}
                {priceItems !== null && priceItems.length === 0 && (
                  <tr>
                    <td colSpan={14} className="py-8 text-center text-sm text-[var(--muted)]">
                      {priceDegraded ? "业务管理后台不可用，暂无竞品价格数据。" : "暂无竞品价格数据，请在业务管理后台维护。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </TableShell>
          </Card>

          <Card title="价格预警侧栏">
            <div className="grid gap-3">
              {(priceItems ?? []).filter((item) => item.warningStatus !== "无变化").map((item) => (
                <div className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3" key={item.id}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="font-bold">{item.productName}</div>
                    <StatusTag label={item.warningStatus} tone={item.tone} />
                  </div>
                  <div className="grid gap-1 text-xs leading-5 text-[var(--muted)]">
                    <div>降价幅度：<b className="text-[var(--red)]">{item.priceChange}</b></div>
                    <div>触发阈值：{item.alertThreshold}</div>
                    <div>原因：{item.alertReason}</div>
                    <div>建议动作：{item.suggestedAction}</div>
                  </div>
                  <button className="btn mt-3 w-full" onClick={() => createReportTask("quality_check", `${item.productName} 价格预警处理`, `ALERT-${item.id}`)} type="button">创建跟进任务</button>
                </div>
              ))}
            </div>
          </Card>
        </div>
        </>
      )}
    </div>
  );
}
