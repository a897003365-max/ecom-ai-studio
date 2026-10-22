import { useEffect, useRef, useState } from "react";
import { Filter, X } from "lucide-react";
import { EMPTY_PRODUCT_FILTERS, productFilterCount, productFilterError, productFilterKey, type ProductFilterState } from "./productFilterState";
import "../../styles/product-filters.css";

type MultiField = "statuses" | "channels" | "storeShortNames";
type ScopeField = "includeCodes" | "excludeCodes" | "includeIds" | "excludeIds";
interface Props {
  draft: ProductFilterState;
  applied: ProductFilterState;
  onChange: (value: ProductFilterState) => void;
  onApply: () => void;
  loading: boolean;
  ready: boolean;
  period: { start: string; end: string } | null;
  options: Record<MultiField, string[]>;
}

function FilterFields({ draft, onChange, period, options }: Pick<Props, "draft" | "onChange" | "period" | "options">) {
  const scopes: [ScopeField, string][] = [["includeCodes", "仅保留商品编码"], ["includeIds", "仅保留商品ID"], ["excludeCodes", "排除商品编码"], ["excludeIds", "排除商品ID"]];
  function preset(days: number | null) {
    if (!period) return;
    const date = new Date(`${period.end}T00:00:00Z`);
    if (days) date.setUTCDate(date.getUTCDate() - days + 1);
    else date.setUTCDate(1);
    const start = date.toISOString().slice(0, 10);
    onChange({ ...draft, start: start < period.start ? period.start : start, end: period.end });
  }
  return <>
    <fieldset className="product-filter-dates">
      <legend>日期范围</legend>
      <div><label>开始日期<input aria-label="开始日期" type="date" min={period?.start} max={period?.end} value={draft.start} onChange={(event) => onChange({ ...draft, start: event.target.value })} /></label><span aria-hidden="true">—</span><label>结束日期<input aria-label="结束日期" type="date" min={period?.start} max={period?.end} value={draft.end} onChange={(event) => onChange({ ...draft, end: event.target.value })} /></label></div>
      <div className="product-filter-presets"><button type="button" disabled={!period} onClick={() => preset(7)}>近7日</button><button type="button" disabled={!period} onClick={() => preset(30)}>近30日</button><button type="button" disabled={!period} onClick={() => preset(null)}>本月至今</button></div>
    </fieldset>
    {([["statuses", "订单状态"], ["channels", "渠道平台"], ["storeShortNames", "店铺简称"]] as [MultiField, string][]).map(([field, label]) => <details className="product-filter-group" key={field}>
      <summary>{label}<span>{draft[field].length ? `${draft[field].length} 项` : "全部"}</span></summary>
      <div className="product-filter-popover" role="group" aria-label={`${label}筛选`}>
        <label><input type="checkbox" checked={!draft[field].length} onChange={() => onChange({ ...draft, [field]: [] })} />全部（不设筛选）</label>
        {[...new Set([...options[field], ...draft[field]])].map((value) => <label key={value}><input type="checkbox" checked={draft[field].includes(value)} onChange={() => onChange({ ...draft, [field]: draft[field].includes(value) ? draft[field].filter((item) => item !== value) : [...draft[field], value] })} />{value}</label>)}
        {!options[field].length && <p className="text-[var(--muted)]">暂无可选项</p>}
      </div>
    </details>)}
    <details className="product-filter-group product-filter-scope">
      <summary>商品范围<span>{scopes.some(([field]) => draft[field].trim()) ? "已设置" : "全部"}</span></summary>
      <div className="product-filter-popover" role="group" aria-label="商品范围筛选">
        <p>每行一条，支持逗号分隔。排除优先于保留；商品ID 通过主数据匹配，未匹配的商品不会被 ID 排除。</p>
        {scopes.map(([field, label]) => <label key={field}>{label}<textarea aria-label={label} rows={3} value={draft[field]} onChange={(event) => onChange({ ...draft, [field]: event.target.value })} /></label>)}
      </div>
    </details>
  </>;
}

export function ProductFilters(props: Props) {
  const { draft, applied, onChange, onApply, loading, ready } = props;
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const desktopRef = useRef<HTMLFormElement>(null);
  const error = productFilterError(draft);
  const dirty = productFilterKey(draft) !== productFilterKey(applied);
  const count = productFilterCount(applied);
  const dateLabel = applied.start ? `${applied.start} — ${applied.end}` : "全周期";

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog?.close(); document.body.style.overflow = previous; triggerRef.current?.focus(); };
  }, [open]);

  function cancel() { onChange(applied); setOpen(false); }
  function apply() {
    if (error || !ready) return;
    desktopRef.current?.querySelectorAll("details[open]").forEach((element) => element.removeAttribute("open"));
    onApply();
    setOpen(false);
  }
  const disabled = !ready || Boolean(error) || (!dirty && !loading);
  return <section className="product-unified-filters" aria-label="商品运营筛选" data-testid="product-operations-filter" data-ui="filter-bar">
    <form className="product-filter-desktop" ref={desktopRef} onSubmit={(event) => { event.preventDefault(); apply(); }}>
      <div className="product-filter-fields"><FilterFields {...props} /></div>
      <div className="product-filter-actions"><button className="btn" type="button" onClick={() => onChange({ ...EMPTY_PRODUCT_FILTERS })}>清除全部筛选</button><button className="btn-primary" disabled={disabled} type="submit">应用筛选</button></div>
    </form>
    <div className="product-filter-mobile"><span>{dateLabel}</span><button className="btn" type="button" ref={triggerRef} aria-haspopup="dialog" onClick={() => { onChange(applied); setOpen(true); }}><Filter size={16} aria-hidden="true" />筛选{count ? `（${count}）` : ""}</button></div>
    <div className="product-filter-feedback" role="status" aria-live="polite">{error || (loading ? "正在更新，当前显示上次结果" : dirty ? "筛选已修改，点击应用后更新数据" : count ? `已应用 ${count} 项筛选` : "全周期 · 全部商品")}</div>
    {open && <dialog ref={dialogRef} className="product-filter-dialog" aria-labelledby="product-filter-title" onCancel={(event) => { event.preventDefault(); cancel(); }} onClick={(event) => { if (event.target === event.currentTarget) cancel(); }}>
      <form onSubmit={(event) => { event.preventDefault(); apply(); }}>
        <header><h2 id="product-filter-title">筛选商品数据</h2><button className="btn" aria-label="关闭筛选" onClick={cancel} type="button"><X size={20} /></button></header>
        <div className="product-filter-dialog-body"><FilterFields {...props} /><button className="btn" type="button" onClick={() => onChange({ ...EMPTY_PRODUCT_FILTERS })}>清除全部条件</button>{error && <p role="alert">{error}</p>}</div>
        <footer><button className="btn" onClick={cancel} type="button">取消</button><button className="btn-primary" disabled={disabled} type="submit">应用筛选</button></footer>
      </form>
    </dialog>}
  </section>;
}
