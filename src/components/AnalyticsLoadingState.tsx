// 运营数据看板数据加载态：骨架屏 + shimmer
// 替换原"正在读取钉钉经营数据..."纯文本，冷启动（~14s Python 计算）时给用户明确的视觉反馈
export function AnalyticsLoadingState() {
  return (
    <div className="animate-fade-in-up" aria-busy="true" aria-label="正在加载全渠道经营数据" data-testid="analytics-loading">
      <div className="mb-4 flex items-center gap-2 text-xs text-[var(--muted)]">
        <span className="auth-loading-mark" style={{ width: 14, height: 14, borderWidth: 2, borderTopColor: "var(--brand)" }} />
        <span>正在加载全渠道经营数据，首次加载需同步本地数仓…</span>
      </div>

      <div className="metric-grid mb-5" data-testid="analytics-skeleton-kpis">
        {Array.from({ length: 7 }).map((_, index) => (
          <div className="skeleton-card animate-scale-in" key={index} style={{ animationDelay: `${index * 35}ms` }}>
            <div className="skeleton-line w-1/3" />
            <div className="skeleton-line skeleton-line-lg w-2/3" />
            <div className="skeleton-line w-1/2" />
          </div>
        ))}
      </div>

      <div className="card mb-5">
        <div className="skeleton-line w-1/4 mb-4" />
        <div className="skeleton-block h-56" />
      </div>

      <div className="card">
        <div className="skeleton-line w-1/5 mb-4" />
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="skeleton-row animate-scale-in" key={index} style={{ animationDelay: `${index * 50}ms` }} />
        ))}
      </div>
    </div>
  );
}
