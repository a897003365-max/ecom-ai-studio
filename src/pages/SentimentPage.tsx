import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "../components/Card";
import { MetricCard } from "../components/MetricCard";
import { PageHeader } from "../components/PageHeader";
import { ProgressBar } from "../components/ProgressBar";
import { StatusTag } from "../components/StatusTag";
import { TableShell } from "../components/TableShell";
import {
  getAnalysis,
  getAnalysisStatus,
  getCrawledNotes,
  getCrawlStatus,
  getRelatedKeywords,
  listAnalyses,
  startAnalysis,
  startCrawl,
} from "../services/sentimentApi";
import type {
  RelatedKeyword,
  SentimentAnalysisIndexItem,
  SentimentAnalysisReport,
  SentimentCrawledNote,
  SentimentSeverity,
} from "../types/sentiment";
import type { Tone } from "../types";
import { clsx } from "../utils/format";

interface SentimentPageProps {
  canManage: boolean;
  onAction: (title: string, detail?: string) => void;
}

const severityToneMap: Record<SentimentSeverity, Tone> = { high: "red", medium: "orange", low: "blue" };
const severityLabelMap: Record<SentimentSeverity, string> = { high: "高危", medium: "中危", low: "低危" };
const riskLabelMap: Record<string, string> = { high: "高风险", medium: "中风险", low: "低风险" };
const NOTE_PAGE_SIZE = 15;

function fmt(n: number) {
  return n.toLocaleString("zh-CN");
}

function fmtPublishTime(v?: string | null) {
  if (!v) return "—";
  return v.replace("T", " ").slice(0, 16);
}

function fmtDateTime(v?: string | null) {
  if (!v) return "—";
  return v.replace("T", " ").slice(0, 16);
}

function fmtViews(n: number) {
  if (n >= 10000) return `${Math.round(n / 10000)}万浏览`;
  return `${n}浏览`;
}

