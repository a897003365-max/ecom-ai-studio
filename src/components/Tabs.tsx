import { clsx } from "../utils/format";

interface TabsProps<T extends string> {
  value: T;
  tabs: Array<{ id: T; label: string }>;
  onChange: (id: T) => void;
}

export function Tabs<T extends string>({ value, tabs, onChange }: TabsProps<T>) {
  return (
    <div className="mb-[18px] flex gap-1.5 border-b border-[var(--border)]">
      {tabs.map((tab) => (
        <button
          className={clsx(
            "relative top-px mr-4 border-b-2 border-transparent px-1 py-2.5 text-[13.5px] text-[var(--muted)]",
            value === tab.id && "border-[var(--brand)] font-bold text-[var(--text)]",
          )}
          key={tab.id}
          onClick={() => onChange(tab.id)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
