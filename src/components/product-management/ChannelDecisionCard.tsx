// 渠道质量决策卡 · 取代原 callout
// 消费 scoreChannelHealth 的 ChannelHealthReport，渲染评级条 / 红黄灯 / 头部建议。
// 深色主题，复用 channel-quality.css 的 cq-decision-card 系列样式。
import type { ChannelHealthReport, ChannelGrade } from "./scoreChannelHealth";

const confLabel = (c: "high" | "mid" | "low"): string =>
  c === "high" ? "高" : c === "mid" ? "中" : "低";

const gradeClass = (g: ChannelGrade): string => `cq-grade--${g}`;

interface Props {
  report: ChannelHealthReport;
  onDrilldown?: (channel: string, type: "refund" | "category") => void;
}

export function ChannelDecisionCard({ report, onDrilldown }: Props) {
  if (report.channels.length === 0) {
    return (
      <div className="cq-decision-card" data-testid="channel-decision-card">
        <div className="cq-dc-header">
          <h3>渠道质量决策卡</h3>
          <span className={`cq-dc-conf cq-dc-conf--${report.confidence}`}>置信度 {confLabel(report.confidence)}</span>
        </div>
        <p className="cq-dc-summary">{report.summary}</p>
      </div>
    );
  }

  return (
    <div className="cq-decision-card" data-testid="channel-decision-card" data-ui="channel-decision-card">
      <div className="cq-dc-header">
        <h3>渠道质量决策卡</h3>
        <span className={`cq-dc-conf cq-dc-conf--${report.confidence}`}>置信度 {confLabel(report.confidence)}</span>
      </div>
      <p className="cq-dc-summary">{report.summary}</p>

      <div className="cq-dc-body">
        <div className="cq-dc-section">
          <div className="cq-dc-section-title">健康度评级</div>
          <div className="cq-dc-grades">
            {report.channels.map((c) => (
              <div className="cq-dc-grade-row" key={c.channel}>
                <span className={`cq-grade-badge ${gradeClass(c.grade)}`} aria-label={`评级 ${c.grade}`}>{c.grade}</span>
                <span className="cq-dc-channel">{c.channel}</span>
                <span className="cq-dc-rootcause">{c.rootCause}</span>
                <span className="cq-dc-total">{c.total}</span>
              </div>
            ))}
          </div>
        </div>

        {report.redLights.length > 0 && (
          <div className="cq-dc-section">
            <div className="cq-dc-section-title">红黄灯</div>
            <div className="cq-dc-lights">
              {report.redLights.slice(0, 5).map((l, i) => (
                <div className={`cq-dc-light cq-dc-light--${l.level}`} key={`${l.channel}-${i}`}>
                  <span className="cq-dc-light-dot" />
                  <span className="cq-dc-light-level">{l.level}</span>
                  <span className="cq-dc-light-text">
                    {l.channel} · {l.type} {l.value}
                    {l.threshold ? ` (阈值${l.threshold})` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {report.suggestions.length > 0 && (
          <div className="cq-dc-section">
            <div className="cq-dc-section-title">头部建议</div>
            <div className="cq-dc-suggestions">
              {report.suggestions.slice(0, 4).map((s, i) => (
                <div className="cq-dc-suggestion" key={i}>
                  <span className={`cq-dc-prio cq-dc-prio--${s.priority}`}>{s.priority}</span>
                  <span className="cq-dc-sug-text">{s.action}</span>
                  {s.drilldown !== "none" && onDrilldown && (
                    <button
                      type="button"
                      className="cq-dc-drilldown"
                      onClick={() => onDrilldown(s.channel, s.drilldown as "refund" | "category")}
                      aria-label={`查看${s.channel}退款归因`}
                    >
                      查看归因
                    </button>
                  )}
                  <span className={`cq-dc-sug-conf cq-dc-conf--${s.confidence}`}>{confLabel(s.confidence)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
