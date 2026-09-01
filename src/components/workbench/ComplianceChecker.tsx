import { useMemo, useState } from "react";
import { BANNED } from "../../data/copyWorkbench";
import type { ComplianceHit } from "../../types/copyWorkbench";

interface ComplianceCheckerProps {
  onCheck: (text: string) => { hits: ComplianceHit[]; cleaned: string };
  onAutoFix: (text: string) => string;
  onAction: (title: string, detail?: string) => void;
}

const SAMPLE_TEXT = "这款床垫0胶水、不含甲醛，护脊效果一流，绝对能完美解决你的腰痛问题！全网最低价，清仓搬家最后一天，错过再等一年！";

export function ComplianceChecker({ onCheck, onAutoFix, onAction }: ComplianceCheckerProps) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ hits: ComplianceHit[]; marked: string } | null>(null);

  const marked = useMemo(() => {
    if (!result) return "";
    return result.marked;
  }, [result]);

  function runCheck(auto: boolean) {
    const source = auto ? onAutoFix(text) : text;
    if (auto && source !== text) {
      setText(source);
      onAction("已按建议替换高危词", "请人工复核替换结果");
    }
    markResult(source);
  }

  function markResult(source: string) {
    const { hits } = onCheck(source);
    // XSS 安全：先整体转义文本，再把转义后的命中词包进 <mark>；
    // 注入到 DOM 的原生标签只有开发者的 <mark>，用户内容一律保持转义态。
    let html = escapeHtml(source);
    for (const banned of BANNED) {
      if (source.includes(banned.w)) {
        html = html.split(escapeHtml(banned.w)).join(`<mark>${escapeHtml(banned.w)}</mark>`);
      }
    }
    setResult({ hits, marked: html });
  }

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-[15px] font-bold">千川合规检查</h3>
        <div className="mt-0.5 text-[11px] text-[var(--muted)]">依据《千川禁用词与合规替换》整理的高危词库，粘贴文案即时标红并给出替换建议</div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="card !p-4">
          <div className="mb-2 text-[13px] font-bold">待检查文案</div>
          <textarea
            className="field !min-h-[180px]"
            rows={9}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="粘贴文案全文，点击「开始检查」…"
          />
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => runCheck(false)} type="button">开始检查</button>
            <button className="btn" onClick={() => runCheck(true)} type="button">一键按建议替换</button>
            <button className="btn" onClick={() => setText(SAMPLE_TEXT)} type="button">载入示例</button>
          </div>
        </section>

        <section className="card !p-4">
          <div className="mb-2 text-[13px] font-bold">检查结果</div>
          {!result ? (
            <div className="min-h-[180px] rounded-[5px] border border-[var(--border)] bg-white/[0.02] px-3 py-3 text-xs leading-[1.9] text-[var(--muted)]">
              尚未检查。
            </div>
          ) : (
            <>
              <div
                className="min-h-[180px] rounded-[5px] border border-[var(--border)] bg-white/[0.02] px-3 py-3 text-[13px] leading-[1.9]"
                dangerouslySetInnerHTML={{ __html: marked }}
              />
              <div className="mt-2.5 grid gap-1.5">
                {result.hits.length === 0 ? (
                  <div className="flex items-center gap-2 text-[13px] text-[var(--green)]">
                    <span>✓</span> 未命中内置高危词库。注意：试睡天数/价格/赠品等口径仍需以直播间页面实时为准。
                  </div>
                ) : (
                  result.hits.map((hit) => (
                    <div className="flex items-center gap-2 rounded-[5px] border border-[var(--border)] bg-white/[0.02] px-2.5 py-2 text-xs" key={hit.w}>
                      <span className="whitespace-nowrap font-bold text-[var(--red)]">{hit.w} ×{hit.n}</span>
                      <span className="text-[var(--muted)]">{hit.s}</span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}
