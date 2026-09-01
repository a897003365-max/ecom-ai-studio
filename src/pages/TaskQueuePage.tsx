import { useMemo, useState } from "react";
import { Card } from "../components/Card";
import { PageHeader } from "../components/PageHeader";
import { ProgressBar } from "../components/ProgressBar";
import { StatusTag } from "../components/StatusTag";
import { TableShell } from "../components/TableShell";
import type { QueueTask } from "../types";
import { taskStatusText, taskStatusTone, taskTypeText } from "../utils/status";

interface TaskQueuePageProps {
  tasks: QueueTask[];
  onAction: (title: string, detail?: string) => void;
  onTaskAction: (taskId: string, action: "retry" | "confirm" | "cancel" | "export") => void;
}

export function TaskQueuePage({ tasks, onAction, onTaskAction }: TaskQueuePageProps) {
  const [selectedId, setSelectedId] = useState(tasks[0]?.id ?? "");
  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedId) ?? tasks[0], [tasks, selectedId]);

  return (
    <div>
      <PageHeader
        title="任务队列"
        subtitle="集中查看任务进度、异常、产物与人工确认状态。"
        actions={
          <>
            <button className="btn-select" type="button">全部状态 ▾</button>
            <button className="btn-select" type="button">全部模块 ▾</button>
            <button className="btn-primary" onClick={() => onAction("刷新任务队列", "任务进度与异常状态已更新")} type="button">刷新队列</button>
          </>
        }
      />

      <div className="split-grid items-start">
        <Card title="任务列表">
          <TableShell minWidth={1280}>
            <thead>
              <tr>
                <th>任务名称</th>
                <th>类型</th>
                <th>业务模块</th>
                <th>批次</th>
                <th>状态</th>
                <th>进度</th>
                <th>成功数</th>
                <th>失败数</th>
                <th>待确认数</th>
                <th>开始时间</th>
                <th>更新时间</th>
                <th>日志入口</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>
                    <button className="text-left font-semibold text-[var(--text)] hover:text-[var(--brand)]" onClick={() => setSelectedId(task.id)} type="button">
                      {task.name}
                    </button>
                  </td>
                  <td>{taskTypeText[task.type]}</td>
                  <td>{task.module}</td>
                  <td>{task.batch}</td>
                  <td><StatusTag label={taskStatusText[task.status]} tone={taskStatusTone[task.status]} /></td>
                  <td>
                    <div className="w-32">
                      <span className="text-xs">{task.progress}%</span>
                      <ProgressBar value={task.progress} tone={taskStatusTone[task.status]} />
                    </div>
                  </td>
                  <td>{task.successCount}</td>
                  <td className={task.failedCount > 0 ? "text-[var(--red)]" : ""}>{task.failedCount}</td>
                  <td className={task.waitingConfirmCount > 0 ? "text-[var(--orange)]" : ""}>{task.waitingConfirmCount}</td>
                  <td>{task.startedAt}</td>
                  <td>{task.updatedAt}</td>
                  <td>
                    <button className="btn" onClick={() => onAction("打开日志", task.logEntry)} type="button">日志</button>
                  </td>
                  <td>
                    <div className="flex gap-2">
                      <button className="btn" onClick={() => onTaskAction(task.id, "retry")} type="button">重试</button>
                      <button className="btn" onClick={() => onAction("查看产物", task.outputFiles.join(" / ") || "暂无输出文件")} type="button">产物</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Card>

        <Card title="任务详情">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <div className="text-[15px] font-bold">{selectedTask.name}</div>
              <div className="mt-1 text-xs text-[var(--muted)]">{selectedTask.batch} · {taskTypeText[selectedTask.type]}</div>
            </div>
            <StatusTag label={taskStatusText[selectedTask.status]} tone={taskStatusTone[selectedTask.status]} />
          </div>

          <ProgressBar value={selectedTask.progress} tone={taskStatusTone[selectedTask.status]} label="当前进度" />

          <div className="mt-5 grid gap-4">
            <section>
              <div className="mb-2 text-[13px] font-bold">运行时间线</div>
              <div className="grid gap-0 rounded-lg border border-[var(--border)]">
                {selectedTask.timeline.map((item) => (
                  <div className="flex gap-2 border-b border-[var(--border)] px-3 py-2.5 text-[12.5px] last:border-b-0" key={item}>
                    <span className="timeline-dot dot-blue" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 text-[13px] font-bold">输入文件</div>
              <div className="grid gap-2">
                {selectedTask.inputFiles.length ? selectedTask.inputFiles.map((file) => <div className="rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-[var(--muted)]" key={file}>{file}</div>) : <div className="text-xs text-[var(--muted)]">暂无输入文件</div>}
              </div>
            </section>

            <section>
              <div className="mb-2 text-[13px] font-bold">输出文件</div>
              <div className="grid gap-2">
                {selectedTask.outputFiles.length ? selectedTask.outputFiles.map((file) => <div className="rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-[var(--muted)]" key={file}>{file}</div>) : <div className="text-xs text-[var(--muted)]">暂无输出文件</div>}
              </div>
            </section>

            <section>
              <div className="mb-2 text-[13px] font-bold">失败原因</div>
              <div className={selectedTask.failureReason === "-" ? "text-xs text-[var(--muted)]" : "rounded-lg border border-[var(--red-bg)] bg-[var(--red-bg)] px-3 py-2 text-xs text-[var(--red)]"}>
                {selectedTask.failureReason}
              </div>
            </section>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button className="btn" onClick={() => onAction("打开日志", selectedTask.logEntry)} type="button">日志入口</button>
            <button className="btn" onClick={() => onAction("查看产物", selectedTask.outputFiles.join(" / ") || "暂无输出文件")} type="button">查看产物</button>
            <button className="btn" onClick={() => onTaskAction(selectedTask.id, "retry")} type="button">失败重试</button>
            <button className="btn" onClick={() => onTaskAction(selectedTask.id, "confirm")} type="button">人工确认</button>
            <button className="btn" onClick={() => onTaskAction(selectedTask.id, "cancel")} type="button">取消任务</button>
            <button className="btn-primary" onClick={() => onTaskAction(selectedTask.id, "export")} type="button">导出结果</button>
          </div>
        </Card>
      </div>
    </div>
  );
}
