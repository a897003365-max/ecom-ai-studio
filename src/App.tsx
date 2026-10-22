import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { NavIcon } from "./components/NavIcon";
import { ToastStack } from "./components/ToastStack";
import { Topbar } from "./components/Topbar";
import { TopProgressBar } from "./components/TopProgressBar";
import { navItems } from "./data/mock";
import { getAuthStatus, logout } from "./services/authApi";
import { getPersistedTasks, persistTask, persistTaskAction } from "./services/localApi";
import type { PageId, QueueTask, RegenerationSuggestion, TaskCreateInput, ToastMessage } from "./types";
import type { AuthStatus, AuthUser } from "./types/auth";
import type { SearchTarget } from "./types/search";
import { createId, nowStamp } from "./utils/format";
import { clsx } from "./utils/format";

const AccessManagementPage = lazy(() => import("./pages/AccessManagementPage").then((m) => ({ default: m.AccessManagementPage })));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })));
const CustomerServicePage = lazy(() => import("./pages/CustomerServicePage").then((m) => ({ default: m.CustomerServicePage })));
const ContentProductionPage = lazy(() => import("./pages/ContentProductionPage").then((m) => ({ default: m.ContentProductionPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const ImageProcessingPage = lazy(() => import("./pages/ImageProcessingPage").then((m) => ({ default: m.ImageProcessingPage })));
const IntelligencePage = lazy(() => import("./pages/IntelligencePage").then((m) => ({ default: m.IntelligencePage })));
const LoginPage = lazy(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const ProductAssetsPage = lazy(() => import("./pages/ProductAssetsPage").then((m) => ({ default: m.ProductAssetsPage })));
const ProductManagementPage = lazy(() => import("./pages/ProductManagementPage").then((m) => ({ default: m.ProductManagementPage })));
const SentimentPage = lazy(() => import("./pages/SentimentPage").then((m) => ({ default: m.SentimentPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const TaskQueuePage = lazy(() => import("./pages/TaskQueuePage").then((m) => ({ default: m.TaskQueuePage })));

function PageSuspenseFallback() {
  return (
    <div className="page-suspense-fallback" aria-label="页面加载中" data-ui="page-suspense">
      <span className="auth-loading-mark" />
    </div>
  );
}

type Theme = "light" | "dark";

// 已关闭“按时间段自动切换暗色模式”：固定初始使用亮色主题。
// 用户仍可通过侧边栏/顶栏的主题切换按钮手动在亮色/暗色间切换。
const initialTheme: Theme = "light";
document.documentElement.dataset.theme = initialTheme;

// Hash 路由支持：允许通过 #pageId 直接打开指定页面（用于服务器反向代理嵌入）
const VALID_HASH_PAGES: PageId[] = ["dashboard", "assets", "content", "images", "analytics", "customer-service", "intelligence", "sentiment", "tasks", "products", "settings", "access"];
function getPageFromHash(): PageId | null {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (!hash) return null;
  return VALID_HASH_PAGES.includes(hash as PageId) ? (hash as PageId) : null;
}

const pagePermissions: Record<PageId, string> = {
  dashboard: "dashboard.view",
  assets: "assets.view",
  content: "content.view",
  images: "images.view",
  analytics: "analytics.view",
  "customer-service": "analytics.view",
  intelligence: "intelligence.view",
  sentiment: "intelligence.view",
  tasks: "tasks.view",
  products: "products.view",
  settings: "settings.view",
  access: "admin.users",
};

// 嵌入模式检测：当页面在 iframe 中运行时，隐藏导航栏和用户栏，只显示内容区域
const isEmbedded = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

export default function App() {
  const [activePage, setActivePage] = useState<PageId>(() => getPageFromHash() ?? "dashboard");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [tasks, setTasks] = useState<QueueTask[]>([]);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [searchTarget, setSearchTarget] = useState<SearchTarget | null>(null);
  const toastSeed = useRef(0);
  const searchSeqRef = useRef(0);

  useEffect(() => {
    getAuthStatus()
      .then((status) => {
        setAuthStatus(status);
        setAuthError("");
      })
      .catch((error: unknown) => setAuthError(error instanceof Error ? error.message : "账号服务不可用"))
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    const expireSession = () => {
      setAuthStatus((current) => current?.enforcementEnabled ? { ...current, user: null, permissionCatalog: [] } : current);
      setTasks([]);
    };
    window.addEventListener("ecom:session-expired", expireSession);
    return () => window.removeEventListener("ecom:session-expired", expireSession);
  }, []);

  // Hash 路由：监听 URL hash 变化，同步到 activePage
  useEffect(() => {
    const handleHashChange = () => {
      const page = getPageFromHash();
      if (page) setActivePage(page);
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Hash 路由：当 activePage 变化时，同步更新 URL hash（不触发新的 hashchange 循环）
  useEffect(() => {
    const expected = `#${activePage}`;
    if (window.location.hash !== expected) {
      window.history.replaceState(null, "", expected);
    }
  }, [activePage]);

  const currentUser = authStatus?.user ?? null;
  const hasPermission = (permission: string) => Boolean(currentUser && (currentUser.role === "admin" || currentUser.permissions.includes(permission)));
  const allowedNavItems = currentUser ? navItems.filter((item) => hasPermission(pagePermissions[item.id])) : [];

  useEffect(() => {
    if (!currentUser || hasPermission("tasks.view") === false) return;
    getPersistedTasks()
      .then(({ tasks: persisted }) => {
        setTasks(persisted);
      })
      .catch(() => {
        // 正式模式不回填演示任务；仅保留本次会话里由用户刚创建的任务。
      });
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser || !allowedNavItems.length) return;
    if (!allowedNavItems.some((item) => item.id === activePage)) setActivePage(allowedNavItems[0].id);
  }, [currentUser?.id, currentUser?.permissions.join("|"), activePage]);

  function showToast(title: string, detail?: string, tone: ToastMessage["tone"] = "green") {
    toastSeed.current += 1;
    const id = toastSeed.current;
    setToasts((current) => [{ id, title, detail, tone }, ...current].slice(0, 3));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 2800);
  }

  function handleAuthenticated(user: AuthUser) {
    setAuthStatus((current) => ({
      configured: true,
      enforcementEnabled: current?.enforcementEnabled ?? true,
      userCount: Math.max(1, current?.userCount ?? 0),
      user,
      permissionCatalog: current?.permissionCatalog ?? [],
    }));
    setActivePage(user.permissions.includes("dashboard.view") || user.role === "admin" ? "dashboard" : "settings");
  }

  function handleCurrentUserChange(user: AuthUser) {
    setAuthStatus((current) => current ? { ...current, user } : current);
  }

  async function handleLogout() {
    if (authStatus?.enforcementEnabled === false) {
      showToast("当前为免登录模式", "账号和权限功能已保留，上线开启拦截后可正常退出登录", "blue");
      return;
    }
    try {
      await logout();
    } finally {
      setAuthStatus((current) => current ? { ...current, configured: true, user: null, permissionCatalog: [] } : current);
      setTasks([]);
    }
  }

  function handleThemeToggle() {
    const nextTheme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    setTheme(nextTheme);
  }

  function handleNavigate(page: PageId) {
    if (!hasPermission(pagePermissions[page])) {
      showToast("当前页面未授权", "请联系管理员开通该页面的访问权限", "orange");
      return;
    }
    setActivePage(page);
  }

  // 顶部智能找数：导航到目标页面并携带一次性 SearchTarget。
  // requestId 在此集中生成：保证连续点击同一结果（或同页面内导航）都能重新触发
  // 下游依赖 requestId 的 useEffect（筛选应用、滚动定位、高亮）。
  function handleSearchNavigate(target: SearchTarget) {
    const page = target.page;
    if (!hasPermission(pagePermissions[page])) {
      showToast("当前页面未授权", "请联系管理员开通该页面的访问权限", "orange");
      return;
    }
    searchSeqRef.current += 1;
    setSearchTarget({ ...target, requestId: `search-${Date.now()}-${searchSeqRef.current}` });
    setActivePage(page);
  }

  function consumeSearchTarget() {
    setSearchTarget(null);
  }

  function createTask(input: TaskCreateInput) {
    const requiredPermission = input.type === "image_process"
      ? "images.manage"
      : ["competitor_crawl", "top100_crawl"].includes(input.type)
        ? "intelligence.manage"
        : ["content_generate", "script_generate", "quality_check"].includes(input.type)
          ? "content.manage"
          : "tasks.manage";
    if (!hasPermission(requiredPermission)) {
      showToast("当前账号无操作权限", "请联系管理员开通对应模块的执行权限", "orange");
      return;
    }
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
      return <DashboardPage canCreateTasks={hasPermission("tasks.manage") || hasPermission("content.manage") || hasPermission("images.manage") || hasPermission("intelligence.manage")} onAction={showToast} onNavigate={handleNavigate} tasks={tasks} />;
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
      return <AnalyticsPage canManage={hasPermission("analytics.manage")} onAction={showToast} onCreateTask={createTaskFromSuggestion} searchTarget={searchTarget?.page === "analytics" ? searchTarget : null} onSearchConsumed={consumeSearchTarget} />;
    }
    if (activePage === "customer-service") {
      return <CustomerServicePage canManage={hasPermission("analytics.manage")} onAction={showToast} />;
    }
    if (activePage === "intelligence") {
      return <IntelligencePage canManage={hasPermission("intelligence.manage")} onAction={showToast} onCreateTask={createTask} />;
    }
    if (activePage === "sentiment") {
      return <SentimentPage canManage={hasPermission("intelligence.manage")} onAction={showToast} />;
    }
    if (activePage === "products") {
      return <ProductManagementPage onAction={showToast} searchTarget={searchTarget?.page === "products" ? searchTarget : null} onSearchConsumed={consumeSearchTarget} />;
    }
    if (activePage === "tasks") {
      return <TaskQueuePage onAction={showToast} onTaskAction={handleTaskAction} tasks={tasks} />;
    }
    if (activePage === "settings") {
      return <SettingsPage canManage={hasPermission("settings.manage")} onAction={showToast} />;
    }
    if (activePage === "access" && currentUser) {
      return <AccessManagementPage currentUser={currentUser} onAction={showToast} onCurrentUserChange={handleCurrentUserChange} />;
    }
    return (
      <div className="empty-access-state">
        <div className="auth-form-icon"><NavIcon page="access" size={20} /></div>
        <h2>暂未分配页面权限</h2>
        <p>请联系管理员为当前账号开通至少一个业务页面。</p>
      </div>
    );
  }

  if (authLoading) {
    return <div className="auth-loading-screen"><span className="auth-loading-mark" /><b>正在验证本地会话</b></div>;
  }
  if (!authStatus) {
    return <div className="auth-loading-screen"><b>无法连接账号服务</b><span>{authError}</span><button className="btn-primary" onClick={() => window.location.reload()} type="button">重新连接</button></div>;
  }
  if (authStatus.enforcementEnabled && !currentUser) return <LoginPage onAuthenticated={handleAuthenticated} status={authStatus} />;
  if (!currentUser) return <div className="auth-loading-screen"><b>免登录模式初始化失败</b><button className="btn-primary" onClick={() => window.location.reload()} type="button">重新连接</button></div>;

  return (
    <div className={clsx("app-shell", isEmbedded && "app-embedded")} data-ui="app-shell" data-embedded={isEmbedded ? "true" : "false"}>
      <TopProgressBar />
      {!isEmbedded && (
        <Sidebar activePage={activePage} items={allowedNavItems} onNavigate={handleNavigate} onToggleTheme={handleThemeToggle} theme={theme} />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {!isEmbedded && (
          <Topbar
            onAction={showToast}
            onLogout={() => void handleLogout()}
            onOpenSettings={hasPermission("settings.view") ? () => handleNavigate("settings") : undefined}
            onSearchNavigate={handleSearchNavigate}
            onToggleTheme={handleThemeToggle}
            searchAllowedPages={new Set(allowedNavItems.map((item) => item.id))}
            searchCanData={hasPermission("analytics.view") || hasPermission("products.view")}
            theme={theme}
            user={currentUser}
          />
        )}
        {!isEmbedded && (
          <div className="border-b border-[var(--border)] bg-[var(--bg-2)] px-4 py-3 lg:hidden" data-ui="mobile-navigation">
            <div className="flex gap-2 overflow-x-auto">
              {allowedNavItems.map((item) => (
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
        )}
        <main className="content-shell" data-ui="page-content">
          <Suspense fallback={<PageSuspenseFallback />}>
            {renderPage()}
          </Suspense>
        </main>
      </div>
      <ToastStack toasts={toasts} />
    </div>
  );
}
