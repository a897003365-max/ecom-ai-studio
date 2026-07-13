import { Aperture, CircleHelp, MessageCircle, Moon, Settings } from "lucide-react";
import type { NavItem, PageId } from "../types";
import { clsx } from "../utils/format";
import { NavIcon } from "./NavIcon";

interface SidebarProps {
  items: NavItem[];
  activePage: PageId;
  onNavigate: (id: PageId) => void;
}

export function Sidebar({ items, activePage, onNavigate }: SidebarProps) {
  const groups = Array.from(new Set(items.map((item) => item.group)));

  return (
    <aside className="sidebar">
      <div className="flex items-center gap-2.5 px-2 pb-4 pt-1.5">
        <div className="logo-dot"><Aperture size={15} strokeWidth={2.4} /></div>
        <div className="text-[15px] font-bold">
          <span className="text-[var(--brand)]">ecom</span> AI Studio
        </div>
      </div>

      {groups.map((group) => (
        <div key={group}>
          <div className="px-3 pb-1.5 pt-3.5 text-[11px] uppercase text-[var(--muted-2)]">{group}</div>
          {items
            .filter((item) => item.group === group)
            .map((item) => (
              <button
                className={clsx("nav-item", activePage === item.id && "nav-item-active")}
                key={item.id}
                onClick={() => onNavigate(item.id)}
                type="button"
              >
                <span className="flex w-[18px] justify-center"><NavIcon page={item.id} /></span>
                <span className="truncate">{item.label}</span>
              </button>
            ))}
        </div>
      ))}

      <div className="mt-auto flex gap-1 border-t border-[var(--border)] px-1 pt-3">
        {[
          [Moon, "切换主题"],
          [MessageCircle, "反馈"],
          [CircleHelp, "帮助"],
          [Settings, "设置"],
        ].map(([Icon, label]) => (
          <button className="flex h-[30px] w-[30px] items-center justify-center rounded-[5px] text-[var(--muted)] hover:bg-white/5 hover:text-[var(--text)]" key={label as string} title={label as string} type="button">
            <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
          </button>
        ))}
      </div>
    </aside>
  );
}
