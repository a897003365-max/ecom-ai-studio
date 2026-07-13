import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/Card";
import { MetricCard } from "../components/MetricCard";
import { PageHeader } from "../components/PageHeader";
import { PlatformBadge } from "../components/PlatformBadge";
import { StatusTag } from "../components/StatusTag";
import { TableShell } from "../components/TableShell";
import { Thumbnail } from "../components/Thumbnail";
import { analyticsKpis, materialTop10, platformStatuses, regenerationSuggestions } from "../data/mock";
import { getAnalyticsData, syncDataSource } from "../services/localApi";
import type { KpiMetric, Platform, RegenerationSuggestion } from "../types";
import type { AnalyticsIntegrationPayload, DingTalkSnapshot, WarehouseSnapshot } from "../types/integration";

interface AnalyticsPageProps {
  onAction: (title: string, detail?: string) => void;
  onCreateTask: (suggestion: RegenerationSuggestion) => void;
}

const compactNumber = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const currencyNumber = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", notation: "compact", maximumFractionDigits: 1 });

function money(value: number) {
  return currencyNumber.format(value || 0);
}

function count(value: number) {
  return compactNumber.format(value || 0);
}

function percent(value: number) {
  return `${((value || 0) * 100).toFixed(2)}%`;
}

function liveKpis(snapshot: WarehouseSnapshot, dingtalk: DingTalkSnapshot | null): KpiMetric[] {
  const current = dingtalk?.totals;
  const gmv = current?.gmv || snapshot.totals.gmv;
  const spend = current?.spend || snapshot.totals.spend;
  const exposure = current?.exposure || snapshot.totals.exposure;
  const clicks = current?.clicks || snapshot.totals.clicks;
  const refund = current?.refund || snapshot.totals.refund;
  const addToCart = current?.addToCart || snapshot.totals.addToCart;
  const netRevenue = current?.netRevenue || snapshot.totals.netRevenue;
  const roi = spend ? gmv / spend : snapshot.totals.roi;
  const ctr = exposure ? clicks / exposure : snapshot.totals.ctr;
  return [
    { label: "GMV", value: money(gmv), detail: dingtalk ? "钉钉全渠道当期聚合" : `${snapshot.period.start} 至 ${snapshot.period.end}`, tone: "green" },
    { label: "回款额", value: money(netRevenue), detail: "GMV 扣除退款后的经营口径", tone: "blue" },
    { label: "推广消耗", value: money(spend), detail: dingtalk ? "钉钉共享表当期数据" : "本地数仓历史口径", tone: "orange" },
    { label: "推广 ROI", value: roi.toFixed(2), detail: "GMV / 推广消耗", tone: "green" },
    { label: "曝光", value: count(exposure), detail: `点击 ${count(clicks)}`, tone: "purple" },
    { label: "点击率", value: percent(ctr), detail: "点击 / 曝光", tone: "blue" },
    { label: "退款金额", value: money(refund), detail: "成功退款聚合", tone: "pink" },
    { label: "加购人数", value: count(addToCart), detail: "跨渠道加购聚合", tone: "orange" },
  ];
}

