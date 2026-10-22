import { useEffect, useRef } from "react";
import { clsx } from "../utils/format";

interface TabsProps<T extends string> {
  value: T;
  tabs: Array<{ id: T; label: string }>;
  onChange: (id: T) => void;
}

export function Tabs<T extends string>({ value, tabs, onChange }: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const button = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (button && listRef.current) {
      const list = listRef.current;
      if (button.offsetLeft < list.scrollLeft) list.scrollLeft = button.offsetLeft;
      else if (button.offsetLeft + button.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = button.offsetLeft + button.offsetWidth - list.clientWidth;
    }
  }, [value]);
  return (
    <div ref={listRef} style={{ overflowY: "hidden", position: "relative" }} aria-label="切换数据视图" className="mb-[18px] flex gap-1.5 overflow-x-auto border-b border-[var(--border)]" role="tablist">
      {tabs.map((tab) => (
        <button
          className={clsx(
            "tab-trigger shrink-0 whitespace-nowrap",
            value === tab.id && "is-active",
          )}
          key={tab.id}
          onClick={() => onChange(tab.id)}
          aria-selected={value === tab.id}
          tabIndex={value === tab.id ? 0 : -1}
          onKeyDown={(event) => {
            const current = tabs.findIndex((item) => item.id === tab.id);
            const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (current + 1) % tabs.length : event.key === "ArrowLeft" ? (current - 1 + tabs.length) % tabs.length : -1;
            if (next < 0) return;
            event.preventDefault();
            onChange(tabs[next].id);
            listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus({ preventScroll: true });
          }}
          role="tab"
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
