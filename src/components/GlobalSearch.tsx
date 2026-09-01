import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, Search, Sparkles, X } from "lucide-react";
import type { PageId } from "../types";
import type { SearchAnswer, SearchResponse, SearchTarget } from "../types/search";
import { searchSite } from "../services/localApi";
import { clsx } from "../utils/format";

let searchSeq = 0;
function nextSearchRequestId() {
  searchSeq += 1;
  return `${Date.now()}-${searchSeq}`;
}

// 本地页面导航目录（无经营/商品权限时仍可用，仅本地匹配）
const LOCAL_PAGES: Array<{ id: Exclude<PageId, "analytics" | "products">; label: string; aliases: string[] }> = [
  { id: "dashboard", label: "工作台", aliases: ["首页", "工作台", "仪表盘"] },
  { id: "assets", label: "商品资产", aliases: ["商品资产", "素材", "资产"] },
  { id: "content", label: "内容生产", aliases: ["内容生产", "文案", "分镜"] },
  { id: "images", label: "图片处理", aliases: ["图片处理", "图片"] },
  { id: "intelligence", label: "竞品情报", aliases: ["竞品情报", "竞品", "top100"] },
  { id: "sentiment", label: "小红书舆情分析", aliases: ["舆情", "舆情分析", "小红书舆情", "避雷"] },
  { id: "tasks", label: "任务队列", aliases: ["任务队列", "任务"] },
  { id: "settings", label: "系统设置", aliases: ["系统设置", "设置"] },
  { id: "access", label: "权限管理", aliases: ["权限管理", "权限"] },
];

const EXAMPLES = ["8月天猫退款率", "豆7销量和退货率", "仓配履约在哪里"];

interface SelectableItem {
  key: string;
  title: string;
  subtitle: string;
  target?: SearchTarget;
  kind: "answer" | "section" | "metric" | "entity" | "clarification" | "page";
  runQuery?: string;
  answer?: SearchAnswer;
}

interface GlobalSearchProps {
  onNavigate: (target: SearchTarget) => void;
  canSearch: boolean;
  allowedPages: Set<string>;
}

function matchLocalPages(query: string, allowed: Set<string>) {
  const q = query.trim().toLowerCase();
  const pages = LOCAL_PAGES.filter((p) => allowed.has(p.id));
  if (!q) return pages;
  return pages.filter((p) => p.label.toLowerCase().includes(q) || p.aliases.some((a) => a.toLowerCase().includes(q)));
}

function isEditableTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
}

