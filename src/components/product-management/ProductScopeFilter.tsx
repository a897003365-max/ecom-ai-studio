import { useEffect, useState } from "react";
import { ChevronDown, Filter, X } from "lucide-react";

export interface ProductScopeValue {
  includeCodes: string[];
  excludeCodes: string[];
  includeIds: string[];
  excludeIds: string[];
}

export const EMPTY_PRODUCT_SCOPE: ProductScopeValue = {
  includeCodes: [],
  excludeCodes: [],
  includeIds: [],
  excludeIds: [],
};

// 筛选值走 GET query，超过约 200 条会逼近 Node 16KB 请求行上限；超限时留在面板内提示。
const FIELD_VALUE_LIMIT = 200;

interface DraftState {
  includeCodes: string;
  excludeCodes: string;
  includeIds: string;
  excludeIds: string;
}

function toDraft(value: ProductScopeValue): DraftState {
  return {
    includeCodes: value.includeCodes.join("\n"),
    excludeCodes: value.excludeCodes.join("\n"),
    includeIds: value.includeIds.join("\n"),
    excludeIds: value.excludeIds.join("\n"),
  };
}

// 商品编码可能自带空格（如规格后缀），只按换行/制表符/逗号/分号切分，避免把一条编码拆成两条。
function parseValues(text: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of text.split(/[\n\t,，;；]+/)) {
    const value = raw.trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  }
  return values;
}

export function ProductScopeFilter({
  value,
  onApply,
  loading,
}: {
  value: ProductScopeValue;
  onApply: (value: ProductScopeValue) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<DraftState>(() => toDraft(value));
  useEffect(() => {
    setDraft(toDraft(value));
    setError("");
  }, [value, open]);

  const retainCount = value.includeCodes.length + value.includeIds.length;
  const excludeCount = value.excludeCodes.length + value.excludeIds.length;
  const buttonLabel = retainCount && excludeCount
    ? `商品范围：保留 ${retainCount} · 排除 ${excludeCount}`
    : retainCount
      ? `商品范围：仅保留 ${retainCount}`
      : excludeCount
        ? `商品范围：排除 ${excludeCount}`
        : "商品范围：全部";

  function setField(field: keyof DraftState, text: string) {
    setError("");
    setDraft((current) => ({ ...current, [field]: text }));
  }

  function apply() {
    const next = {
      includeCodes: parseValues(draft.includeCodes),
      excludeCodes: parseValues(draft.excludeCodes),
      includeIds: parseValues(draft.includeIds),
      excludeIds: parseValues(draft.excludeIds),
    };
    const oversized = Object.entries(next).find(([, values]) => values.length > FIELD_VALUE_LIMIT);
    if (oversized) {
      setError(`单个字段最多 ${FIELD_VALUE_LIMIT} 条，当前 ${oversized[1].length} 条，请拆开筛选。`);
      return;
    }
    onApply(next);
    setOpen(false);
  }

  function reset() {
    setDraft(toDraft(EMPTY_PRODUCT_SCOPE));
    setError("");
  }

  return (
    <div className="date-filter">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="btn-select min-w-[170px]"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="flex items-center gap-2">
          <Filter aria-hidden="true" size={14} />
          {buttonLabel}
        </span>
        <ChevronDown aria-hidden="true" className={open ? "rotate-180" : ""} size={14} />
      </button>
      {open && (
        <div
          aria-label="商品范围筛选"
          className="date-filter-panel"
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          role="dialog"
        >
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold">商品范围筛选</div>
            <button aria-label="关闭" className="icon-btn" onClick={() => setOpen(false)} type="button">
              <X size={15} />
            </button>
          </div>
          <div className="mt-2 text-[11px] leading-5 text-[var(--muted)]">
            作用于整页数据；每行一个，支持逗号分隔；商品ID 经产品主数据映射为商品编码，未匹配主数据的商品不会被 ID 排除。排除优先于保留。
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <div className="text-[12px] font-bold text-[var(--green)]">仅保留（留空 = 不限）</div>
            <label className="date-field">
              商品编码
              <textarea
                aria-label="仅保留商品编码"
                autoFocus
                onChange={(event) => setField("includeCodes", event.target.value)}
                placeholder="如 MCS24014ZHMCLTRBSXCA0020"
                value={draft.includeCodes}
              />
            </label>
            <label className="date-field">
              商品ID
              <textarea
                aria-label="仅保留商品ID"
                onChange={(event) => setField("includeIds", event.target.value)}
                placeholder="如 10175050064119"
                value={draft.includeIds}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <div className="text-[12px] font-bold text-[var(--pink)]">排除（留空 = 不排除）</div>
            <label className="date-field">
              商品编码
              <textarea
                aria-label="排除商品编码"
                onChange={(event) => setField("excludeCodes", event.target.value)}
                placeholder="每行一个商品编码"
                value={draft.excludeCodes}
              />
            </label>
            <label className="date-field">
              商品ID
              <textarea
                aria-label="排除商品ID"
                onChange={(event) => setField("excludeIds", event.target.value)}
                placeholder="每行一个商品ID"
                value={draft.excludeIds}
              />
            </label>
          </div>
          {error && <div className="mt-3 text-[11px] font-semibold text-[var(--pink)]">{error}</div>}
          <div className="mt-4 flex items-center justify-end gap-3 border-t border-[var(--border)] pt-3">
            <button className="btn" onClick={reset} type="button">重置</button>
            <button className="btn-primary" disabled={loading} onClick={apply} type="button">
              {loading ? "更新中..." : "应用筛选"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
