import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
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
import { competitorStores as mockCompetitorStores } from "../data/mock";
import { tmallCompetitorStores, tmallTop100Fallback, tmallScrapedAt, tmallPricePeriods } from "../data/tmallCompetitorData";
import { Pagination, usePaged } from "./Pagination";
import { competitorImageUrl, getBrandRanking, getInsights, getIntelligencePeriods, getTop100Dataset } from "../services/intelligenceApi";
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
  const [, setRefreshing] = useState(false);
  const [drawerItem, setDrawerItem] = useState<Top100ItemV2 | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [prevPhase, setPrevPhase] = useState<string>("idle");
  const analyzeStatus = useAnalyzeStatus(1500);
  const [priceItems, setPriceItems] = useState<CompetitorPriceItem[] | null>(null);
  const [priceDegraded, setPriceDegraded] = useState<string | null>(null);
  // 采样周期：top100Period="" 表示最新；pricePeriod 默认最新抓取日
  const [top100Periods, setTop100Periods] = useState<string[]>([]);
  const [top100Period, setTop100Period] = useState<string>("");
  const [pricePeriod, setPricePeriod] = useState<string>(tmallPricePeriods[0]?.period ?? "");

  useEffect(() => {
    getIntelligencePeriods()
      .then((p) => setTop100Periods(p.periods ?? []))
      .catch(() => setTop100Periods([]));
  }, []);

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

  async function loadAll(period?: string) {
    setRefreshing(true);
    setDataError(null);
    try {
      const [t, b, i] = await Promise.all([getTop100Dataset(period), getBrandRanking(period), getInsights(period)]);
      setTop100(t);
      setBrandRanking(b);
      setInsights(i);
    } catch (error) {
      // 离线分析数据尚未生成 → 用天猫实时抓取的行业榜单兜底（主图评分字段为空）
      setTop100(tmallTop100Fallback);
      setBrandRanking(null);
      setInsights(null);
      setDataError(null);
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

  // 价格 tab 当前周期数据：优先用多周期快照（含历史对比），否则用 yudao/tmall 兜底列表
  const activePriceItems = useMemo<CompetitorPriceItem[]>(() => {
    if (tmallPricePeriods.length > 0) {
      const sel = tmallPricePeriods.find((p) => p.period === pricePeriod) ?? tmallPricePeriods[0];
      return sel.items;
    }
    return priceItems ?? [];
  }, [pricePeriod, priceItems]);
  const activePricePeriodLabel = tmallPricePeriods.length > 0
    ? (tmallPricePeriods.find((p) => p.period === pricePeriod)?.period ?? tmallPricePeriods[0].period)
    : tmallScrapedAt;

  // 分页（>15 行出分页栏）
  const pagedTop100 = usePaged(top100?.items ?? []);
  const pagedPrices = usePaged(activePriceItems);
  const pagedStores = usePaged(tmallCompetitorStores.length > 0 ? tmallCompetitorStores : mockCompetitorStores);

  // 周期或数据变化时回到第一页
  useEffect(() => { pagedPrices.setPage(1); }, [pricePeriod, activePriceItems.length]);
  useEffect(() => { pagedTop100.setPage(1); }, [top100?.generatedAt]);

  // ---- 分析主图：上传源表 → 启动分析 ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reporting, setReporting] = useState(false);
  const [report, setReport] = useState<{ markdown: string; provider: string; model: string; period: string | null; generatedAt: string } | null>(null);

  async function onSourceFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!canManage) {
      onAction("当前账号无分析权限", "请联系管理员开通「执行竞品分析」权限");
      return;
    }
    if (!/\.xlsx$/i.test(file.name)) {
      onAction("文件格式不符合要求", "请选择 .xlsx 格式的生意参谋排行表");
      return;
    }
    setAnalyzing(true);
    try {
      // 1. 上传 + 服务端格式校验（缺列会 422 并说明缺哪列）
      const upRes = await fetch("/api/intelligence/upload-source", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      const upBody = await upRes.json().catch(() => ({}));
      if (!upRes.ok) {
        const missingTip = Array.isArray(upBody.missing) && upBody.missing.length
          ? `（缺少：${upBody.missing.join("、")}）`
          : "";
        throw new Error(`${upBody.error || `HTTP ${upRes.status}`}${missingTip}`);
      }
      onAction("上传成功", `周期 ${upBody.period}，共 ${upBody.rowCount} 个商品，开始下载原图并分析…`);
      // 2. 启动分析（按刚上传的周期）
      const useMock = !analyzeStatus?.hasVisionKey;
      const anRes = await fetch("/api/intelligence/analyze-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mock: useMock, period: upBody.slug }),
      });
      if (!anRes.ok) {
        const body = await anRes.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${anRes.status}`);
      }
    } catch (error) {
      onAction("分析启动失败", error instanceof Error ? error.message : String(error));
    } finally {
      setAnalyzing(false);
    }
  }

  async function cancelAnalyze() {
    try {
      await fetch("/api/intelligence/analyze-cancel", { method: "POST" });
      onAction("已请求取消", "当前图片处理完后停止，已完成部分会保留，下次自动续跑");
    } catch (error) {
      onAction("取消失败", error instanceof Error ? error.message : String(error));
    }
  }

  // ---- 生成分析报告：LLM + 框架模板 ----
  async function generateReport() {
    setReporting(true);
    try {
      const res = await fetch("/api/intelligence/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: top100Period || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setReport(body);
      onAction("报告已生成", `渠道：${body.provider} · 模型：${body.model}`);
    } catch (error) {
      onAction("报告生成失败", error instanceof Error ? error.message : String(error));
    } finally {
      setReporting(false);
    }
  }

  function downloadReport() {
    if (!report) return;
    const blob = new Blob([report.markdown], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `竞品主图营销分析_${report.period || "最新"}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
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
            <select
              className="btn-select"
              value={top100Period}
              onChange={(e) => {
                setTop100Period(e.target.value);
                loadAll(e.target.value || undefined);
              }}
              title="选择采样周期查看历史分析数据"
            >
              <option value="">最新（{metrics?.samplePeriod ?? "…"}）</option>
              {top100Periods.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              hidden
              onChange={onSourceFileSelected}
            />
            <button
              className="btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={!canManage || analyzing || (analyzeStatus?.state.running ?? false)}
              type="button"
              title={
                !canManage
                  ? "当前账号仅可查看，不能启动竞品分析"
                  : "选择生意参谋排行 Excel（需含商品图片链接列），按链接下载原图并逐张分析"
              }
              style={!canManage ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
            >
              🚀 {analyzing || (analyzeStatus?.state.running ?? false) ? "分析中…" : "分析主图"}
            </button>
            {(analyzeStatus?.state.running ?? false) && (
              <button
                className="btn"
                onClick={cancelAnalyze}
                type="button"
                title="中断当前分析；已完成的图片进度会保留，下次自动续跑"
              >
                ✕ 取消
              </button>
            )}
            <button
              className="btn"
              onClick={generateReport}
              disabled={reporting || !top100}
              type="button"
              title="按《床垫Top60主图营销分析》框架，用 LLM 基于当前周期数据生成报告"
            >
              📝 {reporting ? "生成中…" : "生成分析报告"}
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
            <Card title="TOP100 榜单（按综合 CP 评分排序）">
              <TableShell minWidth={1280}>
                <thead>
                  <tr>
                    <th style={{ width: 48 }}>CP#</th>
                    <th style={{ width: 88 }}>主图</th>
                    <th>商品名</th>
                    <th>品牌</th>
                    <th>店铺</th>
                    <th>平台</th>
                    <th>支付买家数</th>
                    <th>核心营销手法</th>
                    <th style={{ width: 120 }}>综合 CP</th>
                    <th style={{ width: 90 }}>详情</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedTop100.slice.map((item) => {
                    const imgUrl = competitorImageUrl(item.imageFile) || item.imageUrl || null;
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
                        <td className="text-xs">{item.salesRange || item.priceRange || "-"}</td>
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
                      <td colSpan={10} className="py-8 text-center text-sm text-[var(--muted)]">加载中…</td>
                    </tr>
                  )}
                </tbody>
              </TableShell>
              <Pagination total={pagedTop100.total} page={pagedTop100.page} pageSize={pagedTop100.pageSize} onChange={pagedTop100.setPage} />
            </Card>

            <InsightSidePanel brandRanking={brandRanking} insights={insights} />
          </div>

          <DetailDrawer item={drawerItem} onClose={() => setDrawerItem(null)} />

          {/* 分析报告模态框 */}
          {report && (
            <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
              <div className="flex-1 bg-black/60" onClick={() => setReport(null)} />
              <aside className="relative flex h-full w-full max-w-[860px] flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--bg)] shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] p-5">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <StatusTag label="分析报告" tone="green" />
                      <StatusTag label={report.period || "最新周期"} tone="muted" />
                      <StatusTag label={`${report.provider} · ${report.model}`} tone="muted" />
                    </div>
                    <h3 className="text-base font-bold leading-tight">竞品主图营销分析报告</h3>
                    <div className="mt-1 text-xs text-[var(--muted)]">生成于 {new Date(report.generatedAt).toLocaleString("zh-CN")}</div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button className="btn" onClick={downloadReport} type="button">⬇ 下载 .md</button>
                    <button className="btn" onClick={() => setReport(null)} aria-label="关闭" type="button">✕</button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-5">
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">{report.markdown}</pre>
                </div>
              </aside>
            </div>
          )}
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
        <div className="grid gap-4">
          <Card
            title="商品价格列表"
            action={
              <div className="flex flex-wrap items-center gap-2">
                {tmallPricePeriods.length > 1 && (
                  <select
                    className="btn-select"
                    value={pricePeriod}
                    onChange={(e) => setPricePeriod(e.target.value)}
                    title="选择抓取周期查看历史价格"
                  >
                    {tmallPricePeriods.map((p) => (
                      <option key={p.period} value={p.period}>{p.label}</option>
                    ))}
                  </select>
                )}
                <button className="btn" onClick={() => createReportTask("export_package", "导出价格监控 Excel", "EXPORT-PRICE-20260713")} type="button">导出 Excel</button>
                <button className="btn" onClick={() => createReportTask("quality_check", "生成价格监控分析报告", "REPORT-PRICE-20260713")} type="button">生成分析报告</button>
              </div>
            }
          >
            <TableShell minWidth={1460}>
              <thead>
                <tr>
                  <th>商品ID</th>
                  <th>商品名</th>
                  <th>主图</th>
                  <th>店铺</th>
                  <th>品牌</th>
                  <th>平台</th>
                  <th>原价</th>
                  <th>券后价</th>
                  <th>活动信息</th>
                  <th>最新价格（{activePricePeriodLabel}）</th>
                  <th>价格变化</th>
                  <th>30 日最低</th>
                  <th>上新状态</th>
                  <th>预警状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {pagedPrices.slice.map((item, index) => (
                  <tr key={item.id}>
                    <td className="font-mono text-xs text-[var(--muted)]">{item.id.replace(/^tmall-/, "")}</td>
                    <td className="font-semibold">{item.productName}</td>
                    <td>
                      {item.mainImage && item.mainImage.startsWith("http") ? (
                        <img
                          src={item.mainImage}
                          alt={item.productName}
                          loading="lazy"
                          className="h-24 w-24 rounded-md border border-[var(--border)] object-cover"
                        />
                      ) : (
                        <Thumbnail icon={item.mainImage} index={index} />
                      )}
                    </td>
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
                    <td colSpan={15} className="py-8 text-center text-sm text-[var(--muted)]">加载中…</td>
                  </tr>
                )}
                {priceItems !== null && priceItems.length === 0 && (
                  <tr>
                    <td colSpan={15} className="py-8 text-center text-sm text-[var(--muted)]">
                      {priceDegraded ? "业务管理后台不可用，暂无竞品价格数据。" : "暂无竞品价格数据，请在业务管理后台维护。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </TableShell>
            <Pagination total={pagedPrices.total} page={pagedPrices.page} pageSize={pagedPrices.pageSize} onChange={pagedPrices.setPage} />
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
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
                {pagedStores.slice.map((store) => (
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
            <Pagination total={pagedStores.total} page={pagedStores.page} pageSize={pagedStores.pageSize} onChange={pagedStores.setPage} />
          </Card>

          <Card title="价格预警侧栏">
            <div className="grid gap-3">
              {activePriceItems.filter((item) => item.warningStatus !== "无变化").map((item) => (
                <div className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3" key={item.id}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="font-bold">{item.productName}</div>
                    <StatusTag label={item.warningStatus} tone={item.tone} />
                  </div>
                  <div className="grid gap-1 text-xs leading-5 text-[var(--muted)]">
                    <div>变化幅度：<b className="text-[var(--red)]">{item.priceChange}</b></div>
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
        </div>
        </>
      )}
    </div>
  );
}

// rebuild trigger

// touch 2026-08-31T18:10:27