export function GlobalSearch({ onNavigate, canSearch, allowedPages }: GlobalSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);
  const answeredQueryRef = useRef<string | null>(null);
  const manualNavRef = useRef(false);

  function openSearch() {
    setOpen(true);
    setError("");
  }
  function closeSearch() {
    setOpen(false);
    setQuery("");
    setResponse(null);
    setError("");
    if (abortRef.current) abortRef.current.abort();
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        setError("");
        window.setTimeout(() => inputRef.current?.focus(), 0);
      } else if (event.key === "/" && !isEditableTarget(event.target)) {
        event.preventDefault();
        setOpen(true);
        setError("");
        window.setTimeout(() => inputRef.current?.focus(), 0);
      } else if (event.key === "Escape") {
        closeSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // 联想：输入达到 2 字符后 180ms debounce，AbortController 取消过期请求
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResponse(null);
      setError("");
      setLoading(false);
      return;
    }
    if (!canSearch) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      // 刚提交过完整回答的同一查询不再触发联想，避免覆盖答案
      if (trimmed === answeredQueryRef.current) return;
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError("");
      searchSite({ query: trimmed, mode: "suggest", limit: 8 }, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setResponse(result);
          setActiveIndex(0);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setError(err instanceof Error && err.name === "AbortError" ? "" : "数据搜索暂不可用");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, open, canSearch]);

  // 完整回答：Enter 提交
  async function runAnswer(rawQuery?: string) {
    const trimmed = (rawQuery ?? query).trim();
    if (!trimmed) return;
    if (!canSearch) return;
    answeredQueryRef.current = trimmed;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await searchSite({ query: trimmed, mode: "answer" }, controller.signal);
      if (controller.signal.aborted) return;
      setResponse(result);
      setQuery(trimmed);
      setActiveIndex(0);
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error && err.name === "AbortError" ? "" : "数据搜索暂不可用");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  // 可选项列表：答案 + 结果 + 本地页面
  const items = useMemo<SelectableItem[]>(() => {
    const list: SelectableItem[] = [];
    const trimmed = query.trim();
    if (response) {
      for (const a of response.answers) {
        // 定义卡的 displayValue 与 definition 相同，避免重复展示
        const subtitle = a.displayValue && a.displayValue !== a.definition ? `${a.displayValue} · ${a.definition}` : a.definition;
        list.push({ key: a.id, title: a.label, subtitle, target: a.target, kind: "answer", answer: a });
      }
      for (const r of response.results) {
        list.push({ key: r.id, title: r.title, subtitle: r.subtitle, target: r.target, kind: r.kind });
      }
      // 联想：把匹配到的指标名作为可点选项，点击即执行该指标的回答
      for (const s of response.suggestions) {
        if (!list.some((item) => item.title === s)) {
          list.push({ key: `suggest-${s}`, title: s, subtitle: response.status === "unsupported" ? "试试这个问法" : "查看这个指标", runQuery: s, kind: "metric" });
        }
      }
    }
    if (!canSearch) {
      // 无经营/商品权限：仅本地页面导航
      for (const p of matchLocalPages(trimmed, allowedPages)) {
        list.push({ key: `page-${p.id}`, title: p.label, subtitle: "本地页面 · 去这里查看", target: { requestId: nextSearchRequestId(), page: p.id }, kind: "page" });
      }
      return list.slice(0, 10);
    }
    if (!trimmed) {
      // 空状态：仅三条固定示例（任务书第 9 节）
      for (const example of EXAMPLES) {
        list.push({ key: `example-${example}`, title: example, subtitle: "试试这个问法", runQuery: example, kind: "section" });
      }
      return list;
    }
    // 有数据权限 + 有输入：本地页面最多占 3 个
    const localPages = matchLocalPages(trimmed, allowedPages).slice(0, 3);
    for (const p of localPages) {
      list.push({ key: `page-${p.id}`, title: p.label, subtitle: "本地页面 · 去这里查看", target: { requestId: nextSearchRequestId(), page: p.id }, kind: "page" });
    }
    return list.slice(0, 10);
  }, [response, query, canSearch, allowedPages]);

  const activeItem = items[activeIndex] ?? null;

  function selectItem(item: SelectableItem) {
    if (item.runQuery) {
      setQuery(item.runQuery);
      void runAnswer(item.runQuery);
      return;
    }
    if (item.target) {
      onNavigate(item.target);
      closeSearch();
    }
  }

  function onInputKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      // 仅当用户显式用方向键选中某结果时才选择它；否则提交完整查询
      if (manualNavRef.current && activeItem) selectItem(activeItem);
      else void runAnswer();
    }
  }

  // 浮层级键盘处理：方向键移动活动结果、Tab 焦点陷阱、Esc 关闭。
  // 统一绑在 panel 上，确保焦点在输入框或结果按钮上时都生效。
  function onPanelKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      manualNavRef.current = true;
      setActiveIndex((i) => (items.length ? (i + 1) % items.length : 0));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      manualNavRef.current = true;
      setActiveIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
      return;
    }
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    event.preventDefault();
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? focusables.indexOf(active) : -1;
    if (event.shiftKey) {
      if (idx <= 0) focusables[focusables.length - 1].focus();
      else focusables[idx - 1].focus();
    } else {
      if (idx === -1 || idx >= focusables.length - 1) focusables[0].focus();
      else focusables[idx + 1].focus();
    }
  }

  const isMac = typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

  return (
    <>
      <button
        ref={triggerRef}
        aria-label="打开搜索"
        className="topbar-search-trigger"
        onClick={openSearch}
        title="搜索（Ctrl/⌘ + K）"
        type="button"
      >
        <Search aria-hidden="true" size={16} />
        <span className="topbar-search-trigger-text">搜索指标、商品，或直接问：8月天猫退款率</span>
        <kbd className="topbar-search-kbd">{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>

      {/* 浮层挂到 body：topbar 带 backdrop-blur 会把 fixed 后代困进自己的层叠上下文，
          不 portal 时主内容区会压在浮层之上（遮挡且拦截点击） */}
      {open && createPortal(
        <div className="global-search-backdrop" onMouseDown={closeSearch}>
          <div
            ref={panelRef}
            aria-modal="true"
            aria-label="全局搜索"
            className="global-search-panel"
            onKeyDown={onPanelKeyDown}
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
          >
            <div className="global-search-input-row">
              <Search aria-hidden="true" className="global-search-input-icon" size={17} />
              <input
                ref={inputRef}
                aria-label="搜索关键词"
                onKeyDown={onInputKeyDown}
                onChange={(e) => { answeredQueryRef.current = null; manualNavRef.current = false; setQuery(e.target.value); }}
                placeholder="搜索指标、商品，或直接问：8月天猫退款率"
                value={query}
              />
              {loading ? <span className="global-search-spinner" aria-label="搜索中" /> : null}
              <button aria-label="关闭搜索" className="global-search-close" onClick={closeSearch} type="button"><X size={16} /></button>
            </div>

            {error ? (
              <div className="global-search-error">{error}</div>
            ) : (
              <>
                {response?.status === "unsupported" ? (
                  <div className="global-search-unsupported">没看懂这个问题，换个说法试试</div>
                ) : null}
                {items.length ? (
              <ul aria-label="搜索结果" className="global-search-list" role="listbox">
                {items.map((item, index) => (
                  <li key={item.key} role="option" aria-selected={index === activeIndex}>
                    <button
                      className={clsx("global-search-item", item.kind === "answer" && "is-answer", index === activeIndex && "is-active")}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectItem(item)}
                      type="button"
                    >
                      <span className="global-search-item-kind">{kindLabel(item.kind)}</span>
                      <span className="global-search-item-copy">
                        <b>{item.title}</b>
                        <small>{item.subtitle}</small>
                        {item.answer ? <AnswerMeta answer={item.answer} /> : null}
                      </span>
                      {item.answer && item.answer.rawValue !== null && item.answer.displayValue ? (
                        <span className="global-search-item-value">{item.answer.displayValue}</span>
                      ) : null}
                      {item.target ? <CornerDownLeft aria-hidden="true" className="global-search-item-enter" size={14} /> : null}
                    </button>
                  </li>
                ))}
              </ul>
                ) : (
                  <div className="global-search-empty">
                    <Sparkles aria-hidden="true" size={18} />
                    <span>输入关键词，或直接问经营问题</span>
                  </div>
                )}
              </>
            )}
            <div className="global-search-footer" aria-hidden="true">
              <span><kbd>↑↓</kbd> 选择</span>
              <span><kbd>Enter</kbd> 打开</span>
              <span><kbd>Esc</kbd> 关闭</span>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function kindLabel(kind: SelectableItem["kind"]) {
  switch (kind) {
    case "answer": return "答案";
    case "section": return "去这里";
    case "metric": return "指标";
    case "entity": return "实体";
    case "clarification": return "选择";
    case "page": return "页面";
    default: return "结果";
  }
}

const DATA_STATE_LABEL: Record<string, string> = {
  fresh: "最新",
  partial: "部分覆盖",
  stale: "已过期",
  missing: "数据缺失",
};

const SOURCE_LABEL: Record<string, string> = {
  dingtalk: "钉钉经营快照",
  warehouse: "本地数仓",
};

// 答案卡元数据：实际统计周期、筛选范围、数据源、更新时间、数据状态
function AnswerMeta({ answer }: { answer: SearchAnswer }) {
  const period = answer.period ? `${answer.period.start} ~ ${answer.period.end}` : null;
  const refreshed = answer.refreshedAt ? new Date(answer.refreshedAt).toLocaleString("zh-CN", { hour12: false }) : null;
  return (
    <span className="global-search-item-meta">
      {period ? <span data-meta="period">周期 {period}</span> : null}
      {answer.scopeLabel ? <span data-meta="scope">{answer.scopeLabel}</span> : null}
      <span data-meta="source">{SOURCE_LABEL[answer.source] ?? answer.source}</span>
      {refreshed ? <span data-meta="refreshed">更新 {refreshed}</span> : null}
      <span data-meta="state" data-state={answer.dataState}>{DATA_STATE_LABEL[answer.dataState] ?? answer.dataState}</span>
    </span>
  );
}