import { useState } from "react";
import { Card } from "../components/Card";
import { MetricCard } from "../components/MetricCard";
import { PageHeader } from "../components/PageHeader";
import { ProgressBar } from "../components/ProgressBar";
import { StatusTag } from "../components/StatusTag";
import { TableShell } from "../components/TableShell";
import { Thumbnail } from "../components/Thumbnail";
import { imageKpis, imagePipeline, imageTasks } from "../data/mock";
import type { ImageTask, TaskCreateInput, TaskStatus } from "../types";
import { taskStatusText, taskStatusTone } from "../utils/status";

interface ImageProcessingPageProps {
  onAction: (title: string, detail?: string) => void;
  onCreateTask: (task: TaskCreateInput) => void;
}

export function ImageProcessingPage({ onAction, onCreateTask }: ImageProcessingPageProps) {
  const [tasks, setTasks] = useState<ImageTask[]>(imageTasks);

  function markFirstWaiting(status: TaskStatus, title: string, batch = "IMG-20260707-A") {
    setTasks((current) => {
      const waitingIndex = current.findIndex((task) => task.status === "waiting" || task.status === "failed");
      if (waitingIndex < 0) return current;
      return current.map((task, index) => (index === waitingIndex ? { ...task, status, updatedAt: "2026-07-07 11:30" } : task));
    });
    onAction(title, `图片任务已模拟更新为：${taskStatusText[status]}`);
    onCreateTask({
      name: title,
      type: title.includes("导出") ? "export_package" : "image_process",
      module: "图片处理",
      batch,
      status: "pending",
      inputFiles: ["E:/素材/电商素材", "图片处理规则.json"],
      timeline: ["11:30 从图片处理页创建任务", "11:30 等待本地图片脚本执行"],
    });
  }

  return (
    <div>
      <PageHeader
        title="图片处理工坊"
        subtitle="批量完成抠图、尺寸适配、活动角标与合规检查，集中处理需人工确认的图片。"
        actions={
          <>
            <button className="btn-select" type="button">IMG-20260707-A ▾</button>
            <button className="btn-primary" onClick={() => markFirstWaiting("running", "批量上传图片素材", "IMG-UPLOAD-20260707")} type="button">批量上传</button>
          </>
        }
      />

      <div className="metric-grid mb-5">
        {imageKpis.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
      </div>

      <div className="module-grid mb-5">
        {imagePipeline.map((step, index) => (
          <Card key={step.id}>
            <div className="mb-2 flex items-center justify-between">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-xs font-bold text-[var(--muted)]">{index + 1}</span>
              <StatusTag label={step.status} tone={step.tone} />
            </div>
            <div className="mb-1 text-[13.5px] font-bold">{step.title}</div>
            <div className="min-h-10 text-xs leading-5 text-[var(--muted)]">{step.desc}</div>
            <ProgressBar value={step.progress} tone={step.tone} />
            <div className="mt-2.5 text-[11.5px] text-[var(--muted)]">{step.meta}</div>
          </Card>
        ))}
      </div>

      <Card
        title="图片任务列表"
        action={
          <div className="flex flex-wrap gap-2">
            {[
              ["批量抠图", "IMG-CUTOUT-20260707"],
              ["改尺寸", "IMG-RESIZE-20260707"],
              ["加活动角标", "IMG-BADGE-20260707"],
              ["换背景", "IMG-BG-20260707"],
              ["合规检测", "IMG-COMPLIANCE-20260707"],
              ["导出图片包", "EXPORT-IMG-20260707"],
            ].map(([label, detail]) => (
              <button className="btn" key={label} onClick={() => markFirstWaiting("running", label, detail)} type="button">{label}</button>
            ))}
          </div>
        }
      >
        <TableShell minWidth={1320}>
          <thead>
            <tr>
              <th>缩略图</th>
              <th>商品名</th>
              <th>SKU</th>
              <th>处理类型</th>
              <th>尺寸规则</th>
              <th>处理状态</th>
              <th>处理前预览</th>
              <th>处理后预览</th>
              <th>失败原因</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task, index) => (
              <tr key={task.id}>
                <td><Thumbnail icon={task.thumb} index={index} /></td>
                <td className="font-semibold">{task.productName}</td>
                <td>{task.sku}</td>
                <td>{task.processType}</td>
                <td>{task.sizeRule}</td>
                <td><StatusTag label={taskStatusText[task.status]} tone={taskStatusTone[task.status]} /></td>
                <td>{task.beforePreview}</td>
                <td>{task.afterPreview}</td>
                <td className={task.failReason === "-" ? "text-[var(--muted)]" : "text-[var(--red)]"}>{task.failReason}</td>
                <td>{task.updatedAt}</td>
                <td>
                  <div className="flex gap-2">
                    <button className="btn" onClick={() => onAction("预览图片", `${task.productName} 的处理前后对比已打开`)} type="button">预览</button>
                    <button className="btn" onClick={() => markFirstWaiting("retrying", `${task.productName} 失败重试`, `RETRY-${task.sku}`)} type="button">重试</button>
                    <button className="btn" onClick={() => markFirstWaiting("success", `${task.productName} 人工确认`, `CONFIRM-${task.sku}`)} type="button">确认</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Card>
    </div>
  );
}
