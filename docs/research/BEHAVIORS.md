# Analytics Chart Behaviors

## Reference sweep

- The live FineBI template is a vertically scrolling dashboard.
- Month/year achievement modules use horizontal bars sorted by platform.
- The rolling twelve-month module uses paired amount columns with an overlaid
  completion-rate line and a secondary percentage axis.
- Platform/store tabs are click-driven; no scroll-triggered state changes were
  observed in the referenced chart area.

## Local adaptation

- Preserve the existing dark panel, green accent, blue data, purple comparison,
  orange cost, and red risk tokens.
- Bars animate through the existing CSS transition conventions but do not start
  timers or regenerate data.
- Values and trends must remain stable across React renders.
- When the PowerBI warehouse does not cover the selected period, show an explicit
  coverage state rather than fabricated values.

