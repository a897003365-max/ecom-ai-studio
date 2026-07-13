import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[20px] font-bold">{title}</h1>
        <p className="mt-1 max-w-4xl text-[12.5px] leading-5 text-[var(--muted)]">{subtitle}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