// 笔记链接来自外部抓取数据：仅放行 http/https，拦截 javascript:/data: 等可执行 scheme
function isSafeUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** 单选可搜索下拉：模糊匹配关键词子串，聚焦展开、点击选中、点外部关闭。 */
function KeywordCombo({
  value,
  options,
  onChange,
  placeholder = "选择关键词",
  emptyText = "（无选项）",
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
  emptyText?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
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
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [query, options]);

  // 编辑态（含已清空）尊重 query，删空即空；未编辑时回显当前选中值
  const displayValue = editing ? query : value;

  return (
    <div ref={ref} style={{ position: "relative", maxWidth: 280 }} className="w-full">
      <div className="flex items-center gap-2 border rounded-md bg-[var(--panel-solid)] border-[var(--border-2)] focus-within:border-[var(--blue)] px-2.5 py-1.5">
        <input
          value={displayValue}
          onChange={(e) => { setQuery(e.target.value); setEditing(true); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={options.length === 0 ? emptyText : placeholder}
          className="w-full min-w-[60px] bg-transparent text-[13px] text-[var(--text)]"
          style={{ outline: "none" }}
        />
        <span
          className="shrink-0 cursor-pointer select-none text-[10px] text-[var(--muted)]"
          onClick={() => setOpen((o) => !o)}
        >▾</span>
      </div>
      {open && options.length === 0 && (
        <div className="absolute z-10 mt-1 rounded-lg border border-[var(--border-2)] bg-[var(--panel-solid)] px-3 py-2.5 text-[12.5px] text-[var(--muted)] shadow-xl">
          {emptyText}
        </div>
      )}
      {open && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-[260px] w-full overflow-y-auto rounded-lg border border-[var(--border-2)] bg-[var(--panel-solid)] p-1 shadow-xl">
          {filtered.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => { onChange(o); setQuery(""); setEditing(false); setOpen(false); }}
              className={`w-full truncate rounded-md px-2.5 py-1.5 text-left text-[12.5px] ${o === value ? "bg-[var(--blue-bg)] text-[var(--blue)]" : "text-[var(--text)] hover:bg-[var(--bg-elevated)]"}`}
            >
              {o}{o === value ? " ✓" : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- 词云：分词 + 停用词 ----------

const SEGMENTER = new Intl.Segmenter("zh", { granularity: "word" });

const WORD_CLOUD_STOPWORDS = new Set([
  "我们", "你们", "他们", "她们", "它们", "自己", "大家", "什么", "怎么", "为什么", "怎么样", "如何",
  "这个", "那个", "这些", "那些", "这样", "那样", "这里", "那里", "哪个", "哪些",
  "因为", "所以", "但是", "可是", "不过", "虽然", "然后", "还是", "或者", "而且", "并且", "以及", "如果", "既然",
  "已经", "正在", "刚刚", "马上", "现在", "以后", "以前", "时候", "时间", "地方", "东西", "问题", "事情",
  "可以", "应该", "需要", "必须", "能够", "觉得", "感觉", "以为", "知道", "认为", "希望", "喜欢",
  "真的", "非常", "特别", "比较", "稍微", "有点", "有些", "一定", "一样", "一些", "一下", "一直", "一起",
  "上去", "下来", "出来", "起来", "过去", "回来", "过来", "进去", "返回", "点击", "查看", "评论", "转发",
  "没有", "不是", "不能", "不要", "不会", "的话", "一下", "平台", "笔记", "链接", "正文", "作者",
  "发布", "标签", "属地", "标题", "浏览", "搜索", "视频", "图片", "客服", "咨询",
]);

function buildWordCloud(notes: SentimentCrawledNote[], excludeWords: Set<string>) {
  const counter = new Map<string, number>();
  for (const note of notes) {
    if (!note.noteBody) continue;
    const text = note.noteBody.replace(/\[话题\]/g, " ");
    for (const seg of SEGMENTER.segment(text)) {
      if (!seg.isWordLike) continue;
      const word = seg.segment.trim();
      if (word.length < 2 || WORD_CLOUD_STOPWORDS.has(word) || excludeWords.has(word)) continue;
      counter.set(word, (counter.get(word) ?? 0) + 1);
    }
  }
  const words = [...counter.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, 40);
  const counts = words.map(([, count]) => count);
  return { words, min: counts.length ? Math.min(...counts) : 1, max: counts.length ? Math.max(...counts) : 1 };
}

function wordCloudFontSize(count: number, min: number, max: number) {
  if (max <= min) return 18;
  const t = (Math.log(count) - Math.log(min)) / (Math.log(max) - Math.log(min));
  return Math.round(12 + 16 * Math.min(1, Math.max(0, t)));
}

// ---------- 舆论倾向：领域情感词典固定算法（评估结论见 HANDOFF，不接 LLM） ----------
// 打分规则：最长匹配消耗式扫描（避免"骗人"同时命中"骗"的双重计数）；
// 命中前 1~2 字为否定词（不/没/无/毫无/并不…）则该次不计分（"没有异味"不算负面）；
// "无异味/没有异味"等作为显式正面词先被最长匹配消耗；标题命中权重 ×2。

const NEGATIVE_TERMS = [
  "避雷", "踩雷", "后悔", "差评", "退货", "退款", "拔草", "劝退", "别买", "不要买", "千万别买", "避坑",
  "坑", "韭菜", "智商税", "垃圾", "质量差", "太差", "很差", "差劲", "翻车", "破损", "瑕疵",
  "虚假宣传", "虚假", "夸大", "骗", "欺骗", "假货", "山寨", "货不对版", "货不对板", "偷工减料", "减配",
  "异味", "酸臭", "臭味", "味道大", "有味道", "很臭", "刺鼻", "难闻", "甲醛", "超标", "有毒", "头晕", "头疼",
  "塌陷", "凹陷", "塌边", "塌腰", "变形", "起拱", "发霉", "生虫", "虫子", "开线", "断裂", "掉渣",
  "过敏", "瘙痒", "起疹", "湿疹", "腰疼", "腰酸", "脖子疼", "落枕", "睡不好", "越睡越累", "难受",
  "客服态度", "态度差", "不处理", "不退款", "拖延", "推诿", "投诉", "维权", "举报", "售后差", "售后难", "客服敷衍",
  "不推荐", "不好用", "不舒服", "不满意", "不值得", "不建议", "别入手", "退了", "退掉", "换货",
  "白花钱", "浪费钱", "上当", "被坑", "以次充好", "黑心棉", "旧棉", "发黄", "不结实", "软塌塌", "异响", "晃动",
  "有味", "劣质", "次品", "腰突",
];

const POSITIVE_TERMS = [
  "无异味", "没有异味", "没异味", "没味道", "无甲醛", "推荐", "种草", "好用", "好睡", "舒服", "舒适", "满意",
  "超预期", "惊喜", "值得", "性价比", "划算", "回购", "复购", "无限回购", "真香", "安利", "放心", "靠谱",
  "正品", "质量好", "很棒", "点赞", "五星", "好评", "天花板", "闭眼入", "支撑到位", "贴合", "睡得很香",
  "一觉到天亮", "睡得香", "秒睡", "深度睡眠", "强烈推荐", "值得买", "买对了", "选对了", "超值", "爱了", "绝了",
  // 反转句式：先被最长匹配消耗，避免正文里的"塌陷/腰疼/后悔"把好评误判成负面
  "拯救塌陷", "救了我的腰", "解放了腰", "yyds", "后悔没早", "相见恨晚", "早买早享受",
];

interface SentimentTerm {
  term: string;
  negative: boolean;
}

const ALL_SENTIMENT_TERMS: SentimentTerm[] = [
  ...NEGATIVE_TERMS.map((t) => ({ term: t, negative: true })),
  ...POSITIVE_TERMS.map((t) => ({ term: t, negative: false })),
].sort((a, b) => b.term.length - a.term.length);

// 按首字分桶，减少逐位置扫描范围
const TERMS_BY_FIRST_CHAR = new Map<string, SentimentTerm[]>();
for (const t of ALL_SENTIMENT_TERMS) {
  const head = t.term[0];
  if (!TERMS_BY_FIRST_CHAR.has(head)) TERMS_BY_FIRST_CHAR.set(head, []);
  TERMS_BY_FIRST_CHAR.get(head)!.push(t);
}

function isNegatedAt(text: string, index: number) {
  const window = text.slice(Math.max(0, index - 2), index);
  const last = window.slice(-1);
  if (last === "不" || last === "没" || last === "无") return true;
  return ["毫无", "并不", "不太", "没啥", "从未"].some((p) => window.endsWith(p));
}

function scanSentimentText(text: string, weight: number) {
  let neg = 0;
  let pos = 0;
  let i = 0;
  while (i < text.length) {
    const bucket = TERMS_BY_FIRST_CHAR.get(text[i]);
    if (bucket) {
      let matched = false;
      for (const t of bucket) {
        if (text.startsWith(t.term, i)) {
          if (!isNegatedAt(text, i)) {
            if (t.negative) neg += weight;
            else pos += weight;
          }
          i += t.term.length;
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }
    i += 1;
  }
  return { neg, pos };
}

export interface NoteSentiment {
  label: "negative" | "positive" | "neutral";
  neg: number;
  pos: number;
}

function classifyNoteSentiment(note: SentimentCrawledNote): NoteSentiment {
  const title = (note.title ?? "").trim();
  const body = note.noteBody ?? "";
  if (!title && !body) return { label: "neutral", neg: 0, pos: 0 };
  const t = scanSentimentText(title, 2);
  const b = scanSentimentText(body, 1);
  const neg = t.neg + b.neg;
  const pos = t.pos + b.pos;
  if (neg > pos) return { label: "negative", neg, pos };
  if (pos > neg) return { label: "positive", neg, pos };
  return { label: "neutral", neg, pos };
}

const sentimentLabelMap: Record<NoteSentiment["label"], string> = { negative: "负面", positive: "正面", neutral: "中性" };
const sentimentToneMap: Record<NoteSentiment["label"], Tone> = { negative: "red", positive: "green", neutral: "muted" };

interface CrawlModal {
  open: boolean;
  keywords: string[];
  keywordIndex: number;
  phase: "searching" | "filling" | "done" | "error";
  total: number;
  ok: number;
  failed: number;
  message?: string;
}

const emptyCrawl: CrawlModal = { open: false, keywords: [], keywordIndex: 0, phase: "searching", total: 0, ok: 0, failed: 0 };

export function SentimentPage({ canManage, onAction }: SentimentPageProps) {
  const [libNotes, setLibNotes] = useState<SentimentCrawledNote[]>([]);
  const [reports, setReports] = useState<SentimentAnalysisIndexItem[]>([]);
  const [currentReport, setCurrentReport] = useState<SentimentAnalysisReport | null>(null);
  const [starting, setStarting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wfInput, setWfInput] = useState("");
  const [wfEmpty, setWfEmpty] = useState(false);
  const [kwLoading, setKwLoading] = useState(false);
  const [wfError, setWfError] = useState<string | null>(null);
  const [relatedKws, setRelatedKws] = useState<RelatedKeyword[]>([]);
  const [selectedKws, setSelectedKws] = useState<Set<string>>(new Set());
  const [crawlStarting, setCrawlStarting] = useState(false);
  const [crawl, setCrawl] = useState<CrawlModal>(emptyCrawl);
  const [wcKeyword, setWcKeyword] = useState("");
  const [noteQuery, setNoteQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [bodyModal, setBodyModal] = useState<{ title: string; body: string; truncated: boolean } | null>(null);
  const [analyzeKeyword, setAnalyzeKeyword] = useState("");
  const [showAnalyzeModal, setShowAnalyzeModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const crawlTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadLibrary = useCallback(() => {
    getCrawledNotes()
      .then((payload) => setLibNotes(payload.notes))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const loadReports = useCallback((selectId?: string) => {
    listAnalyses()
      .then((payload) => {
        setReports(payload.items);
        const target = selectId ? payload.items.find((r) => r.id === selectId) : payload.items[0];
        if (target) {
          return getAnalysis(target.id).then(setCurrentReport);
        }
        if (!selectId) setCurrentReport(null);
        return undefined;
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    loadLibrary();
    loadReports();
  }, [loadLibrary, loadReports]);

  const stopCrawlPolling = useCallback(() => {
    if (crawlTimerRef.current) {
      clearInterval(crawlTimerRef.current);
      crawlTimerRef.current = null;
    }
  }, []);

  useEffect(() => stopCrawlPolling, [stopCrawlPolling]);

  const startCrawlPolling = useCallback(() => {
    stopCrawlPolling();
    crawlTimerRef.current = setInterval(() => {
      getCrawlStatus()
        .then((s) => {
          setCrawl((prev) => {
            if (prev.phase !== "searching" && prev.phase !== "filling") return prev;
            if (!s.running) {
              return {
                ...prev,
                phase: "done",
                keywordIndex: s.keywordIndex,
                total: s.total,
                ok: s.ok,
                failed: s.failed,
                message: s.errors.length ? s.errors.join("；") : undefined,
              };
            }
            return {
              ...prev,
              phase: s.phase === "filling" ? "filling" : "searching",
              keywordIndex: s.keywordIndex,
              total: s.total,
              ok: s.ok,
              failed: s.failed,
            };
          });
          if (!s.running) {
            stopCrawlPolling();
            loadLibrary();
          }
        })
        .catch(() => undefined);
    }, 2000);
  }, [stopCrawlPolling, loadLibrary]);

  const handleGetRelated = useCallback(async () => {
    if (!wfInput.trim() || kwLoading) return;
    const seed = wfInput.trim();
    setKwLoading(true);
    setWfError(null);
    setWfEmpty(false);
    try {
      const { items } = await getRelatedKeywords(seed);
      const rest = items.filter((i) => i.name !== seed);
      setRelatedKws([{ name: seed, viewNum: null }, ...rest]);
      setSelectedKws(new Set([seed]));
      onAction("相关关键词已返回", `共 ${rest.length + 1} 个候选，点击选择后批量抓取`);
      if (!items.length) setWfEmpty(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setWfError(msg);
      onAction("获取相关关键词失败", msg);
    } finally {
      setKwLoading(false);
    }
  }, [wfInput, kwLoading, onAction]);

  const toggleKw = useCallback((name: string) => {
    setSelectedKws((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleCrawlSelected = useCallback(async () => {
    const keywords = [...selectedKws];
    if (!keywords.length || crawlStarting) return;
    setCrawlStarting(true);
    setWfError(null);
    setCrawl({ open: true, keywords, keywordIndex: 0, phase: "searching", total: 0, ok: 0, failed: 0 });
    try {
      await startCrawl(keywords);
      onAction("抓取已启动", `已选 ${keywords.length} 个关键词，服务端顺序搜索并抓取正文`);
      startCrawlPolling();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = (e as { status?: number }).status;
      // 409 一律视为「已有任务在进行」挂接轮询，不依赖错误文案（响应体异常时也能恢复）
      if (status === 409 || msg.includes("正在进行中")) {
        startCrawlPolling();
        setCrawl((prev) => ({ ...prev, phase: "searching" }));
      } else {
        setWfError(msg);
        setCrawl((prev) => ({ ...prev, phase: "error", message: msg }));
        onAction("抓取失败", msg);
      }
    } finally {
      setCrawlStarting(false);
    }
  }, [selectedKws, crawlStarting, onAction, startCrawlPolling]);

  const handleStart = useCallback(async () => {
    setShowAnalyzeModal(false);
    if (!canManage) {
      onAction("当前账号无分析权限", "请联系管理员开通「竞品情报」执行权限");
      return;
    }
    if (!analyzeKeyword) return;
    setStarting(true);
    setError(null);
    try {
      const started = await startAnalysis(analyzeKeyword, dateFrom, dateTo);
      onAction("舆情分析已启动", `关键词「${analyzeKeyword}」· ${started.noteCount} 条笔记进入 LLM 综合`);
      setAnalyzing(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onAction("舆情分析启动失败", msg);
    } finally {
      setStarting(false);
    }
  }, [canManage, analyzeKeyword, dateFrom, dateTo, onAction]);

  // 分析轮询：done 后加载新报告，error 后展示原因
  useEffect(() => {
    if (!analyzing) return;
    const timer = setInterval(() => {
      getAnalysisStatus()
        .then((s) => {
          if (s.status === "running") return;
          clearInterval(timer);
          setAnalyzing(false);
          if (s.status === "done" && s.reportId) {
            loadReports(s.reportId);
            onAction("舆情分析完成", "报告已存入历史记录");
          } else if (s.status === "error") {
            setError(s.error ?? "分析失败");
            onAction("舆情分析失败", s.error ?? "未知错误");
          }
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [analyzing, loadReports, onAction]);

  const selectReport = useCallback(
    (id: string) => {
      getAnalysis(id)
        .then((report) => {
          setCurrentReport(report);
          setShowHistoryModal(false);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    },
    []
  );

  const keywordOptions = useMemo(() => {
    const set = new Set<string>();
    libNotes.forEach((n) => { if (n.keyword) set.add(n.keyword); });
    return Array.from(set);
  }, [libNotes]);

  // 词云关键词：默认跟随当前报告，用户切换后保持
  useEffect(() => {
    if (wcKeyword && keywordOptions.includes(wcKeyword)) return;
    const preferred = currentReport?.keyword ?? "";
    setWcKeyword(keywordOptions.includes(preferred) ? preferred : (keywordOptions[0] ?? ""));
  }, [wcKeyword, keywordOptions, currentReport]);

  const wordCloud = useMemo(() => {
    if (!wcKeyword) return { words: [] as Array<[string, number]>, min: 1, max: 1 };
    const notes = libNotes.filter((n) => n.keyword === wcKeyword && n.noteBody);
    const exclude = new Set<string>();
    for (const seg of SEGMENTER.segment(wcKeyword)) {
      const token = seg.segment.trim();
      if (token) exclude.add(token);
    }
    return buildWordCloud(notes, exclude);
  }, [libNotes, wcKeyword]);

  const sentimentMap = useMemo(() => {
    const m = new Map<string, NoteSentiment>();
    for (const n of libNotes) m.set(`${n.noteId}|${n.keyword}`, classifyNoteSentiment(n));
    return m;
  }, [libNotes]);

  // KPI 五卡口径：跟随舆情词云下拉选中的关键词；高风险 = 舆论倾向判为负面
  const kpi = useMemo(() => {
    const notes = libNotes.filter((n) => n.keyword === wcKeyword);
    let highRisk = 0;
    let totalEngagement = 0;
    let highRiskEngagement = 0;
    for (const n of notes) {
      const eng = n.liked + n.comment + n.collected + n.shared;
      totalEngagement += eng;
      if (sentimentMap.get(`${n.noteId}|${n.keyword}`)?.label === "negative") {
        highRisk += 1;
        highRiskEngagement += eng;
      }
    }
    const total = notes.length;
    return {
      total,
      highRisk,
      highRiskPct: total ? ((highRisk / total) * 100).toFixed(1) : "0.0",
      totalEngagement,
      highRiskEngagement,
      highRiskEngPct: totalEngagement ? ((highRiskEngagement / totalEngagement) * 100).toFixed(1) : "0.0",
    };
  }, [libNotes, wcKeyword, sentimentMap]);

  const toggleSort = useCallback((key: string) => {
    setSortKey((prevKey) => {
      if (prevKey !== key) {
        setSortDir(key === "keyword" || key === "author" ? "asc" : "desc");
        return key;
      }
      setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
      return prevKey;
    });
  }, []);

  const tableNotes = useMemo(() => {
    const q = noteQuery.trim().toLowerCase();
    const filtered = q
      ? libNotes.filter((n) =>
          [n.title, n.author, n.keyword, n.noteBody, n.url, n.publishTime ?? ""]
            .some((f) => typeof f === "string" && f.toLowerCase().includes(q))
        )
      : libNotes;
    let rows = filtered;
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      const value = (n: SentimentCrawledNote): string | number => {
        switch (sortKey) {
          case "keyword": return n.keyword ?? "";
          case "author": return n.author ?? "";
          case "publishTime": return n.publishTime ?? "";
          case "crawledAt": return n.crawledAt ?? "";
          case "sentiment": {
            const s = sentimentMap.get(`${n.noteId}|${n.keyword}`);
            return s ? s.neg - s.pos : 0;
          }
          default: return Number(n[sortKey as "liked" | "comment" | "collected" | "shared"] ?? 0);
        }
      };
      rows = [...filtered].sort((a, b) => {
        const va = value(a);
        const vb = value(b);
        if (typeof va === "string" || typeof vb === "string") {
          return String(va).localeCompare(String(vb), "zh-CN") * dir;
        }
        return (va - vb) * dir;
      });
    } else {
      // 默认：舆情词云下拉选中的关键词优先透出，其余按库序
      rows = [...filtered.filter((n) => n.keyword === wcKeyword), ...filtered.filter((n) => n.keyword !== wcKeyword)];
    }
    return { rows, total: libNotes.length };
  }, [libNotes, noteQuery, sortKey, sortDir, wcKeyword, sentimentMap]);

  // 筛选/排序条件变化时回到第一页
  useEffect(() => {
    setPage(1);
  }, [noteQuery, sortKey, sortDir, wcKeyword]);

  // 分页派生：每页 NOTE_PAGE_SIZE 行
  const totalPages = Math.max(1, Math.ceil(tableNotes.rows.length / NOTE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = tableNotes.rows.slice((safePage - 1) * NOTE_PAGE_SIZE, safePage * NOTE_PAGE_SIZE);

  const renderSortTh = (key: string, label: string) => (
    <button
      type="button"
      className={clsx("th-sort", sortKey === key && "active")}
      onClick={() => toggleSort(key)}
      title={sortKey === key ? (sortDir === "asc" ? "点击改为降序" : "点击改为升序") : "点击排序"}
    >
      {label}
      <span className="th-sort-ind">{sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
    </button>
  );

  const result = currentReport?.result ?? null;
  const topNote = useMemo(() => {
    if (!currentReport) return null;
    const ids = new Set(currentReport.noteIds);
    const matched = libNotes.filter((n) => ids.has(n.noteId));
    if (!matched.length) return null;
    return [...matched].sort((a, b) => (b.liked + b.comment) - (a.liked + a.comment))[0];
  }, [currentReport, libNotes]);

  return (
    <div data-ui="sentiment-page">
      <PageHeader title="小红书舆情分析" />

      <Card className="mb-5" dataUi="workflow-search">
        <div className="workflow-search-bar">
          <input
            type="text"
            className="workflow-search-input"
            value={wfInput}
            onChange={(e) => setWfInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                void handleGetRelated();
              }
            }}
            placeholder="输入关键词获取相关小红书话题…（Ctrl+Enter 执行）"
            disabled={kwLoading}
          />
          <button className="btn btn-primary" onClick={() => void handleGetRelated()} disabled={kwLoading || !wfInput.trim()} type="button">
            {kwLoading ? <span className="workflow-spinner" /> : "获取相关关键词"}
          </button>
        </div>
        {wfError && (
          <div className="workflow-error mt-3">
            <span className="workflow-error-icon">⚠</span>
            {wfError}
          </div>
        )}
        {wfEmpty && !kwLoading && (
          <div className="workflow-error mt-2">
            <span className="workflow-error-icon">⚠</span>
            工作流已返回，但未解析出相关关键词；请换一个关键词重试
          </div>
        )}
        {relatedKws.length > 0 && (
          <div className="related-kw-panel mt-3">
            <div className="related-kw-chips">
              {relatedKws.map((kw) => (
                <button
                  key={kw.name}
                  type="button"
                  className={clsx("related-kw-chip", selectedKws.has(kw.name) && "selected")}
                  onClick={() => toggleKw(kw.name)}
                  title={kw.viewNum ? `${kw.viewNum.toLocaleString("zh-CN")} 次浏览` : "输入的原始关键词"}
                >
                  <span className="related-kw-name">{kw.name}</span>
                  {kw.viewNum != null && kw.viewNum > 0 && <span className="related-kw-views">{fmtViews(kw.viewNum)}</span>}
                </button>
              ))}
            </div>
            <div className="related-kw-actions">
              <span className="related-kw-count">已选 {selectedKws.size} 个关键词</span>
              <button className="btn" type="button" onClick={() => setSelectedKws(new Set())} disabled={!selectedKws.size}>清空选择</button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void handleCrawlSelected()}
                disabled={!selectedKws.size || crawlStarting}
              >
                {crawlStarting ? "启动中…" : `抓取所选（${selectedKws.size}）`}
              </button>
            </div>
          </div>
        )}
      </Card>

      {error && (
        <Card className="mb-4 border-[var(--red)]/40 bg-[var(--red)]/10">
          <p className="text-[13px] leading-relaxed text-[var(--red)]">{error}</p>
        </Card>
      )}

      {analyzing && (
        <Card className="mb-4" dataUi="sentiment-analyzing">
          <div className="flex items-center gap-3 text-[13px]">
            <span className="workflow-spinner" />
            正在调用 LLM 综合分析（通常 10~60 秒），完成后自动展示报告并存入历史…
          </div>
        </Card>
      )}

      <div className="metric-grid mb-5">
        <MetricCard
          metric={{
            label: "分析笔记数",
            value: String(kpi.total),
            detail: `关键词「${wcKeyword || "—"}」（跟随舆情词云下拉）`,
            tone: "blue",
          }}
        />
        <MetricCard
          metric={{
            label: "高风险笔记数",
            value: String(kpi.highRisk),
            detail: "舆论倾向判为负面的笔记",
            tone: "red",
          }}
        />
        <MetricCard
          metric={{
            label: "高风险占比",
            value: `${kpi.highRiskPct}%`,
            detail: `高风险 ${kpi.highRisk} / ${kpi.total} 条`,
            tone: "orange",
          }}
        />
        <MetricCard
          metric={{
            label: "总互动量",
            value: fmt(kpi.totalEngagement),
            detail: "赞 + 评论 + 收藏 + 转发",
            tone: "purple",
          }}
        />
        <MetricCard
          metric={{
            label: "高风险互动量占比",
            value: `${kpi.highRiskEngPct}%`,
            detail: `高风险笔记互动 ${fmt(kpi.highRiskEngagement)} / ${fmt(kpi.totalEngagement)}`,
            tone: "red",
          }}
        />
      </div>

      <Card title="舆情词云" className="mb-5" dataUi="sentiment-wordcloud">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <KeywordCombo
            value={wcKeyword}
            options={keywordOptions}
            onChange={setWcKeyword}
            placeholder="搜索并选择关键词…"
            emptyText="（笔记库为空）"
          />
          <span className="text-[12px] text-[var(--muted)]">
            词频取自该关键词下笔记正文（出现 ≥2 次，Top 40，已滤停用词与关键词本身）；点击词可在下方明细表过滤
          </span>
        </div>
        {wordCloud.words.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-[var(--muted)]">
            {wcKeyword ? `「${wcKeyword}」下还没有可统计的笔记正文，先抓取该关键词的笔记` : "笔记库为空，先在上方抓取笔记"}
          </p>
        ) : (
          <div className="word-cloud">
            {wordCloud.words.map(([word, count], i) => (
              <button
                key={word}
                type="button"
                className={clsx("word-cloud-word", i < 3 ? "tier-top" : i < 10 ? "tier-hot" : "tier-normal")}
                style={{ fontSize: wordCloudFontSize(count, wordCloud.min, wordCloud.max) }}
                title={`出现 ${count} 次`}
                onClick={() => setNoteQuery(word)}
              >
                {word}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card title="监控笔记明细" dataUi="sentiment-notes-table">
        <div className="notes-table-toolbar">
          <input
            type="text"
            className="workflow-search-input notes-table-search"
            value={noteQuery}
            onChange={(e) => setNoteQuery(e.target.value)}
            placeholder="模糊搜索：标题 / 作者 / 关键词 / 正文 / 发布时间…"
          />
          {noteQuery.trim() && (
            <span className="notes-table-count">
              匹配 {tableNotes.rows.length} / {tableNotes.total} 条
              <button className="notes-table-clear" onClick={() => setNoteQuery("")} type="button">清除</button>
            </span>
          )}
        </div>
        <TableShell minWidth={1650}>
          <thead>
            <tr>
              <th style={{ width: 44 }}>#</th>
              <th>笔记标题</th>
              <th style={{ width: 200 }}>正文预览</th>
              <th style={{ width: 120 }}>{renderSortTh("keyword", "关键词")}</th>
              <th style={{ width: 140 }}>{renderSortTh("author", "作者")}</th>
              <th style={{ width: 110 }}>小红书号</th>
              <th style={{ width: 130 }}>{renderSortTh("publishTime", "发布时间")}</th>
              <th style={{ width: 70 }}>{renderSortTh("liked", "赞")}</th>
              <th style={{ width: 70 }}>{renderSortTh("comment", "评论")}</th>
              <th style={{ width: 70 }}>{renderSortTh("collected", "收藏")}</th>
              <th style={{ width: 70 }}>{renderSortTh("shared", "转发")}</th>
              <th style={{ width: 90 }}>{renderSortTh("sentiment", "舆论倾向")}</th>
              <th style={{ width: 120 }}>{renderSortTh("crawledAt", "抓取时间")}</th>
              <th style={{ width: 110 }}>抓取状态</th>
            </tr>
          </thead>
          <tbody>
            {tableNotes.rows.length === 0 && noteQuery.trim() ? (
              <tr>
                <td colSpan={14} className="py-6 text-center text-[13px] text-[var(--muted)]">
                  没有匹配「{noteQuery.trim()}」的笔记，换个关键词试试
                </td>
              </tr>
            ) : tableNotes.rows.length === 0 ? (
              <tr>
                <td colSpan={14} className="py-6 text-center text-[13px] text-[var(--muted)]">
                  笔记库为空；在上方搜索栏输入关键词抓取第一批笔记
                </td>
              </tr>
            ) : pageRows.map((note, i) => {
              const s = sentimentMap.get(`${note.noteId}|${note.keyword}`);
              return (
              <tr key={note.noteId + (note.keyword ?? "") + i}>
                <td className="text-[var(--muted-2)]">{(safePage - 1) * NOTE_PAGE_SIZE + i + 1}</td>
                <td>
                  {isSafeUrl(note.url) ? (
                    <a href={note.url} target="_blank" rel="noreferrer" className="text-[var(--blue)] hover:underline">
                      {note.title || "(无标题)"}
                    </a>
                  ) : (
                    <span>{note.title || "(无标题)"}</span>
                  )}
                </td>
                <td className="text-[12px]">
                  {note.noteBody ? (
                    <button
                      className="note-body-link"
                      onClick={() => setBodyModal({ title: note.title, body: note.noteBody ?? "", truncated: false })}
                      title="点击查看完整正文"
                      type="button"
                    >
                      {note.noteBody.slice(0, 80) + (note.noteBody.length > 80 ? "…" : "")}
                    </button>
                  ) : (
                    <span className="text-[var(--muted)]">—</span>
                  )}
                </td>
                <td className="text-[var(--muted)]">{note.keyword ?? "—"}</td>
                <td className="text-[var(--muted)]">{note.author}</td>
                <td className="text-[var(--muted)] text-[12px]">{note.redId ?? "—"}</td>
                <td className="text-[var(--muted)] text-[12px]" title={note.publishTime ?? ""}>{fmtPublishTime(note.publishTime)}</td>
                <td>{fmt(note.liked)}</td>
                <td>{fmt(note.comment)}</td>
                <td>{fmt(note.collected)}</td>
                <td>{fmt(note.shared)}</td>
                <td>
                  <span title={s ? `负面词 ${s.neg} 次 · 正面词 ${s.pos} 次（词典算法）` : "无正文，按中性处理"}>
                    <StatusTag label={sentimentLabelMap[s?.label ?? "neutral"]} tone={sentimentToneMap[s?.label ?? "neutral"]} />
                  </span>
                </td>
                <td className="text-[var(--muted)] text-[12px]">
                  {note.crawledAt ? new Date(note.crawledAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                </td>
                <td>
                  {note.detailState === "ok" ? (
                    <StatusTag label={`成功 ${note.bodyLength} 字`} tone="green" />
                  ) : note.detailState === "failed" ? (
                    <StatusTag label="失败" tone="red" />
                  ) : (
                    <StatusTag label="待抓取" tone="muted" />
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </TableShell>
        {tableNotes.rows.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[12px] text-[var(--muted)]">
              共 {tableNotes.rows.length} 条 · 第 {safePage} / {totalPages} 页（每页 {NOTE_PAGE_SIZE} 条）
            </span>
            <div className="flex items-center gap-2">
              <button className="btn" type="button" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</button>
              <button className="btn" type="button" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>下一页</button>
            </div>
          </div>
        )}
      </Card>

      {/* 操作条：舆情摘要上方 */}
      <div className="mb-5 flex flex-wrap items-center justify-end gap-2">
        <button className="btn" onClick={() => setShowHistoryModal(true)} type="button">
          历史笔记分析{reports.length ? `（${reports.length}）` : ""}
        </button>
        <button className="btn btn-primary" disabled={starting || analyzing} onClick={() => setShowAnalyzeModal(true)} type="button">
          {analyzing ? "分析进行中…" : starting ? "启动中…" : "开始舆情分析"}
        </button>
      </div>

      {result && currentReport ? (
        <>
          <Card title="舆情摘要" className="mb-5" dataUi="sentiment-summary">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusTag label={riskLabelMap[result.riskLevel] ?? "中风险"} tone={severityToneMap[result.riskLevel]} dot pulse />
              <span className="text-[12px] text-[var(--muted-2)]">
                {currentReport.keyword} · 生成于 {fmtDateTime(currentReport.createdAt)}
                {currentReport.period?.from || currentReport.period?.to
                  ? ` · 发布时间 ${currentReport.period.from ?? "…"} ~ ${currentReport.period.to ?? "…"}`
                  : ""}
              </span>
              {result.keywords.map((kw) => (
                <span key={kw} className="tag tag-blue">{kw}</span>
              ))}
            </div>
            <p className="text-[13.5px] leading-[1.8] text-[var(--text)]">{result.summary}</p>
            {topNote ? (
              <p className="mt-3 text-[12px] text-[var(--muted-2)]">
                声量最高笔记：《{topNote.title}》（{topNote.author}）· 赞 {fmt(topNote.liked)} / 评 {fmt(topNote.comment)}
              </p>
            ) : null}
          </Card>

          <div className="mb-5 grid gap-5 xl:grid-cols-2">
            <Card title="问题点分析" dataUi="sentiment-problems">
              <div className="flex flex-col gap-4">
                {result.problemPoints.map((point, i) => (
                  <div key={i} className={clsx("rounded-xl border border-white/5 bg-[var(--muted)]/8 p-4", point.severity === "high" && "border-[var(--red)]/30")}>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <StatusTag label={severityLabelMap[point.severity]} tone={severityToneMap[point.severity]} dot />
                      <b className="text-[13.5px]">{point.title}</b>
                      {point.mentionCount > 0 && <span className="text-[11px] text-[var(--muted-2)]">涉及 {point.mentionCount} 条笔记</span>}
                    </div>
                    <p className="text-[12.5px] leading-[1.8] text-[var(--muted)]">{point.detail}</p>
                    {point.evidence.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {point.evidence.map((ev, j) => (
                          <span key={j} className="tag tag-blue">证据：{ev}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>

            <Card title="改善建议" dataUi="sentiment-suggestions">
              <div className="flex flex-col gap-4">
                {result.suggestions.map((s, i) => (
                  <div key={i} className={clsx("rounded-xl border border-white/5 bg-[var(--muted)]/8 p-4", s.priority === "high" && "border-[var(--green)]/30")}>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <StatusTag label={s.priority === "high" ? "高优先级" : s.priority === "medium" ? "中优先级" : "低优先级"} tone={s.priority === "high" ? "green" : s.priority === "medium" ? "blue" : "muted"} dot />
                      <b className="text-[13.5px]">{s.title}</b>
                    </div>
                    <p className="text-[12.5px] leading-[1.8] text-[var(--muted)]">{s.detail}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      ) : !analyzing ? (
        <Card className="mb-5" dataUi="sentiment-empty">
          <div className="py-8 text-center">
            <p className="text-[14px] font-medium">尚未生成舆情分析</p>
            <p className="mx-auto mt-2 max-w-xl text-[12.5px] leading-relaxed text-[var(--muted)]">
              在上方搜索栏输入关键词抓取笔记，正文抓取完成后点击「开始舆情分析」，
              由 LLM 汇总生成负面舆情的问题点分析与改善建议；历史报告可通过「历史笔记分析」翻查。
            </p>
          </div>
        </Card>
      ) : null}

      {showAnalyzeModal && (
        <div className="analyze-modal-overlay" onClick={() => setShowAnalyzeModal(false)}>
          <div className="analyze-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="analyze-modal-title">分析筛选</h3>
            <div className="analyze-modal-body">
              <div className="analyze-modal-field">
                <label className="analyze-modal-label">分析关键词</label>
                <select
                  className="analyze-modal-select"
                  value={analyzeKeyword}
                  onChange={(e) => setAnalyzeKeyword(e.target.value)}
                  disabled={starting || analyzing}
                >
                  <option value="">请选择关键词</option>
                  {keywordOptions.map((kw) => (
                    <option key={kw} value={kw}>{kw}</option>
                  ))}
                </select>
                {keywordOptions.length === 0 && (
                  <p className="analyze-modal-hint">笔记库为空，请先在上方搜索栏抓取笔记</p>
                )}
              </div>
              <div className="analyze-modal-field">
                <label className="analyze-modal-label">笔记发布时间范围</label>
                <div className="analyze-modal-date-row">
                  <input
                    type="date"
                    className="analyze-modal-date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    disabled={starting || analyzing}
                  />
                  <span className="analyze-modal-sep">~</span>
                  <input
                    type="date"
                    className="analyze-modal-date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    disabled={starting || analyzing}
                  />
                </div>
                {(dateFrom || dateTo) && (
                  <button className="analyze-modal-clear" onClick={() => { setDateFrom(""); setDateTo(""); }} type="button">清除时间</button>
                )}
              </div>
              <p className="analyze-modal-hint">分析对象：笔记库中该关键词下正文抓取成功的笔记，按发布时间筛选</p>
            </div>
            <div className="analyze-modal-footer">
              <button className="btn" onClick={() => setShowAnalyzeModal(false)} type="button">取消</button>
              <button
                className="btn btn-primary"
                onClick={() => void handleStart()}
                disabled={starting || analyzing || !analyzeKeyword}
                type="button"
              >
                {starting ? "启动中…" : "开始分析"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showHistoryModal && (
        <div className="analyze-modal-overlay" onClick={() => setShowHistoryModal(false)}>
          <div className="analyze-modal history-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="analyze-modal-title">历史笔记分析</h3>
            <div className="analyze-modal-body">
              {reports.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-[var(--muted)]">还没有历史分析记录</p>
              ) : (
                <div className="history-report-list">
                  {reports.map((r) => (
                    <button
                      key={r.id}
                      className={clsx("history-report-item", currentReport?.id === r.id && "active")}
                      onClick={() => selectReport(r.id)}
                      type="button"
                    >
                      <div className="history-report-main">
                        <span className="history-report-keyword">「{r.keyword}」</span>
                        <span className="history-report-meta">
                          {fmtDateTime(r.createdAt)} · {r.noteCount} 条笔记 · {r.problemCount} 个问题点
                        </span>
                      </div>
                      <StatusTag label={riskLabelMap[r.riskLevel] ?? "中风险"} tone={severityToneMap[r.riskLevel]} dot />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="analyze-modal-footer">
              <button className="btn btn-primary" onClick={() => setShowHistoryModal(false)} type="button">关闭</button>
            </div>
          </div>
        </div>
      )}

      {crawl.open && (
        <div className="analyze-modal-overlay" onClick={() => { if (crawl.phase !== "searching") setCrawl((prev) => ({ ...prev, open: false })); }}>
          <div className="analyze-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="analyze-modal-title">笔记抓取进度</h3>
            <div className="analyze-modal-body">
              <p className="text-[13px] text-[var(--muted)]">已选关键词（{crawl.keywords.length}）：{crawl.keywords.join("、")}</p>
              {crawl.phase === "searching" && (
                <div className="mt-3">
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="workflow-spinner" />
                    正在获取第 {Math.min(Math.max(crawl.keywordIndex, 1), crawl.keywords.length)}/{crawl.keywords.length} 个关键词的笔记列表…
                  </div>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--muted)]">
                    搜索到的笔记会先写入笔记库（待抓取态），全部关键词搜索完后统一补抓正文。
                  </p>
                </div>
              )}
              {crawl.phase === "filling" && (
                <div className="mt-3">
                  <ProgressBar
                    value={crawl.total ? Math.round(((crawl.ok + crawl.failed) / crawl.total) * 100) : 0}
                    label={`正文抓取 ${crawl.ok + crawl.failed}/${crawl.total}（成功 ${crawl.ok} · 失败 ${crawl.failed}），服务端并发 2、批次间隔 3s`}
                    striped
                  />
                  <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--muted)]">
                    笔记已先写入下方明细表，正文由服务端抓取并逐批落盘；关闭弹窗或刷新页面不会中断。
                  </p>
                </div>
              )}
              {crawl.phase === "done" && (
                <div className="mt-3">
                  {crawl.total > 0 ? (
                    <p className="text-[13px] leading-relaxed">
                      抓取完成：{crawl.keywords.length} 个关键词共 {crawl.total} 条笔记，正文成功 {crawl.ok} 条、失败 {crawl.failed} 条，结果已写入笔记库。
                    </p>
                  ) : (
                    <p className="text-[13px] leading-relaxed">搜索完成，但没有解析出新笔记（已抓取过的关键词不会重复抓正文）。</p>
                  )}
                  {crawl.message && (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--orange, orange)]">部分关键词失败：{crawl.message}</p>
                  )}
                </div>
              )}
              {crawl.phase === "error" && (
                <p className="mt-3 text-[13px] leading-relaxed text-[var(--red)]">抓取失败：{crawl.message}</p>
              )}
            </div>
            {crawl.phase !== "searching" && (
              <div className="analyze-modal-footer">
                <button className="btn btn-primary" onClick={() => setCrawl((prev) => ({ ...prev, open: false }))} type="button">
                  {crawl.phase === "filling" ? "后台运行" : "知道了"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {bodyModal && (
        <div className="analyze-modal-overlay" onClick={() => setBodyModal(null)}>
          <div className="analyze-modal note-body-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="analyze-modal-title">笔记正文</h3>
            <div className="analyze-modal-body">
              <p className="text-[13px] font-medium">{bodyModal.title || "(无标题)"}</p>
              <pre className="note-body-text">{bodyModal.body}</pre>
            </div>
            <div className="analyze-modal-footer">
              <button className="btn btn-primary" onClick={() => setBodyModal(null)} type="button">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
