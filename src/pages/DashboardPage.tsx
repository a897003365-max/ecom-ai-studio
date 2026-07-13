import { useEffect, useState } from "react";
import { Card } from "../components/Card";
import { MetricCard } from "../components/MetricCard";
import { PageHeader } from "../components/PageHeader";
import { ProgressBar } from "../components/ProgressBar";
import { StatusTag } from "../components/StatusTag";
import { TableShell } from "../components/TableShell";
import {
  agentResponsibilities,
  dashboardBusinessLines,
  dashboardKpis,
  dataSourceStatuses,
  systemStatus,
} from "../data/mock";
import { getDataSources } from "../services/localApi";
import type { PageId, QueueTask, Tone } from "../types";
import type { ConnectionStatus, DataSourcesPayload } from "../types/integration";
import { taskStatusText, taskStatusTone, taskTypeText } from "../utils/status";

interface DashboardPageProps {
  onNavigate: (id: PageId) => void;
  onAction: (title: string, detail?: string) => void;
  tasks: QueueTask[];
}

export function DashboardPage({ onNavigate, onAction, tasks }: DashboardPageProps) {
  const [sourcePayload, setSourcePayload] = useState<DataSourcesPayload | null>(null);
  const recentTasks = tasks.slice(0, 5);
  const abnormalTasks = tasks.filter((task) => task.status === "failed" || task.waitingConfirmCount > 0).slice(0, 4);

  function refreshSources(showFeedback = false) {
    getDataSources()
      .then((payload) => {
        setSourcePayload(payload);
        if (showFeedback) onAction("刷新完成", "已重新读取本机数据源和工作流状态");
      })
      .catch((error: unknown) => {
        if (showFeedback) onAction("刷新失败", error instanceof Error ? error.message : "本地服务不可用");
      });
  }

  useEffect(() => {
    refreshSources();
  }, []);

  function sourceTone(status: ConnectionStatus): Tone {
    if (status === "connected" || status === "ready") return "green";
    if (status === "cached") return "blue";
    if (status === "auth_required") return "orange";
    return "red";
  }

  const liveSystemStatus = systemStatus.map((item) => {
    if (item.label === "飞书表格同步") {
      const source = sourcePayload?.sources.find((candidate) => candidate.id === "feishu");
      return source ? { ...item, value: source.statusLabel, tone: sourceTone(source.status) } : item;
    }
    if (item.label === "本地数据目录") return { ...item, value: "E:/Github/ecom-ai-studio/local-data" };
    if (item.label === "本地服务") return { ...item, value: window.location.origin };
    return item;
  });

  return (
    <div>
      <PageHeader
        title="工作台首页"
        subtitle="统一管理电商 AI 批量生产任务：商品数据进来，文案/分镜/图片/竞品/运营复盘在一个任务队列里流转，人工只处理确认和策略判断。"
        actions={
          <>
            <button className="btn" onClick={() => refreshSources(true)} type="button">
              🔄 刷新
            </button>
            <button className="btn-primary" onClick={() => onAction("新建批次", "已创建 mock 批次 DRAFT-20260707")} type="button">
              + 新建批次
            </button>
          </>
        }
      />

      <div className="metric-grid mb-6">
        {dashboardKpis.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </div>

      <div className="section-title">4 条业务主线</div>
      <div className="grid gap-4 xl:grid-cols-4">
        {dashboardBusinessLines.map((item) => (
          <button className="card card-hover text-left" key={item.title} onClick={() => onNavigate(item.id)} type="button">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xl">{item.icon}</span>
              <StatusTag label={`${item.progress}%`} tone={item.tone} />
            </div>
            <div className="mb-1 text-[14px] font-bold">{item.title}</div>
            <div className="line-clamp-soft min-h-10 text-xs leading-5 text-[var(--muted)]">{item.desc}</div>
            <ProgressBar value={item.progress} tone={item.tone} />
            <div className="mt-3 grid gap-2 text-[11.5px] text-[var(--muted)]">
              <div className="flex justify-between gap-3"><span>今日产出</span><b className="text-[var(--text)]">{item.outputToday}</b></div>
              <div className="flex justify-between gap-3"><span>异常数量</span><b className={item.exceptionCount > 0 ? "text-[var(--red)]" : "text-[var(--green)]"}>{item.exceptionCount}</b></div>
              <div className="flex justify-between gap-3"><span>下一步</span><b className="text-[var(--brand)]">{item.nextAction}</b></div>
            </div>
            <div className="mt-3 flex justify-end text-[11.5px] text-[var(--muted)]">
              <span className="text-[var(--brand)]">进入 →</span>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.35fr_0.9fr]">
        <Card title="近期任务队列" action={<button className="btn" onClick={() => onNavigate("tasks")} type="button">进入任务队列</button>}>
          <TableShell minWidth={820}>
            <thead>
              <tr>
                <th>任务名称</th>
                <th>类型</th>
                <th>模块</th>
                <th>状态</th>
                <th>进度</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {recentTasks.map((task) => (
                <tr key={task.id}>
                  <td className="font-semibold">{task.name}</td>
                  <td>{taskTypeText[task.type]}</td>
                  <td>{task.module}</td>
                  <td><StatusTag label={taskStatusText[task.status]} tone={taskStatusTone[task.status]} /></td>
                  <td><div className="w-28"><ProgressBar value={task.progress} tone={taskStatusTone[task.status]} /></div></td>
                  <td>{task.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Card>

        <Card title="异常与人工确认">
          <div className="grid gap-2.5">
            {abnormalTasks.map((task) => (
              <button className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3 text-left" key={task.id} onClick={() => onNavigate("tasks")} type="button">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-bold">{task.name}</span>
                  <StatusTag label={taskStatusText[task.status]} tone={taskStatusTone[task.status]} />
                </div>
                <div className="text-xs leading-5 text-[var(--muted)]">
                  失败 {task.failedCount} · 待确认 {task.waitingConfirmCount} · {task.failureReason}
                </div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card title="数据来源状态">
          <div className="grid gap-2">
            {(sourcePayload?.sources ?? dataSourceStatuses).map((item) => (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-white/[0.02] px-3 py-2.5" key={item.name}>
                <div>
                  <div className="text-[13px] font-bold">{item.name}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">{"detail" in item ? item.detail : item.value}</div>
                </div>
                <StatusTag label={"statusLabel" in item ? item.statusLabel : item.status} tone={"statusLabel" in item ? sourceTone(item.status) : item.tone} />
              </div>
            ))}
          </div>
        </Card>

        <Card title="AI / 人工分工">
          <div className="grid gap-2">
            {agentResponsibilities.map((item) => (
              <div className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3" key={item.businessLine}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-bold">{item.businessLine}</span>
                  <StatusTag label="AI + 人工" tone="blue" />
                </div>
                <div className="grid gap-2 text-xs leading-5 text-[var(--muted)] md:grid-cols-2">
                  <div><b className="text-[var(--brand)]">AI/Agent：</b>{item.ai[0]}</div>
                  <div><b className="text-[var(--orange)]">人工：</b>{item.human[0]}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[12.5px] text-[var(--muted)]">
          {liveSystemStatus.map((item) => (
            <div className="flex items-center gap-2" key={item.label}>
              <span className={`timeline-dot dot-${item.tone === "orange" || item.tone === "red" ? item.tone : "green"} !m-0`} />
              <span>
                {item.label}：<b className="text-[var(--text)]">{item.value}</b>
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
