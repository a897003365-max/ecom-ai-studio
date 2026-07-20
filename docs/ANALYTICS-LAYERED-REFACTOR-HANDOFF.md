# 运营数据看板分层视图交接

更新日期：2026-07-15  
状态：本轮三项需求已实现，并完成构建、接口契约、桌面端与移动端验证。

## 1. 已完成范围

1. L6 的「各渠道 GMV 占比」按 `渠道 GMV / 全渠道 GMV` 计算，降序展示真实比例；不再误用回款额口径。
2. 「近 12 月销售达成」使用连续 12 个月的净销售额、钉钉月目标和达成率，采用双柱 + 折线双轴图；当前月按筛选结束日计算 MTD。
3. L6 下方原「渠道经营汇总」数据表已替换为两张条形图：
   - 渠道规模对比：GMV、回款额、退款金额。
   - 渠道效率与风险：回款率、费比、退款率。
4. 前端随机 MOCK 指标和随机同比/环比已移除：
   - GMV、回款额、回款率、费额、费比、退款等仍以钉钉为权威口径。
   - 访客、成交客户、支付转化、客单价、件单价、加购、推广 ROI 从 PowerBI 本地数仓快照聚合。
   - 同比/环比由服务端按同一筛选区间平移计算；快照没有对比期覆盖时显示 `—`，不伪造数值。

## 2. 数据链路

```text
local-data/warehouse/analytics-snapshot.json
  -> server/warehouse.mjs 聚合 PowerBI 独有指标
  -> server/index.mjs /api/analytics 的 warehouse.dashboard
  -> AnalyticsPage.tsx
  -> LayeredAnalyticsView.tsx

钉钉本地快照
  -> server/dingtalk-api.mjs 计算渠道 GMV、12 月达成与确定性趋势
  -> /api/analytics 的 dingtalk.dashboard
  -> LayeredAnalyticsView.tsx
```

权威边界不变：钉钉字段不得被 PowerBI 覆盖；PowerBI 只补充钉钉未覆盖的流量、成交、商品价值与推广指标。

## 3. 关键文件

| 文件 | 作用 |
|---|---|
| `server/warehouse.mjs` | `buildWarehouseDashboardMetrics` 聚合数仓指标、区间和对比期 |
| `server/dingtalk-api.mjs` | 渠道 GMV 占比、连续 12 月达成、钉钉指标同比/环比 |
| `server/index.mjs` | 将 `warehouse.dashboard` 接入 `/api/analytics` |
| `src/components/ChannelShareChart.tsx` | 渠道 GMV 占比条形图 |
| `src/components/MonthlyAchievementChart.tsx` | 12 月目标双柱 + 达成率折线图 |
| `src/components/ChannelPerformanceCharts.tsx` | L6 下方规模与效率/风险条形图 |
| `src/components/LayeredAnalyticsView.tsx` | 分层视图编排与真实指标绑定 |
| `scripts/test-warehouse-dashboard-metrics.mjs` | PowerBI 数仓聚合回归 |
| `scripts/test-dingtalk-api.mjs` | GMV 占比与 12 月达成口径回归 |
| `scripts/test-dashboard-ui-contract.mjs` | 图表接入、去随机 MOCK 契约 |

## 4. 已验证结果

- `npm run test:analytics-dashboard`：通过。
- `npm run build`：通过，TypeScript 与 Vite 构建无错误。
- 项目既有 smoke、钉钉无人值守、PowerBI 图片/复刻、主题、同步与公域契约：通过。
- `python -m unittest discover -s pipeline/tests -v`：9/9 通过。
- 浏览器桌面端：三类图表、真实 KPI 和视图切换正常。
- 浏览器移动端 390 × 844：页面无横向溢出；12 月图在卡片内部横向滚动。

## 5. 残余边界

- 当前 PowerBI 快照只覆盖其本地数据日期范围；缺少去年同期数据时同比显示 `—` 是预期行为。
- 月目标来自钉钉月目标表；当前月实际值使用 MTD，不与整月目标做口径替换。
- 店铺经营明细表仍保留，因为本轮要求替换的是 L6 下方的渠道汇总表，而非店铺明细钻取。
