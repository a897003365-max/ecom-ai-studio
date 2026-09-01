import { useMemo, useState, type PointerEvent } from "react";

interface ChannelRevenueChartProps {
  daily: Array<{
    date: string;
    totalNetRevenue: number;
    channels: Array<{ platform: string; netRevenue: number }>;
  }>;
  selectedChannel: string;
}

const palette = ["var(--blue)", "var(--orange)", "var(--purple)", "var(--pink)", "#72c7a8", "#d6b869"];
const width = 760;
const height = 286;
const plot = { left: 54, right: 18, top: 20, bottom: 42 };

function axisMaximum(value: number) {
  if (value <= 10) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const before = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const after = points[index + 2] ?? next;
    const control1 = { x: current.x + (next.x - before.x) / 6, y: current.y + (next.y - before.y) / 6 };
    const control2 = { x: next.x - (after.x - current.x) / 6, y: next.y - (after.y - current.y) / 6 };
    path += ` C ${control1.x.toFixed(2)} ${control1.y.toFixed(2)}, ${control2.x.toFixed(2)} ${control2.y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }
  return path;
}

function shortMoney(value: number) {
  return `${(value / 10_000).toFixed(value >= 100_000 ? 1 : 2)}万`;
}

export function ChannelRevenueChart({ daily, selectedChannel }: ChannelRevenueChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const allChannels = useMemo(() => daily[0]?.channels.map((item) => item.platform) ?? [], [daily]);
  const channels = useMemo(
    () => selectedChannel === "all" ? allChannels : allChannels.filter((channel) => channel === selectedChannel),
    [allChannels, selectedChannel],
  );
  const maxValue = axisMaximum(Math.max(...daily.map((item) => item.totalNetRevenue / 10_000), 0));
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const x = (index: number) => plot.left + (daily.length <= 1 ? 0 : index * plotWidth / (daily.length - 1));
  const y = (value: number) => plot.top + (1 - value / 10_000 / maxValue) * plotHeight;
  const totalPoints = daily.map((item, index) => ({ x: x(index), y: y(item.totalNetRevenue) }));

  function move(event: PointerEvent<SVGRectElement>) {
    if (!daily.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const local = (event.clientX - bounds.left) / bounds.width * plotWidth;
    setHoveredIndex(Math.max(0, Math.min(daily.length - 1, Math.round(local / plotWidth * (daily.length - 1)))));
  }

  const hovered = hoveredIndex === null ? null : daily[hoveredIndex];
  const hoveredChannels = hovered?.channels.filter((item) => channels.includes(item.platform)) ?? [];
  const tooltipLeft = hoveredIndex === null || daily.length <= 1 ? 50 : x(hoveredIndex) / width * 100;
  const channelColor = (channel: string) => palette[Math.max(0, allChannels.indexOf(channel)) % palette.length];

  return (
    <div className="channel-chart" data-testid="channel-revenue-chart" data-ui="sales-chart">
      <div className="channel-chart-head">
        <div>
          <div className="text-sm font-bold">{selectedChannel === "all" ? "各渠道每日回款额" : `${selectedChannel}每日回款额`}</div>
          <div className="mt-1 text-[11px] text-[var(--muted)]">横轴日期每 5 天标注 · 纵轴单位：万元</div>
        </div>
        <div className="channel-chart-legend">
          <span><i style={{ background: "var(--brand)" }} />总回款</span>
          {channels.map((channel) => <span key={channel}><i style={{ background: channelColor(channel) }} />{channel}</span>)}
        </div>
      </div>
      <div className="channel-chart-canvas">
        <svg aria-label={selectedChannel === "all" ? "当月各渠道每日回款额平滑折线图" : `当月${selectedChannel}每日回款额平滑折线图`} role="img" viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const value = maxValue * ratio;
            const rowY = plot.top + (1 - ratio) * plotHeight;
            return <g key={ratio}><line className="chart-guide" x1={plot.left} x2={width - plot.right} y1={rowY} y2={rowY} /><text className="chart-axis-label" x={plot.left - 10} y={rowY + 4}>{value.toFixed(0)}万</text></g>;
          })}
          {daily.map((item, index) => {
            const day = Number(item.date.slice(8, 10));
            const show = (day - 1) % 5 === 0 || index === daily.length - 1;
            return show ? <text className="chart-x-label" key={item.date} x={x(index)} y={height - 13}>{item.date.slice(5)}</text> : null;
          })}
          <path className="chart-total-line" d={smoothPath(totalPoints)} />
          {channels.map((channel) => {
            const points = daily.map((item, index) => ({
              x: x(index),
              y: y(item.channels.find((row) => row.platform === channel)?.netRevenue ?? 0),
            }));
            return <path d={smoothPath(points)} fill="none" key={channel} stroke={channelColor(channel)} strokeWidth="1.5" />;
          })}
          {hoveredIndex !== null && hovered && (
            <g>
              <line className="chart-hover-line" x1={x(hoveredIndex)} x2={x(hoveredIndex)} y1={plot.top} y2={plot.top + plotHeight} />
              <circle cx={x(hoveredIndex)} cy={y(hovered.totalNetRevenue)} fill="var(--brand)" r="3.5" stroke="var(--bg)" strokeWidth="1.5" />
              {hoveredChannels.map((item) => <circle cx={x(hoveredIndex)} cy={y(item.netRevenue)} fill={channelColor(item.platform)} key={item.platform} r="3" stroke="var(--bg)" strokeWidth="1.5" />)}
            </g>
          )}
          <rect fill="transparent" height={plotHeight} onPointerLeave={() => setHoveredIndex(null)} onPointerMove={move} width={plotWidth} x={plot.left} y={plot.top} />
        </svg>
        {hovered && (
          <div className={`channel-chart-tooltip ${tooltipLeft > 68 ? "is-left" : ""}`} style={{ left: `${tooltipLeft}%` }}>
            <div className="channel-chart-tooltip-date">{hovered.date}</div>
            <div className="channel-chart-tooltip-total"><span>当天总回款额</span><b>{shortMoney(hovered.totalNetRevenue)}</b></div>
            {hoveredChannels.map((item) => (
              <div className="channel-chart-tooltip-row" key={item.platform}><span><i style={{ background: channelColor(item.platform) }} />{item.platform}</span><b>{shortMoney(item.netRevenue)}</b></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
