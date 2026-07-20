import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { BarChart3, Clapperboard, Image, Plus, RefreshCw, Trophy } from "lucide-react";
import { Card } from "../components/Card";
import { MetricCard } from "../components/MetricCard";
import { PageHeader } from "../components/PageHeader";
import { ProgressBar } from "../components/ProgressBar";
import { StatusTag } from "../components/StatusTag";
import { TableShell } from "../components/TableShell";
import { agentResponsibilities } from "../data/mock";
import { getDataSources } from "../services/localApi";
import type { KpiMetric, PageId, QueueTask, TaskType, ToastMessage, Tone } from "../types";
import type { ConnectionStatus, DataSourcesPayload } from "../types/integration";
import { taskStatusText, taskStatusTone, taskTypeText } from "../utils/status";

const businessLineIcons: Record<string, ReactNode> = {
  content: <Clapperboard size={20} />,
  images: <Image size={20} />,
  analytics: <BarChart3 size={20} />,
  intelligence: <Trophy size={20} />,
};

const businessLineDefinitions: Array<{
  id: Extract<PageId, "content" | "images" | "analytics" | "intelligence">;
  title: string;
  desc: string;
  taskTypes: TaskType[];
}> = [
  { id: "content", title: "内容生产", desc: "文案、分镜与质检任务", taskTypes: ["content_generate", "script_generate", "quality_check", "export_package"] },
  { id: "images", title: "图片处理", desc: "图片处理与结果导出任务", taskTypes: ["image_process"] },
  { id: "analytics", title: "运营数据", desc: "本地数仓与经营数据同步任务", taskTypes: ["data_sync"] },
  { id: "intelligence", title: "竞品情报", desc: "竞品与榜单采集分析任务", taskTypes: ["competitor_crawl", "top100_crawl"] },
];

interface DashboardPageProps {
  onNavigate: (id: PageId) => void;
  onAction: (title: string, detail?: string, tone?: ToastMessage["tone"]) => void;
  tasks: QueueTask[];
  canCreateTasks: boolean;
}

