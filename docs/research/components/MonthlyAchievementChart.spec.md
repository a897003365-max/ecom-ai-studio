# MonthlyAchievementChart Specification

## Overview

- Target file: `src/components/MonthlyAchievementChart.tsx`
- Reference: live FineBI template plus the user-provided twelve-month screenshot
- Interaction model: static SVG chart with native tooltips

## Data contract

- Accept 12 ordered points: `month`, `netRevenue`, `target`, `completionRate`.
- Actual and target values come from DingTalk reporting data; no random targets.
- The selected end month is MTD and all preceding points are monthly totals.

## Visual structure

- Card title: `近12月销售达成`.
- Legend: net revenue blue, sales target cyan, completion rate purple.
- Paired columns share the left CNY axis.
- Purple polyline and circular points use the right percentage axis.
- Month labels use `YY-MM`; rate labels use percentage values.
- Plot area is 760 x 300 in a responsive SVG viewBox.

## Responsive behavior

- Desktop: full chart with all twelve labels.
- Tablet/mobile: horizontally scrollable minimum plot width; no label overlap.

