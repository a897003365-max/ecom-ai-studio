import { useEffect, useState } from "react";
import { AnalyticsDateFilter } from "../components/AnalyticsDateFilter";
import { PageHeader } from "../components/PageHeader";
import { CustomerServiceWorkspace } from "../components/PowerBiReplica";
import { getAnalyticsData, syncAnalyticsData } from "../services/localApi";
import type { AnalyticsIntegrationPayload } from "../types/integration";

// 客服数据独立页：从运营数据看板的 service 工作区迁出（2026-09-19）。
// 与运营看板共用 /api/analytics 载荷与全局日期控件；客服明细固定读本地数仓快照
//（按需重算接口不含客服模块），筛选区间与快照窗口的交集由 servicePeriodRange 计算。
interface CustomerServicePageProps {
  onAction: (title: string, detail?: string) => void;
  canManage: boolean;
}

function dateTime(value?: string | null) {
  if (!value) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value)).replaceAll("/", "-");
}

export function CustomerServicePage({ onAction, canManage }: CustomerServicePageProps) {
  const [integration, setIntegration] = useState<AnalyticsIntegrationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  async function loadWarehouse(period?: { start: string; end: string }) {
    setLoading(true);
    setError("");
    try {
      setIntegration(await getAnalyticsData(period));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "客服数据读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWarehouse();
  }, []);

  const warehouse = integration?.warehouse ?? null;
  const dingtalk = integration?.dingtalk ?? null;
  const reporting = dingtalk?.reporting;
  const globalPeriod = dingtalk?.period.start && dingtalk.period.end
    ? { start: dingtalk.period.start, end: dingtalk.period.end }
    : null;

  async function syncWarehouse() {
    if (!canManage) {
      onAction("当前账号无同步权限", "请联系管理员开通“同步运营数据”权限");
      return;
    }
    setSyncing(true);
    onAction("开始同步", "正在同步钉钉经营数据与本地数仓（含客服数据）");
    try {
      const syncResult = await syncAnalyticsData();
      await loadWarehouse();
      if (syncResult.status === "partial") {
        onAction("同步完成（部分）", `已更新 ${syncResult.runs.map((item) => item.sourceId === "dingtalk" ? "钉钉" : "本地数仓").join("、")}；${syncResult.failures.map((item) => `${item.sourceId === "dingtalk" ? "钉钉" : "本地数仓"}：${item.detail}`).join("；")}`);
      } else if (syncResult.status === "failed") {
        onAction("同步失败", syncResult.failures.map((item) => item.detail).join("；") || "钉钉与本地数仓均未更新");
      } else {
        onAction("同步完成", "钉钉与本地数仓均已更新，客服数据已纳入");
      }
    } catch (syncError) {
      onAction("同步失败", syncError instanceof Error ? syncError.message : "钉钉或本地数仓不可用");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="客服数据"
        subtitle={`天猫 / 京东 / 抖音每日客服表现 · 本地数仓最近同步 ${dateTime(warehouse?.refreshedAt)}`}
        actions={
          <>
            <button className="btn" disabled={syncing || !canManage} onClick={() => void syncWarehouse()} title={canManage ? "同步钉钉经营数据与本地数仓" : "当前账号仅可查看，不能同步数据"} type="button">
              {syncing ? "同步中..." : "同步数据"}
            </button>
            {dingtalk && reporting && (
              <AnalyticsDateFilter
                available={reporting.availablePeriod}
                completedThrough={reporting.completedThrough}
                loading={loading}
                onApply={loadWarehouse}
                period={globalPeriod ?? { start: reporting.availablePeriod.start, end: reporting.completedThrough }}
              />
            )}
          </>
        }
      />

      {error && <div className="mb-4 rounded-md border border-[var(--red)]/40 bg-[var(--red-bg)] px-3 py-2 text-xs text-[var(--red)]">{error}</div>}

      {loading && !warehouse ? (
        <div aria-busy="true" className="flex items-center gap-2 px-1 py-10 text-xs text-[var(--muted)]">
          <span className="auth-loading-mark" style={{ width: 14, height: 14, borderWidth: 2, borderTopColor: "var(--brand)" }} />
          <span>正在加载客服数据…</span>
        </div>
      ) : warehouse?.powerbiPages ? (
        <CustomerServiceWorkspace globalPeriod={globalPeriod} pages={warehouse.powerbiPages} />
      ) : (
        <div className="pb-empty">正在等待 PowerBI 本地数仓快照…</div>
      )}
    </div>
  );
}