export function DashboardPage({ onNavigate, onAction, tasks, canCreateTasks }: DashboardPageProps) {
  const [sourcePayload, setSourcePayload] = useState<DataSourcesPayload | null>(null);
  const recentTasks = tasks.slice(0, 5);
  const abnormalTasks = tasks.filter((task) => task.status === "failed" || task.waitingConfirmCount > 0).slice(0, 4);
  const abnormalCount = tasks.filter((task) => task.status === "failed" || task.waitingConfirmCount > 0).length;
  const runningCount = tasks.filter((task) => task.status === "running" || task.status === "retrying").length;
  const waitingCount = tasks.filter((task) => task.status === "waiting" || task.status === "pending").length;

  function refreshSources(showFeedback = false) {
    getDataSources()
      .then((payload) => {
        setSourcePayload(payload);
        if (showFeedback) onAction("刷新完成", "已重新读取本机数据源和工作流状态");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "本地服务不可用";
        onAction("数据源加载失败", message, "red");
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

  function sourceSummary(item: DataSourcesPayload["sources"][number]) {
    const records = item.records.toLocaleString("zh-CN");
    if (item.id === "warehouse") return `${records} 行经营数据`;
    if (item.id === "workflow") return `${records} 个生产 Agent 可用`;
    return `${records} 条汇总记录${item.lastSync ? " · 已更新" : ""}`;
  }

  const heroMetrics: KpiMetric[] = [
    { label: "任务总数", value: String(tasks.length), detail: "本地任务队列", tone: "blue" },
    { label: "执行中", value: String(runningCount), detail: "运行或重试中的任务", tone: "green" },
    { label: "等待处理", value: String(waitingCount), detail: "待执行或等待本地 Worker", tone: "orange" },
    { label: "异常 / 待确认", value: String(abnormalCount), detail: "需要人工关注", tone: abnormalCount ? "red" : "green" },
  ];

  const businessLines = useMemo(() => businessLineDefinitions.map((definition) => {
    const lineTasks = tasks.filter((task) => definition.taskTypes.includes(task.type));
    const attention = lineTasks.filter((task) => task.status === "failed" || task.waitingConfirmCount > 0).length;
    const active = lineTasks.filter((task) => task.status === "running" || task.status === "retrying").length;
    const progress = lineTasks.length
      ? Math.round(lineTasks.reduce((sum, task) => sum + task.progress, 0) / lineTasks.length)
      : 0;
    const tone: Tone = attention ? "red" : active ? "blue" : lineTasks.length ? "green" : "muted";
    return { ...definition, active, attention, progress, taskCount: lineTasks.length, tone };
  }), [tasks]);

  const connectedSources = sourcePayload?.sources.filter((source) => ["connected", "ready", "cached"].includes(source.status)).length ?? 0;
  const liveSystemStatus: Array<{ label: string; value: string; tone: Tone }> = sourcePayload
    ? sourcePayload.sources.map((source) => ({ label: source.name, value: source.statusLabel, tone: sourceTone(source.status) }))
    : [{ label: "本机数据源", value: "状态未获取", tone: "orange" }];

  return (
    <div className="animate-fade-in-up">
      <PageHeader
        title="工作台首页"
        subtitle="汇总本地任务、异常与待确认项，帮助运营快速判断下一步动作。"
        actions={
          <>
            <button className="btn" onClick={() => refreshSources(true)} type="button">
              <RefreshCw size={14} /> 刷新
            </button>
            <button className="btn-primary" disabled={!canCreateTasks} onClick={() => onNavigate("content")} title={canCreateTasks ? "前往内容生产创建新的任务批次" : "当前账号没有任务执行权限"} type="button">
              <Plus size={14} /> 新建批次
            </button>
          </>
        }
      />

      <section className="card card-strong mb-5 overflow-hidden">
        <div className="relative">
          <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[var(--brand)] opacity-[0.06] blur-3xl" />
          <div className="relative grid gap-5 lg:grid-cols-[1fr_auto]">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--glass-border-strong)] bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand)]">
                <span className={`timeline-dot ${sourcePayload ? "dot-green" : "dot-orange"} !m-0`} />
                {sourcePayload ? `已读取 ${connectedSources}/${sourcePayload.sources.length} 个本机数据源` : "正在读取本机数据源"}
              </div>
              <h2 className="font-display text-[22px] font-bold tracking-[-0.02em]">当前任务概览</h2>
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[var(--muted)]">
                {abnormalCount > 0
                  ? `当前有 ${abnormalCount} 个任务需要人工关注，建议优先处理异常与待确认项。`
                  : tasks.length ? "当前没有异常任务，任务状态来自本地任务队列。" : "暂无已同步任务；可从业务模块创建任务，或刷新检查本机服务。"}
              </p>
            </div>
            <div className="flex items-end gap-3">
              <button className="btn h-9" onClick={() => onNavigate("tasks")} type="button">查看任务队列</button>
            </div>
          </div>

          <div className="relative mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {heroMetrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
          </div>
        </div>
      </section>

      <section className="mb-5">
        <div className="section-title"><span>业务主线</span></div>
        <div className="grid gap-4 xl:grid-cols-4">
          {businessLines.map((item, index) => (
            <button
              className={`card card-hover group relative overflow-hidden text-left animate-scale-in stagger-${index + 1}`}
              key={item.id}
              onClick={() => onNavigate(item.id)}
              type="button"
            >
              {item.attention > 0 && (
                <span className="absolute right-3 top-3 flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--red)] opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--red)]" /></span>
              )}
              <div className="mb-3 flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--glass-border-strong)] bg-white/[0.04] text-[var(--brand)]">{businessLineIcons[item.id]}</span>
                <StatusTag label={`${item.taskCount} 个任务`} tone={item.tone} />
              </div>
              <div className="mb-1 text-[15px] font-bold">{item.title}</div>
              <div className="line-clamp-soft min-h-9 text-xs leading-5 text-[var(--muted)]">{item.desc}</div>
              <ProgressBar value={item.progress} tone={item.tone} striped={item.active > 0} />
              <div className="mt-3 flex items-center justify-between text-[11.5px]">
                <span className="text-[var(--muted-2)]">{item.attention ? `${item.attention} 项需关注` : item.active ? `${item.active} 项执行中` : item.taskCount ? "暂无异常" : "暂无已同步任务"}</span>
                <span className="text-[var(--brand)] transition-transform group-hover:translate-x-0.5">进入 →</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card title="近期任务队列" action={<button className="btn" onClick={() => onNavigate("tasks")} type="button">进入任务队列</button>}>
          <TableShell minWidth={820}>
            <thead><tr><th>任务名称</th><th>类型</th><th>模块</th><th>状态</th><th>进度</th><th>更新时间</th></tr></thead>
            <tbody>
              {recentTasks.length === 0 && <tr><td className="py-8 text-center text-[var(--muted)]" colSpan={6}>暂无已同步任务</td></tr>}
              {recentTasks.map((task) => (
                <tr key={task.id}>
                  <td className="font-semibold">{task.name}</td><td>{taskTypeText[task.type]}</td><td>{task.module}</td>
                  <td><StatusTag label={taskStatusText[task.status]} pulse={task.status === "running" || task.status === "retrying"} tone={taskStatusTone[task.status]} /></td>
                  <td><div className="w-28"><ProgressBar striped={task.status === "running" || task.status === "retrying"} tone={taskStatusTone[task.status]} value={task.progress} /></div></td>
                  <td>{task.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Card>

        <Card title="异常与人工确认">
          <div className="grid gap-2.5">
            {abnormalTasks.length === 0 && <div className="rounded-lg border border-dashed border-[var(--glass-border)] bg-white/[0.02] p-6 text-center text-[13px] text-[var(--muted)]">暂无异常任务</div>}
            {abnormalTasks.map((task) => (
              <button className="card card-hover rounded-[var(--radius-md)] p-3 text-left" key={task.id} onClick={() => onNavigate("tasks")} type="button">
                <div className="mb-1.5 flex items-center justify-between gap-2"><span className="truncate text-[13px] font-bold">{task.name}</span><StatusTag label={taskStatusText[task.status]} pulse={task.status === "retrying"} tone={taskStatusTone[task.status]} /></div>
                <div className="text-xs leading-5 text-[var(--muted)]">失败 {task.failedCount} · 待确认 {task.waitingConfirmCount} · {task.failureReason}</div>
              </button>
            ))}
          </div>
        </Card>
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card title="数据来源状态">
          <div className="grid gap-2">
            {!sourcePayload && <div className="rounded-lg border border-dashed border-[var(--glass-border)] bg-white/[0.02] p-6 text-center text-[13px] text-[var(--muted)]">数据源状态暂未读取，点击“刷新”重试。</div>}
            {sourcePayload?.sources.map((item) => (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--glass-border)] bg-white/[0.02] px-3 py-2.5" key={item.name}>
                <div className="min-w-0"><div className="text-[13px] font-bold">{item.name}</div><div className="mt-1 truncate text-xs text-[var(--muted)]">{sourceSummary(item)}</div></div>
                <StatusTag label={item.statusLabel} tone={sourceTone(item.status)} />
              </div>
            ))}
          </div>
        </Card>

        <Card title="AI / 人工分工">
          <div className="grid gap-2">
            {agentResponsibilities.map((item) => (
              <div className="rounded-lg border border-[var(--glass-border)] bg-white/[0.02] p-3" key={item.businessLine}>
                <div className="mb-2 flex items-center justify-between"><span className="font-bold">{item.businessLine}</span><StatusTag label="AI + 人工" tone="blue" /></div>
                <div className="grid gap-2 text-xs leading-5 text-[var(--muted)] md:grid-cols-2"><div><b className="text-[var(--brand)]">AI/Agent：</b>{item.ai[0]}</div><div><b className="text-[var(--orange)]">人工：</b>{item.human[0]}</div></div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[12.5px] text-[var(--muted)]">
          <div className="flex items-center gap-2 font-semibold text-[var(--text)]"><span className="timeline-dot dot-green !m-0" />本机状态</div>
          {liveSystemStatus.map((item) => <div className="flex items-center gap-2" key={item.label}><span className={`timeline-dot dot-${item.tone === "orange" || item.tone === "red" ? item.tone : "green"} !m-0`} /><span>{item.label}：<b className="text-[var(--text)]">{item.value}</b></span></div>)}
        </div>
      </Card>
    </div>
  );
}
