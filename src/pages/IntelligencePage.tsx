import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
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
import { TMALL_CATEGORY_DATA, TMALL_CATEGORY_ORDER, type TmallCategory } from "../data/tmallCategoryData";
import type { TmallSkuDetail } from "../data/tmallCompetitorData";
import { Pagination, usePaged } from "../components/Pagination";
import { competitorImageUrl, getBrandRanking, getInsights, getIntelligencePeriods, getTop100Dataset, recalcCpScores, deriveBrandRanking } from "../services/intelligenceApi";
import { getCompetitorPrices } from "../services/localApi";
import type { BrandRankingDataset, CompetitorPriceItem, InsightsDataset, TaskCreateInput, Top100Dataset, Top100ItemV2 } from "../types";
import { clsx } from "../utils/format";

type IntelligenceTab = "top100" | "price";

// 价格表可排序列（价格数据列）
type PriceSortKey = "originalPrice" | "couponPrice" | "previousPrice" | "low30d";

// TOP100 表可排序列（数字列：排名 / 支付买家数 / 综合 CP）
type TopSortKey = "cpRank" | "sales" | "cp";

interface PriceTrendPoint {
  period: string;
  price: number | null;
  rawPrice: string | null;
}

// 从 "¥1,299" 之类字符串中提取数值，取不到返回 null（排序时排最后）
function parsePriceValue(text: string): number | null {
  const m = String(text ?? "").replace(/,/g, "").match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}

