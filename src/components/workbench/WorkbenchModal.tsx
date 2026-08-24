import { useEffect, useRef, type ReactNode } from "react";
import { clsx } from "../../utils/format";

interface WorkbenchModalProps {
  title: string;
  open: boolean;
  onClose: () => void;
  onCancel?: () => void;
  onSave?: () => void;
  saveLabel?: string;
  children: ReactNode;
  wide?: boolean;
}

// 工作台通用弹窗：桌面居中，移动端底部抽屉，Esc / 遮罩关闭，焦点陷阱 + 还原
const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function WorkbenchModal({ title, open, onClose, onCancel, onSave, saveLabel = "保存", children, wide = false }: WorkbenchModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<Element | null>(null);

  // 焦点陷阱：打开时记录上次焦点，关闭时还原
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement;
    const container = containerRef.current;
    const focusable = container?.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusable?.[0]?.focus();

    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !container) return;
      const list = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (list.length === 0) {
        event.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      const prev = previouslyFocused.current;
      if (prev instanceof HTMLElement) {
        prev.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/65" onClick={onClose} />
      <div
        ref={containerRef}
        className={clsx(
          "relative flex max-h-[88vh] w-full flex-col overflow-hidden border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[0_16px_40px_rgba(0,0,0,0.5)]",
          wide ? "sm:max-w-2xl" : "sm:max-w-[560px]",
          "rounded-t-[12px] sm:rounded-[12px]",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5">
          <h3 className="text-[15px] font-bold">{title}</h3>
          <button className="btn !min-h-9 !px-2.5" onClick={onClose} type="button" aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {(onSave || onCancel) && (
          <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
            {onCancel && (
              <button className="btn" onClick={onCancel} type="button">
                取消
              </button>
            )}
            {onSave && (
              <button className="btn-primary" onClick={onSave} type="button">
                {saveLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
