import type { ToastMessage } from "../types";
import { StatusTag } from "./StatusTag";

interface ToastStackProps {
  toasts: ToastMessage[];
}

export function ToastStack({ toasts }: ToastStackProps) {
  return (
    <div className="fixed right-5 top-5 z-50 grid w-[320px] max-w-[calc(100vw-32px)] gap-2">
      {toasts.map((toast) => (
        <div className="rounded-xl border border-[var(--border-2)] bg-[var(--panel-solid)] p-4 shadow-2xl" key={toast.id}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <strong className="text-[13px]">{toast.title}</strong>
            <StatusTag label="mock" tone={toast.tone ?? "green"} />
          </div>
          {toast.detail && <p className="m-0 text-[12px] leading-5 text-[var(--muted)]">{toast.detail}</p>}
        </div>
      ))}
    </div>
  );
}
