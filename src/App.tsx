import { useEffect, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { NavIcon } from "./components/NavIcon";
import { ToastStack } from "./components/ToastStack";
import { Topbar } from "./components/Topbar";
import { navItems, queueTasks } from "./data/mock";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { ContentProductionPage } from "./pages/ContentProductionPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ImageProcessingPage } from "./pages/ImageProcessingPage";
import { IntelligencePage } from "./pages/IntelligencePage";
import { ProductAssetsPage } from "./pages/ProductAssetsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TaskQueuePage } from "./pages/TaskQueuePage";
import { getPersistedTasks, persistTask, persistTaskAction } from "./services/localApi";
import type { PageId, QueueTask, RegenerationSuggestion, TaskCreateInput, ToastMessage } from "./types";
import { createId, nowStamp } from "./utils/format";
import { clsx } from "./utils/format";

export default function App() {
  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [tasks, setTasks] = useState<QueueTask[]>(queueTasks);
  const toastSeed = useRef(0);

  useEffect(() => {
    getPersistedTasks()
      .then(({ tasks: persisted }) => {
        if (!persisted.length) return;
        setTasks((current) => [
          ...persisted,
          ...current.filter((task) => !persisted.some((stored) => stored.id === task.id)),
        ]);
      })
      .catch(() => {
        // The UI remains usable in frontend-only fallback mode.
      });
  }, []);

  function showToast(title: string, detail?: string, tone: ToastMessage["tone"] = "green") {
    toastSeed.current += 1;
    const id = toastSeed.current;
    setToasts((current) => [{ id, title, detail, tone }, ...current].slice(0, 3));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 2800);
  }

  function handleNavigate(page: PageId) {
    setActivePage(page);
  }

  function createTask(input: TaskCreateInput) {
    const stamp = nowStamp();
    const newTask: QueueTask = {
      id: createId("task"),
      name: input.name,
      type: input.type,
      module: input.module,
      batch: input.batch,
      progress: input.progress ?? 0,
      successCount: input.successCount ?? 0,
      failedCount: input.failedCount ?? 0,
      waitingConfirmCount: input.waitingConfirmCount ?? 0,
      status: input.status ?? "pending",
      startedAt: stamp,
      updatedAt: stamp,
      logEntry: `logs/${input.type}/${input.batch}.log`,
      timeline: input.timeline ?? [`${stamp.slice(11)} 创建任务`, `${stamp.slice(11)} 等待执行`],
      inputFiles: input.inputFiles ?? [],
      outputFiles: input.outputFiles ?? [],
      failureReason: input.failureReason ?? "-",
    };
    setTasks((current) => [newTask, ...current]);
    void persistTask(newTask)
      .then(({ workflow }) => {
        showToast(
          "已写入本地任务队列",
          workflow ? `${input.name} 已进入 Claude Code 工作流入口` : `${input.name} 已保存到本地历史`,
          "blue",
        );
      })
      .catch((error: unknown) => {
        showToast("已创建前端任务", error instanceof Error ? `本地服务未保存：${error.message}` : "本地服务未保存", "orange");
      });
  }

  function createTaskFromSuggestion(suggestion: RegenerationSuggestion) {
    createTask({
      name: suggestion.title,
      type: suggestion.kind,
      module: suggestion.kind === "content_generate" ? "内容生产" : "图片处理",
      batch: `${suggestion.kind === "content_generate" ? "COPY" : "IMG"}-20260707-REGEN`,
      inputFiles: [suggestion.target, suggestion.product],
      timeline: [`${nowStamp().slice(11)} 由运营数据建议创建`, `${nowStamp().slice(11)} 等待执行`],
    });
  }

  function handleTaskAction(taskId: string, action: "retry" | "confirm" | "cancel" | "export") {
    const stamp = nowStamp();
    setTasks((current) =>
      current.map((task) => {
        if (task.id !== taskId) return task;
        if (action === "retry") {
          return {
            ...task,
            status: "retrying",
            progress: Math.max(task.progress, 12),
            updatedAt: stamp,
            timeline: [...task.timeline, `${stamp.slice(11)} 人工触发失败重试`],
          };
        }
        if (action === "confirm") {
          return {
            ...task,
            status: "success",
            progress: 100,
            waitingConfirmCount: 0,
            updatedAt: stamp,
            timeline: [...task.timeline, `${stamp.slice(11)} 人工确认完成`],
          };
        }
        if (action === "cancel") {
          return {
            ...task,
            status: "cancelled",
            updatedAt: stamp,
            timeline: [...task.timeline, `${stamp.slice(11)} 人工取消任务`],
          };
        }
        return {
          ...task,
          type: "export_package",
          status: "pending",
          updatedAt: stamp,
          timeline: [...task.timeline, `${stamp.slice(11)} 创建导出结果任务`],
          outputFiles: task.outputFiles.length ? task.outputFiles : [`exports/${task.batch}.zip`],
        };
      }),
    );
    const actionText = { retry: "重试任务", confirm: "人工确认", cancel: "取消任务", export: "导出结果" }[action];
    void persistTaskAction(taskId, action).catch(() => undefined);
    showToast(actionText, "任务状态已同步到本地历史", action === "cancel" ? "orange" : "blue");
  }

  function renderPage() {
    if (activePage === "dashboard") {
      return <DashboardPage onAction={showToast} onNavigate={handleNavigate} tasks={tasks} />;
    }
    if (activePage === "assets") {
      return <ProductAssetsPage onCreateTask={createTask} onAction={showToast} />;
    }
    if (activePage === "content") {
      return <ContentProductionPage onAction={showToast} onCreateTask={createTask} />;
    }
    if (activePage === "images") {
      return <ImageProcessingPage onAction={showToast} onCreateTask={createTask} />;
    }
    if (activePage === "analytics") {
      return <AnalyticsPage onAction={showToast} onCreateTask={createTaskFromSuggestion} />;
    }
    if (activePage === "intelligence") {
      return <IntelligencePage onAction={showToast} onCreateTask={createTask} />;
    }
    if (activePage === "tasks") {
      return <TaskQueuePage onAction={showToast} onTaskAction={handleTaskAction} tasks={tasks} />;
    }
    return <SettingsPage onAction={showToast} />;
  }

  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} items={navItems} onNavigate={handleNavigate} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onAction={showToast} />
        <div className="border-b border-[var(--border)] bg-[var(--bg-2)] px-4 py-3 lg:hidden">
          <div className="flex gap-2 overflow-x-auto">
            {navItems.map((item) => (
              <button
                className={clsx("btn whitespace-nowrap", activePage === item.id && "border-[var(--brand)] text-[var(--text)]")}
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                type="button"
              >
                <NavIcon page={item.id} /> {item.label}
              </button>
            ))}
          </div>
        </div>
        <main className="content-shell">{renderPage()}</main>
      </div>
      <ToastStack toasts={toasts} />
    </div>
  );
}
