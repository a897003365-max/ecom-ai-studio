import { Bell, CircleHelp, LogOut, Settings, UserRound } from "lucide-react";
import type { AuthUser } from "../types/auth";

interface TopbarProps {
  onAction: (title: string, detail?: string) => void;
  user: AuthUser;
  onLogout: () => void;
  onOpenSettings?: () => void;
}

export function Topbar({ onAction, user, onLogout, onOpenSettings }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="ml-auto flex items-center gap-3">
        <button className="relative flex h-8 w-8 items-center justify-center text-[var(--muted)] hover:text-[var(--text)]" onClick={() => onAction("通知中心", "共有 12 条待处理通知")} title="通知" type="button">
          <Bell aria-hidden="true" size={17} />
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-[var(--red)] px-1 text-[9px] font-bold leading-4 text-white">12</span>
        </button>
        <button className="hidden h-8 w-8 items-center justify-center text-[var(--muted)] hover:text-[var(--text)] md:flex" onClick={() => onAction("帮助中心", "可查看页面指标说明与操作指引")} title="帮助" type="button">
          <CircleHelp aria-hidden="true" size={17} />
        </button>
        {onOpenSettings && <button className="hidden h-8 w-8 items-center justify-center text-[var(--muted)] hover:text-[var(--text)] md:flex" onClick={onOpenSettings} title="系统设置" type="button"><Settings aria-hidden="true" size={17} /></button>}
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--brand)] bg-[var(--brand-dim)] text-[var(--brand)]"><UserRound size={15} /></div>
          <div className="hidden leading-tight md:block"><div className="text-[12.5px] font-semibold">{user.name}</div><div className="text-[10px] text-[var(--muted-2)]">{user.role === "admin" ? "管理员" : "成员"}</div></div>
        </div>
        <button aria-label="退出登录" className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] transition hover:bg-[var(--red-bg)] hover:text-[var(--red)]" onClick={onLogout} title="退出登录" type="button"><LogOut size={16} /></button>
      </div>
    </header>
  );
}
