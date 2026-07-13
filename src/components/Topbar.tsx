import { Bell, ChevronDown, CircleHelp, Settings, Store, UserRound } from "lucide-react";

interface TopbarProps {
  onAction: (title: string, detail?: string) => void;
  showStoreSelector?: boolean;
}

export function Topbar({ onAction, showStoreSelector = true }: TopbarProps) {
  return (
    <header className="topbar">
      {showStoreSelector && (
        <button className="btn-select" onClick={() => onAction("店铺选择已打开", "MVP 阶段使用 mock 店铺列表")} type="button">
          <Store aria-hidden="true" size={15} /> 床垫旗舰店（天猫） <ChevronDown aria-hidden="true" className="text-[var(--muted-2)]" size={14} />
        </button>
      )}
      <div className="ml-auto flex items-center gap-3">
        <button className="relative flex h-8 w-8 items-center justify-center text-[var(--muted)] hover:text-[var(--text)]" onClick={() => onAction("通知中心", "共有 12 条 mock 通知")} title="通知" type="button">
          <Bell aria-hidden="true" size={17} />
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-[var(--red)] px-1 text-[9px] font-bold leading-4 text-white">12</span>
        </button>
        <button className="hidden h-8 w-8 items-center justify-center text-[var(--muted)] hover:text-[var(--text)] md:flex" onClick={() => onAction("帮助入口", "当前 README 已补充 MVP 范围")} title="帮助" type="button">
          <CircleHelp aria-hidden="true" size={17} />
        </button>
        <button className="hidden h-8 w-8 items-center justify-center text-[var(--muted)] hover:text-[var(--text)] md:flex" onClick={() => onAction("系统设置", "可从左侧导航进入配置页")} title="系统设置" type="button">
          <Settings aria-hidden="true" size={17} />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--brand)] bg-[var(--brand-dim)] text-[var(--brand)]"><UserRound size={15} /></div>
          <div className="hidden text-[12.5px] font-semibold md:block">运营专员</div>
        </div>
      </div>
    </header>
  );
}
