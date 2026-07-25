import { useEffect, useMemo, useRef, useState } from "react";

export interface SpuOption {
  spu: string;
  productName: string;
}

interface Props {
  options: SpuOption[];
  selected: string[];
  onChange: (spus: string[]) => void;
  placeholder?: string;
}

/** SPU 多选搜索框：R5 变量替换、R6 框内仅摘要不堆叠 tag、R7 不透明底色+可见边框+聚焦描边。 */
export function SpuSearchSelect({ options, selected, onChange, placeholder = "搜索 SPU 编码或产品名称" }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 50);
    return options
      .filter((o) => o.spu.toLowerCase().includes(q) || (o.productName || "").toLowerCase().includes(q))
      .slice(0, 50);
  }, [query, options]);

  function toggle(spu: string) {
    if (selected.includes(spu)) {
      onChange(selected.filter((s) => s !== spu));
    } else {
      onChange([...selected, spu]);
    }
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div className="flex items-center gap-2 px-2.5 py-1.5 border rounded-md min-h-[38px] bg-[var(--panel-solid)] border-[var(--border-2)] focus-within:border-[var(--blue)]">
        <span className="text-[12px] text-[var(--muted)] shrink-0 whitespace-nowrap">
          {selected.length > 0 ? `已选 ${selected.length} 个 SPU` : placeholder}
        </span>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={selected.length === 0 ? "" : "添加/移除…"}
          className="flex-1 min-w-[40px] bg-transparent text-[13px] text-[var(--text)]"
          // 全局 :focus-visible 规则（styles.css）用非分层样式会盖过 Tailwind outline-none；
          // 外层容器已有 focus-within 蓝色描边表达焦点，这里用内联样式去掉输入框自身的荧光环。
          style={{ outline: "none" }}
        />
      </div>
      {open && filtered.length > 0 && (
        <div
          className="absolute z-10 mt-1 max-h-[300px] overflow-y-auto rounded-lg border border-[var(--border-2)] bg-[var(--panel-solid)] p-1 shadow-xl"
          style={{ minWidth: "100%" }}
        >
          {filtered.map((o) => {
            const isSel = selected.includes(o.spu);
            return (
              <button
                key={o.spu}
                type="button"
                onClick={() => toggle(o.spu)}
                className={`w-full text-left px-2.5 py-2 text-[12.5px] rounded-md flex items-center justify-between gap-2 ${
                  isSel ? "bg-[var(--blue-bg)]" : "hover:bg-[var(--bg-elevated)]"
                }`}
              >
                <span className="truncate">
                  <span className={`font-medium ${isSel ? "text-[var(--blue)]" : "text-[var(--text)]"}`}>{o.spu}</span>
                  {o.productName ? (
                    <span className={isSel ? "text-[var(--blue)]" : "text-[var(--muted)]"}>｜{o.productName}</span>
                  ) : null}
                </span>
                {isSel && <span className="shrink-0 text-[var(--blue)]">✓</span>}
              </button>
            );
          })}
        </div>
      )}
      {open && filtered.length === 0 && (
        <div className="absolute z-10 mt-1 px-3 py-2.5 text-[12.5px] text-[var(--muted)] bg-[var(--panel-solid)] border border-[var(--border-2)] rounded-lg shadow-xl">
          未匹配到 SPU
        </div>
      )}
    </div>
  );
}