function linePoints(values: number[]) {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((value, index) => {
    const x = 20 + (values.length === 1 ? 0 : index * 660 / (values.length - 1));
    const y = 24 + (1 - (value - min) / span) * 132;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export function AnalyticsPage({ onAction, onCreateTask }: AnalyticsPageProps) {
  const [createdIds, setCreatedIds] = useState<string[]>([]);
  const [showDingTalkInventory, setShowDingTalkInventory] = useState(false);
  const [integration, setIntegration] = useState<AnalyticsIntegrationPayload | null>(null);
  const [syncing, setSyncing] = useState<"warehouse" | "feishu" | "dingtalk" | null>(null);

  useEffect(() => {
    getAnalyticsData().then(setIntegration).catch(() => setIntegration(null));
  }, []);

  const warehouse = integration?.warehouse ?? null;
  const feishu = integration?.feishu ?? null;
  const dingtalk = integration?.dingtalk ?? null;
  const metrics = warehouse ? liveKpis(warehouse, dingtalk) : analyticsKpis;
  const platformRows = dingtalk?.platforms ?? warehouse?.platforms ?? [];
  const trend = useMemo(() => (warehouse?.daily ?? []).map((row) => ({
    ctr: row.ctr,
    conversion: row.clicks ? row.addToCart / row.clicks : 0,
    roi: row.roi,
  })), [warehouse]);

  function createTask(suggestion: RegenerationSuggestion) {
    setCreatedIds((current) => [...current, suggestion.id]);
    onCreateTask(suggestion);
  }

  async function sync(source: "warehouse" | "feishu" | "dingtalk") {
    setSyncing(source);
    const startDetails = {
      warehouse: "正在增量读取本地 Excel、XLS 与 CSV，并更新 Parquet / DuckDB",
      feishu: "正在聚合飞书业务表，原始个人字段不会保存",
      dingtalk: "正在通过钉钉 Sheet API 只读同步，仅保存经营指标聚合",
    };
    onAction("开始同步", startDetails[source]);
    try {
      await syncDataSource(source);
      setIntegration(await getAnalyticsData());
      const doneDetails = {
        warehouse: "本地数仓与经营快照已更新",
        feishu: "飞书聚合指标已写入本地历史",
        dingtalk: "钉钉只读聚合快照已写入本地历史",
      };
      onAction("同步完成", doneDetails[source]);
    } catch (error) {
      onAction("同步失败", error instanceof Error ? error.message : "本地数据源不可用");
    } finally {
      setSyncing(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="运营数据看板"
        subtitle="同一端口调度本地 DuckDB / Parquet 数仓、钉钉经营数据与飞书内容数据；网页只读取聚合快照。"
        actions={
          <>
            <button className="btn" disabled={syncing !== null} onClick={() => void sync("warehouse")} type="button">
              {syncing === "warehouse" ? "建仓中..." : "同步本地数仓"}
            </button>
            <button className="btn" disabled={syncing !== null} onClick={() => void sync("feishu")} type="button">
              {syncing === "feishu" ? "聚合中..." : "同步飞书"}
            </button>
            <button className="btn" disabled={syncing !== null} onClick={() => void sync("dingtalk")} type="button">
              {syncing === "dingtalk" ? "解析中..." : "同步钉钉"}
            </button>
            <button className="btn-select" type="button">{warehouse ? `${warehouse.period.start} ~ ${warehouse.period.end}` : "演示周期"} ▾</button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2 border-y border-[var(--border)] bg-white/[0.015] px-3 py-2.5 text-xs text-[var(--muted)]">
        <StatusTag label={warehouse ? "本地数仓实数" : "数仓未同步"} tone={warehouse ? "green" : "orange"} dot />
        <StatusTag label={feishu ? "飞书聚合实数" : "飞书未同步"} tone={feishu ? "green" : "muted"} dot />
        <StatusTag label={dingtalk ? "钉钉只读实数" : "钉钉未同步"} tone={dingtalk ? "green" : "muted"} dot />
        <span>{warehouse ? `数仓刷新于 ${new Date(warehouse.refreshedAt).toLocaleString("zh-CN")}` : "当前 KPI 使用原型 mock，点击同步后切换为本机实数"}</span>
      </div>

      <div className="metric-grid mb-5">
        {metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
      </div>

      <Card title={warehouse ? `平台经营状态（${dingtalk ? "钉钉当期" : "本地数仓"}）` : "平台发布状态（演示）"} className="mb-5">
        {warehouse ? (
          <TableShell minWidth={860}>
            <thead><tr><th>平台</th><th>状态</th><th>曝光</th><th>点击</th><th>GMV</th><th>回款额</th><th>消耗</th><th>ROI</th></tr></thead>
            <tbody>
              {platformRows.map((item) => (
                <tr key={item.platform}>
                  <td><PlatformBadge platform={item.platform as Platform} /></td>
                  <td><StatusTag label="已同步" tone="green" dot /></td>
                  <td>{count(item.exposure)}</td><td>{count(item.clicks)}</td><td>{money(item.gmv)}</td>
                  <td>{money(item.netRevenue ?? 0)}</td><td>{money(item.spend)}</td><td>{item.roi.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        ) : (
          <TableShell minWidth={860}>
            <thead><tr><th>平台</th><th>状态</th><th>计划数</th><th>素材数</th><th>曝光</th><th>点击</th><th>GMV</th></tr></thead>
            <tbody>
              {platformStatuses.map((item) => (
                <tr key={item.platform}>
                  <td><PlatformBadge platform={item.platform} /></td><td><StatusTag label={item.status} tone={item.tone} dot /></td>
                  <td>{item.planCount}</td><td>{item.assetCount}</td><td>{item.impressions}</td><td>{item.clicks}</td><td>{item.gmv}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>

      {feishu && (
        <Card title="内容平台表现（飞书脱敏聚合）" className="mb-5">
          <TableShell minWidth={900}>
            <thead><tr><th>平台</th><th>发布数</th><th>曝光/播放</th><th>阅读</th><th>30 天互动</th><th>平均点击率</th><th>互动率</th></tr></thead>
            <tbody>
              {feishu.content.platforms.map((item) => (
                <tr key={item.name}>
                  <td><PlatformBadge platform={item.name as Platform} /></td>
                  <td>{count(item.published)}</td><td>{count(item.exposure)}</td><td>{count(item.reads)}</td><td>{count(item.interactions30d)}</td>
                  <td>{percent(item.averageClickRate)}</td><td>{percent(item.interactionRate)}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Card>
      )}

      {dingtalk && (
        <Card
          title="钉钉运营数据（Sheet API 只读聚合）"
          className="mb-5"
          action={<StatusTag label={`${count(dingtalk.recordCount)} 行 · ${dingtalk.quality.sheetCount} 表`} tone="green" dot />}
        >
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            {[
              ["GMV", money(dingtalk.totals.gmv)],
              ["消耗", money(dingtalk.totals.spend)],
              ["ROI", dingtalk.totals.roi.toFixed(2)],
              ["曝光", count(dingtalk.totals.exposure)],
              ["点击率", percent(dingtalk.totals.ctr)],
              ["支付订单", count(dingtalk.totals.paidOrders)],
            ].map(([label, value]) => (
              <div className="min-w-0 border-l-2 border-[var(--border)] bg-white/[0.02] px-3 py-2" key={label}>
                <div className="text-[11px] text-[var(--muted)]">{label}</div>
                <div className="mt-1 truncate text-[15px] font-bold">{value}</div>
              </div>
            ))}
          </div>
          <div className="mb-2 mt-5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
            <b className="text-[var(--text)]">字段识别与隐私处理</b>
            <StatusTag label={dingtalk.privacy.persistedLevel} tone="blue" />
            <StatusTag label={`异常说明 ${dingtalk.quality.anomalyCount}`} tone={dingtalk.quality.anomalyCount ? "orange" : "green"} />
            <span>{dingtalk.period.start || "-"} 至 {dingtalk.period.end || "-"}</span>
            <button className="btn ml-auto" onClick={() => setShowDingTalkInventory((current) => !current)} type="button">
              {showDingTalkInventory ? "收起工作表明细" : `查看 ${dingtalk.inventory.length} 张表明细`}
            </button>
          </div>
          {showDingTalkInventory && (
            <TableShell minWidth={980}>
              <thead><tr><th>工作表</th><th>数据行</th><th>表头行</th><th>识别字段</th><th>指标字段数</th><th>缺失维度</th><th>拦截字段</th></tr></thead>
              <tbody>
                {dingtalk.inventory.map((sheet) => (
                  <tr key={sheet.name}>
                    <td className="font-semibold">{sheet.name}</td><td>{count(sheet.rowCount)}</td><td>{sheet.headerRow}</td>
                    <td className="max-w-[360px] whitespace-normal text-[var(--muted)]">{sheet.detectedFields.join("、") || "未识别"}</td><td>{sheet.detectedMetricCount}</td>
                    <td><StatusTag label={sheet.missingDimensions.join("、") || "完整"} tone={sheet.missingDimensions.length ? "orange" : "green"} /></td>
                    <td className="max-w-[260px] whitespace-normal text-[var(--muted)]">{sheet.blockedFields.join("、") || "无"}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Card>
      )}

      {warehouse && (
        <Card title="本地数仓查询与分区状态" className="mb-5" action={<StatusTag label={`${warehouse.quality.queryCount}/25 查询`} tone={warehouse.quality.failedFiles ? "orange" : "green"} dot />}>
          <TableShell minWidth={980}>
            <thead><tr><th>查询</th><th>源文件</th><th>Parquet</th><th>行数</th><th>列数</th><th>异常</th><th>状态</th></tr></thead>
            <tbody>
              {warehouse.quality.queries.map((item) => (
                <tr key={item.query}>
                  <td className="font-semibold">{item.query}</td><td>{count(item.files)}</td><td>{count(item.activePartitions)}</td>
                  <td>{count(item.rows)}</td><td>{item.columns}</td><td>{item.failed}</td>
                  <td><StatusTag label={item.failed ? "部分可用" : "已迁移"} tone={item.failed ? "orange" : "green"} dot /></td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Card>
      )}

      <div className="split-grid mb-5 items-stretch">
        <Card title={warehouse ? "近 60 日经营趋势" : "效果趋势（演示）"}>
          <div className="chart-grid h-[220px] rounded-lg border border-[var(--border)] p-3">
            <svg viewBox="0 0 700 180" width="100%" height="180" role="img" aria-label="点击率、转化率、ROI 趋势">
              <polyline points={trend.length ? linePoints(trend.map((item) => item.ctr)) : "20,66 120,60 220,52 320,58 420,48 520,54 680,46"} fill="none" stroke="var(--green)" strokeWidth="2.5" />
              <polyline points={trend.length ? linePoints(trend.map((item) => item.conversion)) : "20,116 120,110 220,102 320,108 420,100 520,94 680,96"} fill="none" stroke="var(--blue)" strokeWidth="2.5" />
              <polyline points={trend.length ? linePoints(trend.map((item) => item.roi)) : "20,138 120,124 220,130 320,116 420,120 520,114 680,116"} fill="none" stroke="var(--orange)" strokeWidth="2.5" />
            </svg>
            <div className="flex gap-4 text-[11.5px] text-[var(--muted)]">
              <span><span className="text-[var(--green)]">●</span> 点击率</span><span><span className="text-[var(--blue)]">●</span> 点击到加购率</span><span><span className="text-[var(--orange)]">●</span> ROI</span>
            </div>
          </div>
        </Card>

        <Card title="素材胜率分布（等待素材映射表）">
          <div className="flex flex-col gap-6 md:flex-row md:items-center">
            <div className="donut relative h-[150px] w-[150px] shrink-0 rounded-full">
              <div className="absolute inset-[22px] rounded-full bg-[var(--panel-solid)]" />
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center"><div className="text-xl font-bold">425</div><div className="text-[11px] text-[var(--muted)]">演示素材</div></div>
            </div>
            <div className="grid flex-1 gap-2 text-[12.5px]">
              {[["var(--pink)", "胜率 > 30%", "68 (16.0%)"], ["var(--green)", "20% ~ 30%", "112 (26.4%)"], ["var(--blue)", "10% ~ 20%", "139 (32.7%)"], ["var(--orange)", "5% ~ 10%", "71 (16.7%)"], ["var(--red)", "胜率 < 5%", "35 (8.2%)"]].map(([color, label, value]) => (
                <div className="flex items-center gap-2" key={label}><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} /><span>{label}</span><span className="ml-auto text-[var(--muted)]">{value}</span></div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="split-grid items-start">
        <Card title="素材效果 TOP10（待 material_content_id 接入）">
          <TableShell minWidth={1080}>
            <thead><tr><th>排名</th><th>素材</th><th>平台</th><th>曝光</th><th>点击率</th><th>转化率</th><th>收藏率</th><th>消耗</th><th>ROI</th><th>胜率</th><th>操作</th></tr></thead>
            <tbody>
              {materialTop10.map((item, index) => (
                <tr key={item.name}>
                  <td>{item.rank}</td><td><div className="thumb-row"><Thumbnail icon={item.thumb} index={index} /><span className="truncate font-semibold">{item.name}</span></div></td>
                  <td><PlatformBadge platform={item.platform} /></td><td>{item.impressions}</td><td>{item.ctr}</td><td>{item.conversion}</td><td>{item.favoriteRate}</td><td>{item.spend}</td><td>{item.roi}</td><td>{item.winRate}</td>
                  <td><button className="btn" onClick={() => onAction("查看素材明细", `${item.name} 当前为映射表接入前的演示数据`)} type="button">查看</button></td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Card>

        <Card title="再生成建议" action={<button className="btn" onClick={() => onAction("查看全部建议", "当前共有 6 条规则建议")} type="button">查看全部 (6)</button>}>
          <div className="grid gap-2.5">
            {regenerationSuggestions.map((suggestion, index) => {
              const created = createdIds.includes(suggestion.id);
              return (
                <div className="flex items-center gap-3 rounded-[10px] border border-[var(--border)] p-3.5" key={suggestion.id}>
                  <Thumbnail icon={suggestion.thumb} index={index} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-[13px] font-bold">{suggestion.title}</div>
                    <div className="mb-1.5 flex flex-wrap gap-1.5"><StatusTag label={suggestion.type} tone={suggestion.kind === "image_process" ? "green" : "blue"} /><StatusTag label={suggestion.product} tone="muted" /></div>
                    <div className="line-clamp-soft text-xs leading-5 text-[var(--muted)]">{suggestion.desc}</div><div className="mt-1 text-[11.5px] text-[var(--muted)]">原因：{suggestion.reason}</div><div className="mt-1.5 text-[11.5px] font-bold text-[var(--green)]">{suggestion.uplift}</div>
                  </div>
                  <button className={created ? "btn" : "btn-primary"} onClick={() => createTask(suggestion)} type="button">{created ? "已创建" : "一键再生成"}</button>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
