import type { ReactNode } from "react";

interface TableShellProps {
  children: ReactNode;
  dataUi?: string;
  minWidth?: number;
}

export function TableShell({ children, dataUi, minWidth = 920 }: TableShellProps) {
  return (
    <div className="table-shell" data-ui={dataUi ?? "data-table"}>
      <table className="data-table" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}