// SKU 明细子表：本期在售 SKU 逐条价格 + 各期券后价趋势（数据随类目数据模块嵌入，按商品 id 索引）
function SkuDetailTable({ itemId, skuDetails, trendDays, scrapedAt, sizeLabel }: {
  itemId: string;
  skuDetails: Record<string, TmallSkuDetail[]>;
  trendDays: string[];
  scrapedAt: string;
  sizeLabel: string;
}) {
  const details = skuDetails[itemId] ?? [];
  if (details.length === 0) {
    return <div className="px-4 py-3 text-xs text-[var(--muted)]">该商品本期无 SKU 明细数据</div>;
  }
  const shortDays = trendDays.map((d) => d.slice(5));
  return (
    <div className="px-4 py-3">
      <div className="mb-2 text-xs text-[var(--muted)]">
        本期在售 SKU 明细（{scrapedAt} 抓取 · {sizeLabel} · 按券后价从低到高，共 {details.length} 个）
      </div>
      <table className="w-full text-[13px] leading-6">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-[var(--muted)]">
            <th className="py-2 pr-4 text-xs font-normal">颜色规格</th>
            <th className="py-2 pr-4 text-xs font-normal">SKUID</th>
            <th className="py-2 pr-4 text-xs font-normal">原价</th>
            <th className="py-2 pr-4 text-xs font-normal">券后价</th>
            <th className="py-2 pr-4 text-xs font-normal">较上期</th>
            <th className="py-2 pr-4 text-xs font-normal">库存</th>
            <th className="py-2 text-xs font-normal">各期券后价（{shortDays.join(" → ")}）</th>
          </tr>
        </thead>
        <tbody>
          {details.map((d) => (
            <tr key={d.skuId} className="border-b border-[var(--border)]/40 last:border-0">
              <td className="max-w-[280px] truncate py-2.5 pr-4" title={d.color}>{d.color}</td>
              <td className="py-2.5 pr-4 font-mono text-xs text-[var(--muted)]">{d.skuId}</td>
              <td className="py-2.5 pr-4">{d.price}</td>
              <td className="py-2.5 pr-4 text-[var(--green)]">{d.coupon}</td>
              <td className={clsx("py-2.5 pr-4", d.change.includes("▼") ? "text-[var(--red)]" : d.change.includes("▲") ? "text-[var(--green)]" : "text-[var(--muted)]")}>{d.change}</td>
              <td className="py-2.5 pr-4">{d.stock}</td>
              <td
                className="py-2.5 font-mono"
                title={d.trend.map((t) => `${t.period.replace(/_~_/g, " ~ ").replace(/_/g, " ")}：${t.coupon ?? "无数据"}`).join("\n")}
              >
                {d.trend.map((t) => t.coupon ?? "–").join(" → ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface IntelligencePageProps {
  onAction: (title: string, detail?: string) => void;
  onCreateTask: (task: TaskCreateInput) => void;
  canManage: boolean;
}

export function IntelligencePage({ onAction, onCreateTask, canManage }: IntelligencePageProps) {
  const [tab, setTab] = useState<IntelligenceTab>("top100");
  // 全局类目控件：床垫类（默认）/ 儿童床垫；同时作用于 TOP100 榜单与竞品价格监控两个 tab
  const [category, setCategory] = useState<TmallCategory>("mattress");
  const catMeta = TMALL_CATEGORY_DATA[category];
  const catData = catMeta.data;
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
  // 统一周期："" = 最新；同时控制 TOP100 与竞品价格监控（价格周期 key 与 TOP100 slug 对齐，同一来源文件归同一日期）
  const [top100Periods, setTop100Periods] = useState<string[]>([]);
  const [top100Period, setTop100Period] = useState<string>("");
  const [priceQuery, setPriceQuery] = useState("");
  // 价格表行展开：本期 SKU 明细子表（可同时展开多行）
  const [expandedSkuIds, setExpandedSkuIds] = useState<ReadonlySet<string>>(new Set());

  function toggleSkuExpand(id: string) {
    setExpandedSkuIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // 周期列表按类目拉取；切类目时重置为"最新"并重新加载全部数据
  useEffect(() => {
    getIntelligencePeriods(category)
      .then((p) => setTop100Periods(p.periods ?? []))
      .catch(() => setTop100Periods([]));
  }, [category]);

  function switchCategory(next: TmallCategory) {
    if (next === category) return;
    setCategory(next);
    setTop100Period("");
    setExpandedSkuIds(new Set());
    loadAll(undefined, next);
  }

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

  async function loadAll(period?: string, cat?: TmallCategory) {
    const effectiveCat = cat ?? category;
    setRefreshing(true);
    setDataError(null);
    try {
      const [t, b, i] = await Promise.all([getTop100Dataset(period, effectiveCat), getBrandRanking(period, effectiveCat), getInsights(period, effectiveCat)]);
      // CP 细粒度重算：旧周期数据是 1-5 整数口径，统一在服务层换算后再进组件
      const recalced = recalcCpScores(t);
      setTop100(recalced);
      setBrandRanking(deriveBrandRanking(recalced, b));
      setInsights(i);
    } catch (error) {
      // 离线分析数据尚未生成 → 用天猫实时抓取的行业榜单兜底（主图评分字段为空）
      setTop100(TMALL_CATEGORY_DATA[effectiveCat].data.tmallTop100Fallback);
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

  // 价格 tab 与 TOP100 共用右上角周期选择器；选中周期无价格数据时给空态提示，不静默回退
  const tmallPricePeriods = catData.tmallPricePeriods;
  const hasPriceSnapshots = tmallPricePeriods.length > 0;
  const pricePeriodEntry = tmallPricePeriods.find((p) => p.period === top100Period) ?? null;
  // 选了具体周期但没有对应价格快照（或根本没有快照数据）→ 空态
  const pricePeriodMissing = Boolean(top100Period) && !pricePeriodEntry;
  const activePriceItems = useMemo<CompetitorPriceItem[]>(() => {
    if (hasPriceSnapshots) {
      return (top100Period ? pricePeriodEntry?.items : tmallPricePeriods[0].items) ?? [];
    }
    if (top100Period) return []; // 无快照时选历史周期：无数据可显示
    return priceItems ?? [];
  }, [hasPriceSnapshots, top100Period, pricePeriodEntry, priceItems, tmallPricePeriods]);
  const activePricePeriodLabel =
    (top100Period || tmallPricePeriods[0]?.period || "").replace(/_~_/g, " ~ ") || catData.tmallScrapedAt;

  // 上一期价格 = 上一周期的最低价；快照列表按抓取日倒序，当前周期的后一条即上一期
  const activePricePeriodIndex = useMemo(() => {
    if (!hasPriceSnapshots) return -1;
    if (!top100Period) return 0;
    return tmallPricePeriods.findIndex((p) => p.period === top100Period);
  }, [hasPriceSnapshots, top100Period, tmallPricePeriods]);
  const prevPricePeriodEntry = activePricePeriodIndex >= 0 ? tmallPricePeriods[activePricePeriodIndex + 1] ?? null : null;
  const prevPricePeriodLabel = prevPricePeriodEntry ? prevPricePeriodEntry.period.replace(/_~_/g, " ~ ") : "";

  // 模糊搜索：商品名 / 店铺 / 品牌 / 商品ID
  const filteredPriceItems = useMemo<CompetitorPriceItem[]>(() => {
    const q = priceQuery.trim().toLowerCase();
    if (!q) return activePriceItems;
    return activePriceItems.filter((i) =>
      [i.productName, i.store, i.brand, i.id.replace(/^tmall-/, "")]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q))
    );
  }, [activePriceItems, priceQuery]);

  // 列头排序：点击循环 升序 → 降序 → 取消（仅价格数据列）
  const [priceSortKey, setPriceSortKey] = useState<PriceSortKey | null>(null);
  const [priceSortDir, setPriceSortDir] = useState<"asc" | "desc">("asc");

  function togglePriceSort(key: PriceSortKey) {
    if (priceSortKey !== key) {
      setPriceSortKey(key);
      setPriceSortDir("asc");
    } else if (priceSortDir === "asc") {
      setPriceSortDir("desc");
    } else {
      setPriceSortKey(null);
      setPriceSortDir("asc");
    }
  }

  function priceSortIndicator(key: PriceSortKey) {
    if (priceSortKey !== key) return "";
    return priceSortDir === "asc" ? " ▲" : " ▼";
  }

  const sortedPriceItems = useMemo<CompetitorPriceItem[]>(() => {
    if (!priceSortKey) return filteredPriceItems;
    const dir = priceSortDir === "asc" ? 1 : -1;
    return [...filteredPriceItems].sort((a, b) => {
      const va = parsePriceValue(a[priceSortKey]);
      const vb = parsePriceValue(b[priceSortKey]);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // 无价格数据排最后
      if (vb === null) return -1;
      return (va - vb) * dir;
    });
  }, [filteredPriceItems, priceSortKey, priceSortDir]);

  // TOP100 列头排序：与价格表同一交互（升序 → 降序 → 取消），默认保持 CP 降序
  const [topSortKey, setTopSortKey] = useState<TopSortKey | null>(null);
  const [topSortDir, setTopSortDir] = useState<"asc" | "desc">("asc");

  function toggleTopSort(key: TopSortKey) {
    if (topSortKey !== key) {
      setTopSortKey(key);
      setTopSortDir("asc");
    } else if (topSortDir === "asc") {
      setTopSortDir("desc");
    } else {
      setTopSortKey(null);
      setTopSortDir("asc");
    }
  }

  function topSortIndicator(key: TopSortKey) {
    if (topSortKey !== key) return "";
    return topSortDir === "asc" ? " ▲" : " ▼";
  }

  const sortedTop100Items = useMemo<Top100ItemV2[]>(() => {
    const items = top100?.items ?? [];
    if (!topSortKey) return items;
    const dir = topSortDir === "asc" ? 1 : -1;
    const valueOf = (it: Top100ItemV2): number | null => {
      if (topSortKey === "cpRank") return typeof it.cpRank === "number" ? it.cpRank : null;
      if (topSortKey === "cp") return typeof it.scores?.CP_total === "number" ? it.scores.CP_total : null;
      // sales：支付买家数区间（如 "250 ~ 500"）取首个数值；旧数据该值在 priceRange 里，做兜底
      return parsePriceValue(it.salesRange || it.priceRange || "");
    };
    return [...items].sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // 无数据排最后
      if (vb === null) return -1;
      return (va - vb) * dir;
    });
  }, [top100, topSortKey, topSortDir]);

  // 分页（>15 行出分页栏）
  const pagedTop100 = usePaged(sortedTop100Items);
  const pagedPrices = usePaged(sortedPriceItems);
  const pagedStores = usePaged(catData.tmallCompetitorStores.length > 0 ? catData.tmallCompetitorStores : mockCompetitorStores);

  // 类目/周期/搜索/排序/数据变化时回到第一页
  useEffect(() => { pagedPrices.setPage(1); }, [category, top100Period, priceQuery, filteredPriceItems.length, priceSortKey, priceSortDir]);
  useEffect(() => { pagedTop100.setPage(1); }, [category, top100Period, top100?.generatedAt, topSortKey, topSortDir]);

  // ---- 分析主图：上传源表 → 启动分析 ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reporting, setReporting] = useState(false);
  const [report, setReport] = useState<{ markdown: string; provider: string; model: string; period: string | null; generatedAt: string } | null>(null);
  const [savePath, setSavePath] = useState("");
  const [savingReport, setSavingReport] = useState(false);

  function defaultReportPath(period: string | null) {
    const tag = (period || "最新").replace(/[\\/:*?"<>|\s]+/g, "_");
    return `C:\\Users\\Administrator\\Desktop\\竞品分析报告\\竞品主图营销分析_${tag}.md`;
  }

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
      setSavePath(defaultReportPath(body.period ?? null));
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

  // 指定位置落盘：server 端写文件（页面是 http 非安全上下文，浏览器 save-as 选择器不可用）
  async function saveReportToPath() {
    if (!report) return;
    const path = savePath.trim() || defaultReportPath(report.period);
    setSavingReport(true);
    try {
      const doSave = async (overwrite: boolean) => {
        const res = await fetch("/api/intelligence/save-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, content: report.markdown, overwrite }),
        });
        return { ok: res.ok, body: await res.json().catch(() => ({})) };
      };
      let { ok, body } = await doSave(false);
      if (!ok && body?.exists && window.confirm(`文件已存在：\n${body.path}\n\n是否覆盖？`)) {
        ({ ok, body } = await doSave(true));
      }
      if (!ok) throw new Error(body.error || "保存失败");
      onAction(body.overwritten ? "报告已覆盖保存" : "报告已保存", `文件位置：${body.path}`);
    } catch (error) {
      onAction("保存失败", error instanceof Error ? error.message : String(error));
    } finally {
      setSavingReport(false);
    }
  }

  // ---- 价格轨迹：读取 server 聚合的多期价格快照（price-snapshots/<period>.json）----
  const [priceTrend, setPriceTrend] = useState<{ productName: string | null; points: PriceTrendPoint[] } | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);

  async function showPriceTrend(item: CompetitorPriceItem) {
    setTrendLoading(true);
    try {
      const trendQuery = category === "mattress" ? "" : `&category=${encodeURIComponent(category)}`;
      const res = await fetch(`/api/intelligence/price-trend?id=${encodeURIComponent(item.id)}${trendQuery}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setPriceTrend({
        productName: typeof body.productName === "string" && body.productName ? body.productName : item.productName,
        points: Array.isArray(body.points) ? body.points : [],
      });
    } catch (error) {
      onAction("价格轨迹加载失败", error instanceof Error ? error.message : String(error));
    } finally {
      setTrendLoading(false);
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
            <select
              className="btn-select"
              value={category}
              onChange={(e) => switchCategory(e.target.value as TmallCategory)}
              title="全局类目：同时切换 TOP100 榜单与竞品价格监控的数据来源"
            >
              {TMALL_CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>{TMALL_CATEGORY_DATA[c].label}</option>
              ))}
            </select>
            <select
              className="btn-select"
              value={top100Period}
              onChange={(e) => {
                setTop100Period(e.target.value);
                loadAll(e.target.value || undefined);
              }}
              title="选择采样周期：同时切换 TOP100 榜单与竞品价格（同一来源文件归同一日期）"
            >
              <option value="">最新（{top100Periods[0]?.replace(/_~_/g, " ~ ").replace(/_/g, " ") ?? "…"}）</option>
              {top100Periods.map((p) => (
                <option key={p} value={p}>{p.replace(/_~_/g, " ~ ").replace(/_/g, " ")}</option>
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
              disabled={!canManage || analyzing || (analyzeStatus?.state.running ?? false) || !catMeta.analyzeSupported}
              type="button"
              title={
                !catMeta.analyzeSupported
                  ? `离线分析管线当前仅接入床垫类，${catMeta.label}暂不支持上传分析`
                  : !canManage
                    ? "当前账号仅可查看，不能启动竞品分析"
                    : "选择生意参谋排行 Excel（需含商品图片链接列），按链接下载原图并逐张分析"
              }
              style={!canManage || !catMeta.analyzeSupported ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
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
              disabled={reporting || !top100 || !catMeta.analyzeSupported}
              type="button"
              title={
                !catMeta.analyzeSupported
                  ? `报告生成管线当前仅接入床垫类，${catMeta.label}暂不支持`
                  : "按《床垫Top60主图营销分析》框架，用 LLM 基于当前周期数据生成报告"
              }
              style={!catMeta.analyzeSupported ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
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
                    <th className="cursor-pointer select-none" style={{ width: 48 }} onClick={() => toggleTopSort("cpRank")} title="点击切换排序：升序 → 降序 → 取消">排名{topSortIndicator("cpRank")}</th>
                    <th style={{ width: 88 }}>主图</th>
                    <th>商品名</th>
                    <th>品牌</th>
                    <th>店铺</th>
                    <th>平台</th>
                    <th className="cursor-pointer select-none" onClick={() => toggleTopSort("sales")} title="点击切换排序：升序 → 降序 → 取消">支付买家数{topSortIndicator("sales")}</th>
                    <th>核心营销手法</th>
                    <th className="cursor-pointer select-none" style={{ width: 120 }} onClick={() => toggleTopSort("cp")} title="点击切换排序：升序 → 降序 → 取消">综合 CP{topSortIndicator("cp")}</th>
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
                              className="h-14 w-14 cursor-zoom-in rounded-md border border-[var(--border)] object-cover"
                              title="查看原图"
                              onClick={(e) => { e.stopPropagation(); window.open(imgUrl, "_blank"); }}
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
              <div className="flex flex-wrap items-center justify-end gap-2">
                <input
                  className="workflow-search-input"
                  style={{ flex: "0 1 220px", minWidth: 160 }}
                  placeholder="搜索商品名 / 店铺 / 品牌 / ID"
                  value={priceQuery}
                  onChange={(e) => setPriceQuery(e.target.value)}
                  title="模糊匹配：商品名、店铺、品牌、商品ID"
                />
              </div>
            }
          >
            <TableShell minWidth={1460}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>商品ID</th>
                  <th>商品名</th>
                  <th style={{ width: 120 }}>主图</th>
                  <th>店铺</th>
                  <th>品牌</th>
                  <th>平台</th>
                  <th className="cursor-pointer select-none" onClick={() => togglePriceSort("originalPrice")} title="点击切换排序：升序 → 降序 → 取消">原价{priceSortIndicator("originalPrice")}</th>
                  <th className="cursor-pointer select-none" onClick={() => togglePriceSort("couponPrice")} title="点击切换排序：升序 → 降序 → 取消">券后价（{activePricePeriodLabel}）{priceSortIndicator("couponPrice")}</th>
                  <th>活动信息</th>
                  <th className="cursor-pointer select-none" onClick={() => togglePriceSort("previousPrice")} title="点击切换排序：升序 → 降序 → 取消">上一期价格{prevPricePeriodLabel ? `（${prevPricePeriodLabel}）` : ""}{priceSortIndicator("previousPrice")}</th>
                  <th>价格变化</th>
                  <th className="cursor-pointer select-none" onClick={() => togglePriceSort("low30d")} title="点击切换排序：升序 → 降序 → 取消">30 日最低{priceSortIndicator("low30d")}</th>
                  <th>上新状态</th>
                  <th>预警状态</th>
                  <th>价格趋势</th>
                </tr>
              </thead>
              <tbody>
                {pagedPrices.slice.map((item, index) => (
                  <Fragment key={item.id}>
                    <tr>
                      <td className="w-9 text-center">
                        <button
                          className="priority-hierarchy-toggle"
                          onClick={() => toggleSkuExpand(item.id)}
                          type="button"
                          aria-label={expandedSkuIds.has(item.id) ? "收起本期 SKU 明细" : "展开本期 SKU 明细"}
                          aria-expanded={expandedSkuIds.has(item.id)}
                          title={expandedSkuIds.has(item.id) ? "收起本期 SKU 明细" : "展开本期 SKU 明细"}
                        >
                          <span aria-hidden="true" className="priority-hierarchy-icon">{expandedSkuIds.has(item.id) ? "−" : "+"}</span>
                        </button>
                      </td>
                      <td className="font-mono text-xs text-[var(--muted)]">{item.id.replace(/^tmall-/, "")}</td>
                    <td className="font-semibold">{item.productName}</td>
                      <td>
                        {item.mainImage && item.mainImage.startsWith("http") ? (
                          <img
                            src={item.mainImage}
                            alt={item.productName}
                            loading="lazy"
                            className="h-28 w-28 cursor-zoom-in rounded-md border border-[var(--border)] object-cover"
                            title="查看原图"
                            onClick={(e) => { e.stopPropagation(); window.open(item.mainImage, "_blank"); }}
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
                      <td><button className="btn" onClick={() => showPriceTrend(item)} disabled={trendLoading} type="button" title="查看该商品的多期价格快照">{trendLoading ? "加载中…" : "查看"}</button></td>
                    </tr>
                    {expandedSkuIds.has(item.id) && (
                      <tr className="bg-white/[0.02]">
                        <td colSpan={16} style={{ padding: 0 }}>
                          <SkuDetailTable
                            itemId={item.id}
                            skuDetails={catData.tmallSkuDetails}
                            trendDays={catData.tmallSkuTrendDays}
                            scrapedAt={catData.tmallScrapedAt}
                            sizeLabel={catMeta.skuSizeLabel}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {priceItems === null && (
                  <tr>
                    <td colSpan={16} className="py-8 text-center text-sm text-[var(--muted)]">加载中…</td>
                  </tr>
                )}
                {priceItems !== null && filteredPriceItems.length === 0 && (
                  <tr>
                    <td colSpan={16} className="py-8 text-center text-sm text-[var(--muted)]">
                      {priceQuery
                        ? `没有匹配「${priceQuery}」的商品`
                        : pricePeriodMissing
                          ? "该周期暂无价格数据"
                          : priceDegraded
                            ? "业务管理后台不可用，暂无竞品价格数据。"
                            : "暂无竞品价格数据，请在业务管理后台维护。"}
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

      {/* 分析报告模态框（全局渲染：两个 tab 下都能打开） */}
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
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-3">
              <span className="shrink-0 text-xs text-[var(--muted)]">保存到</span>
              <input
                className="workflow-search-input"
                style={{ flex: 1 }}
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
                placeholder={defaultReportPath(report.period)}
                title="运行本系统的电脑上的绝对路径（.md 结尾）；留空用默认位置"
              />
              <button className="btn" onClick={saveReportToPath} disabled={savingReport} type="button">
                💾 {savingReport ? "保存中…" : "保存到指定位置"}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">{report.markdown}</pre>
            </div>
          </aside>
        </div>
      )}

      {/* 价格轨迹弹窗（全局渲染：多期价格快照的简版列表） */}
      {priceTrend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60" onClick={() => setPriceTrend(null)} />
          <div className="relative w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--bg)] p-5 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <div className="mb-1"><StatusTag label="价格轨迹" tone="blue" /></div>
                <h3 className="text-base font-bold leading-tight">{priceTrend.productName || "未知商品"}</h3>
                <div className="mt-1 text-xs text-[var(--muted)]">（商品最低价 SKU 价格）</div>
              </div>
              <button className="btn" onClick={() => setPriceTrend(null)} aria-label="关闭" type="button">✕</button>
            </div>
            {priceTrend.points.length === 0 ? (
              <div className="py-6 text-center text-sm text-[var(--muted)]">暂无历史价格快照</div>
            ) : (
              <ul className="max-h-[60vh] divide-y divide-[var(--border)] overflow-y-auto text-sm">
                {priceTrend.points.map((p) => (
                  <li key={p.period} className="flex items-center justify-between gap-4 py-2">
                    <span className="text-xs text-[var(--muted)]">{String(p.period).replace(/_~_/g, " ~ ").replace(/_/g, " ")}</span>
                    <span className="font-mono font-semibold text-[var(--green)]">{p.price != null ? `¥${p.price}` : (p.rawPrice ?? "-")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// rebuild trigger
