import type { ReactNode } from "react";

interface TableShellProps {
  children: ReactNode;
  minWidth?: number;
}

export function TableShell({ children, minWidth = 920 }: TableShellProps) {
  return (
    <div className="table-shell">
      <table className="data-table" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}
