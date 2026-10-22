import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/** Measure the content box so SVG coordinates match rendered CSS pixels, including padded chart containers. */
export function useChartWidth() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const style = getComputedStyle(element);
    setWidth(Math.max(1, Math.round(element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))));
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(1, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { containerRef, width };
}

/** Shared pointer, touch and keyboard selection; geometry is owned by each chart. */
export function useTrendInteraction(days: number, left: number, right: number) {
  const { containerRef, width } = useChartWidth();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
  const pinned = useRef(false);
  useEffect(() => { setHover(null); pinned.current = false; }, [days]);
  function onMove(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType !== "mouse" && event.type === "pointermove") return;
    if (!svgRef.current || !containerRef.current || !days) return;
    const rect = svgRef.current.getBoundingClientRect();
    const container = containerRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) * width / rect.width;
    const index = Math.max(0, Math.min(days - 1, Math.round((x - left) / (width - left - right) * Math.max(0, days - 1))));
    setHover({ index, x: event.clientX - container.left, y: event.clientY - container.top });
  }
  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    pinned.current = true;
    onMove(event);
  }
  function closeTooltip() {
    pinned.current = false;
    svgRef.current?.focus({ preventScroll: true });
    setHover(null);
  }
  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (!days) return;
    if (event.key === "Escape") { closeTooltip(); return; }
    const current = hover?.index ?? 0;
    const index = event.key === "Home" ? 0 : event.key === "End" ? days - 1 : event.key === "ArrowRight" ? Math.min(days - 1, current + 1) : event.key === "ArrowLeft" ? Math.max(0, current - 1) : -1;
    if (index < 0) return;
    event.preventDefault();
    pinned.current = true;
    setHover({ index, x: left + (days <= 1 ? (width - left - right) / 2 : index * (width - left - right) / (days - 1)), y: 120 });
  }
  return { containerRef, svgRef, width, hover, onMove, onPointerDown, onKeyDown, closeTooltip,
    onLeave: () => { if (!pinned.current) setHover(null); },
    onFocus: () => { if (days && !hover) setHover({ index: 0, x: left, y: 120 }); },
  };
}

export function smoothTrendPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const before = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const after = points[index + 2] ?? next;
    path += ` C ${(current.x + (next.x - before.x) / 6).toFixed(2)} ${(current.y + (next.y - before.y) / 6).toFixed(2)}, ${(next.x - (after.x - current.x) / 6).toFixed(2)} ${(next.y - (after.y - current.y) / 6).toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }
  return path;
}
