# ChannelPerformanceCharts Specification

## Overview

- Target file: `src/components/ChannelPerformanceCharts.tsx`
- Replaces the layered-view `渠道经营汇总` table.
- Interaction model: static grouped horizontal bars with native tooltips.

## Scale panel

- Compare GMV, net revenue, and refund amount per channel.
- Use one shared amount scale so bar lengths are comparable.
- Show exact GMV and net revenue next to every channel.

## Efficiency panel

- Compare recovery rate, fee rate, and refund rate per channel.
- Use a 0-100% scale, extending to the next 25% step if any metric exceeds 100%.
- Use green for recovery, orange for fee rate, and red for refund rate.
- Highlight refund rates at or above 40%.

## Responsive behavior

- Desktop: two equal columns.
- Mobile/tablet: stack panels; each row keeps labels and exact values readable.

