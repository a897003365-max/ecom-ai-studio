# Analytics L6 Page Topology

## Scope

This iteration adapts the chart information design from the FineBI template at
`https://app.fanruan.com/templates/20001294` to the existing dark ecom AI Studio
analytics page. It does not clone the full FineBI dashboard or change the global
application shell.

## Order

1. L1-L5 KPI sections remain in their current order and visual language.
2. L6 monthly operations overview remains the primary full-width trend chart.
3. Channel GMV share and rolling monthly target achievement form a two-column
   analysis row.
4. The former channel summary table becomes two chart panels:
   - channel scale comparison (GMV, net revenue, refund),
   - channel efficiency and risk (recovery rate, fee rate, refund rate).
5. Store detail and operating insight modules remain below the channel charts.

## Interaction Model

- Date selection: server-driven; reloads DingTalk and warehouse summaries.
- Channel selection: click/select-driven; continues to filter the primary monthly
  trend chart only.
- New share and performance charts: static comparison with native SVG/HTML
  title tooltips.
- Responsive behavior: two columns on desktop, one column below the existing
  large breakpoint.

