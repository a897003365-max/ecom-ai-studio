# WarehouseDashboardMetrics Specification

## Overview

- Target file: `server/warehouse.mjs`
- Consumer: `LayeredAnalyticsView` through `/api/analytics`.
- Source: local PowerBI-derived Parquet/DuckDB warehouse snapshot.

## Metrics

- Visitors, buyers, payment conversion, add-to-cart rate: PowerBI overall daily.
- Customer average price: pay amount / pay buyers.
- Item average price: product pay amount / paid units.
- Promotion ROI: promotion revenue / promotion spend.

## Comparisons

- Current: requested selected period.
- MoM: same calendar-day range shifted one month back.
- YoY: same calendar-day range shifted one year back.
- Return `null` when comparison coverage is unavailable; never synthesize values.

## Availability

- Include warehouse coverage and effective period.
- A selected range without overlapping warehouse rows returns `available: false`.
- The API keeps DingTalk authoritative for GMV, net revenue, refunds, and targets.

