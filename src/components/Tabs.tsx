import { clsx } from "../utils/format";

interface TabsProps<T extends string> {
  value: T;
  tabs: Array<{ id: T; label: string }>;
  onChange: (id: T) => void;
}

export function Tabs<T extends string>({ value, tabs, onChange }: TabsProps<T>) {
  return (
    <div aria-label="切换数据视图" className="mb-[18px] flex gap-1.5 border-b border-[var(--border)]" role="tablist">
      {tabs.map((tab) => (
        <button
          className={clsx(
            "tab-trigger",
            value === tab.id && "is-active",
          )}
          key={tab.id}
          onClick={() => onChange(tab.id)}
          aria-selected={value === tab.id}
          role="tab"
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
