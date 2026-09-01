# 商品经营明细字段补齐方案（对齐 .pbix）

日期：2026-07-25
状态：✅ 已实施 + 数仓对账通过
决策：用「国补后费比」直接替换网站「商品费比」列（不保留旧口径）；两层全做；数仓去年同期数据已确认可用
关联：[POWERBI-UNIQUE-DATA-PRESENTATION-PLAN.md](./POWERBI-UNIQUE-DATA-PRESENTATION-PLAN.md)

## 1. 问题

网站应用「运营数据看板 → 天猫明细 → 旗舰店整体 → 商品经营明细」表格当前 13 列，对比 `D:\麻大师\BI文件\麻大师店铺推广数据报表.pbix` 中「07-旗舰店商品销售数据」的商品粒度 measure，缺少「国补后金额（万）」「国补后金额同比」「销额占比」等字段，且「商品费比」口径与 .pbix 不一致。

.pbix 字段真值来源：[migration/powerbi-tmdl/tables/07-旗舰店商品销售数据.tmdl](../migration/powerbi-tmdl/tables/07-旗舰店商品销售数据.tmdl)
网站实现：[src/components/PowerBiReplica.tsx](../src/components/PowerBiReplica.tsx) 的 `OverallPage` 商品经营明细表（第 276 行）

## 2. 字段对比

### 2.1 网站现状

商品经营明细 13 列（PowerBiReplica.tsx:276）：

```
商品 | 访客 | 支付买家 | 转化率 | 支付金额 | 支付件数 | 退款额 | 退款占比 | 加购 | 加购率 | 推广花费 | 商品费比 | 件单价
```

数据来源 `PowerBiProductDaily`（[integration.ts:162](../src/types/integration.ts#L162)）：`date, productId, productName, visitors, addToCart, payBuyers, payAmount, refund, paidUnits`，推广花费来自 `promotionProductDaily.spend` 按 productId 聚合。

### 2.2 .pbix 商品粒度 measure 对照

| .pbix measure | DAX 公式 | 网站现状 |
|---|---|---|
| 商品支付金额（万） | `支付金额/10000` | ✅ 有（未除万） |
| 商品减退金额（万） | `(支付金额-退款金额)/10000` | ❌ 缺 |
| **国补后金额(万)** | `商品减退金额（万）*0.85` | ❌ 缺 |
| **国补后金额同比** | `(本期 - 去年同期) / 去年同期`，DATEADD(-365,DAY) | ❌ 缺 |
| **商品减退金额占比（销额占比）** | `本商品 / ALLSELECTED 全部商品` | ❌ 缺 |
| 国补后费比 | `花费(万) / (商品减退金额（万）*0.85)` | ❌ 缺 |
| 商品费比 | `花费(万) / 商品减退金额（万）` | ⚠️ 口径不一致 |
| 客单价（商品） | `支付金额 / 支付买家数` | ❌ 缺 |
| 件单价 | `支付金额 / 商品支付件数` | ✅ 有 |
| 访客转化率 | `支付买家数 / 商品访客数` | ✅ 有（转化率） |
| 退款金额占比 | `退款金额 / 支付金额` | ✅ 有（退款占比） |
| 商品加购率 | `加购人数 / 商品访客数` | ✅ 有（加购率） |
| TOP1/3/5/10 占比 | `TOPN 聚合` | ❌ 缺（汇总型，可选） |

### 2.3 口径不一致：商品费比

- 网站（PowerBiReplica.tsx:276）：`rate(spend, row.payAmount)` = 花费 / **支付金额**
- .pbix：`商品费比 = 花费(万) / 商品减退金额（万）` = 花费 / **(支付金额 − 退款金额)**
- .pbix：`国补后费比 = 花费(万) / (商品减退金额（万）*0.85)` = 花费 / **((支付金额−退款金额)×0.85)**

网站用「支付金额」做分母，.pbix 用「减退金额（扣退款）」做分母。费比是核心经营指标，口径不齐会导致与 .pbix 报表数值不可对账，需一并修正。

## 3. 数据约束

### 3.1 立即可补（纯派生，现有字段足够）

`PowerBiProductDaily` 已有 `payAmount / refund / payBuyers / paidUnits`，推广花费来自 `promotionProductDaily`。以下字段无需改数仓：

- 国补后金额（万）= `(payAmount − refund) × 0.85`
- 销额占比 = `本商品(payAmount−refund) / Σ所有商品(payAmount−refund)`
- 国补后费比 = `spend / ((payAmount−refund)×0.85)`
- 客单价（商品）= `payAmount / payBuyers`
- 商品费比口径对齐 = `spend / (payAmount−refund)`

### 3.2 需数据层扩展：国补后金额同比

- `POWERBI_PAGE_WINDOW_DAYS = 60`（[warehouse.py:34](../pipeline/ecom_pipeline/warehouse.py#L34)），`productDaily` 只查最近 60 天（warehouse.py:513-546），无去年同期通道
- warehouse.py 全文无 `prior_year / DATEADD / 去年同期` 实现
- 类型层 `WarehouseDashboardMetrics.comparisons.priorYearPeriod`（[integration.ts:128](../src/types/integration.ts#L128)）是预留字段，未实现
- .pbix 用 `DATEADD('01-店铺数据辅助表'[日期].[Date], -365, DAY)` 取去年同期

结论：商品级同比需新建数据通道，不能纯前端派生。

## 4. 补充方案

### 4.1 第一层：纯前端派生字段（立即可做）

在 `aggregateProductRows`（PowerBiReplica.tsx:141）聚合后，为每行派生：

```
减退金额      = payAmount − refund
国补后金额    = 减退金额 × 0.85
国补后金额(万) = 国补后金额 / 10000
销额占比      = 国补后金额 / Σ所有行国补后金额      // 对齐 .pbix ALLSELECTED：当前展示商品之和
国补后费比    = spend / 国补后金额
商品费比(对齐) = spend / 减退金额
客单价        = payAmount / payBuyers
```

表头变更（建议插入位置：支付金额之后、退款额之前，与 .pbix 口径分组一致）：

| 列 | 公式 | 格式 | 操作 |
|---|---|---|---|
| 国补后金额(万) | `(payAmount−refund)×0.85/10000` | ¥0.00万 | 新增 |
| 销额占比 | `国补后金额 / Σ` | 0.00% | 新增 |
| 国补后金额同比 | 见 4.2 | ↑0.00% / 数据不足 | 新增 |
| 国补后费比 | `spend / 国补后金额` | 0.00% | **替换**原「商品费比」列 |

决策：原「商品费比」列（分母为支付金额）直接由「国补后费比」替换，不再保留旧口径，避免一表出现两个费比让使用者困惑。.pbix 的「商品费比」（分母为减退金额）不单独呈现，因「国补后费比」已是其国补口径变体，经营复盘以国补后口径为准。

### 4.2 第二层：国补后金额同比（数据层扩展）

**选项 A（采用）：扩展 `warehouse._build_powerbi_pages` 增加商品级去年同期聚合**

数仓去年同期 07 表数据已确认可用（用户已核验 .pbix 与本地数仓均有数据）。

实现步骤：

1. warehouse.py `_build_powerbi_pages`（第 442 行）增加 `product_daily_prior_year` 查询
   - 窗口：`period_start − 365` ~ `period_end − 365`
   - 按 productId 聚合 `payAmount`、`refund`（与 product_daily 同口径，取去年同期）
   - 复用 ranked Top60 商品 ID，保证 join 一致
2. 返回结构增加 `productDailyPriorYear: [{productId, payAmount, refund}]`
3. 前端 `PowerBiPages` 增加 `productDailyPriorYear` 字段；`aggregateProductRows` 合并去年同期数据
4. 派生：`国补后金额同比 = (本期国补后 − 去年国补后) / 去年国补后`

**选项 B（降级）：去年同期数据不可用时显示「数据不足」**

与 [POWERBI-UNIQUE-DATA-PRESENTATION-PLAN.md](./POWERBI-UNIQUE-DATA-PRESENTATION-PLAN.md) §5 一致：「样本不足时只提示数据不足，不判红绿」。

- 前端检测：若该商品无去年同期数据，同比列显示「-」或「数据不足」，不显示 0%、不着色

建议：选项 A 为主，选项 B 为数据缺失时的兜底渲染。两层的渲染入口都在前端，数据可用时自动从 B 升级到 A。

### 4.3 可选：TOP1/3/5/10 占比

.pbix 有 `商品TOP1/3/5/10减退金额占比`（汇总型 measure，非行级）。若需对齐，可在表底增加「Top3 占比 X%」汇总行，或作为表头注释。优先级低，非用户点名字段，暂不纳入。

## 5. 实施步骤

1. **确认数仓覆盖**（实施 4.2 前）：查 07 表 min/max 日期，判断是否覆盖去年同期
2. **前端类型扩展**：[integration.ts](../src/types/integration.ts) `PowerBiPages` 增加 `productDailyPriorYear`，`PowerBiProductDaily` 增加派生字段
3. **数仓扩展**（仅 4.2）：[warehouse.py](../pipeline/ecom_pipeline/warehouse.py) `_build_powerbi_pages` 增加 `product_daily_prior_year` 查询
4. **前端渲染**：[PowerBiReplica.tsx](../src/components/PowerBiReplica.tsx) `OverallPage` 商品经营明细表头增加新列，`aggregateProductRows` 增加派生计算，商品费比口径对齐
5. **契约测试**：[test-powerbi-replica-contract.mjs](../scripts/test-powerbi-replica-contract.mjs) 增加断言（含国补后金额、销额占比、同比列、商品费比口径）
6. **样式**：[styles.css](../src/styles.css) `.pb-business-product-table` 列宽调整，国补后金额同比的红绿着色复用 `.pb-delta is-up/is-down`

## 6. 验收

- 商品经营明细表新增「国补后金额(万)」「销额占比」「国补后金额同比」「国补后费比」列
- 原「商品费比」列由「国补后费比」替换（分母 `(支付−退款)×0.85`）
- 国补后金额同比：有去年同期数据时显示百分比 + 箭头；无数据时显示「数据不足」，不着色
- 契约测试 `node scripts/test-powerbi-replica-contract.mjs` 通过
- 类型检查 `npx tsc --noEmit` 通过

### 6.1 数仓对账结果（2026-07-25，`scripts/audit-product-subsidized-yoy.py`）

同步后快照 period：2026-05-26 ~ 2026-07-24（60 天窗口）

| 验证项 | 结果 |
|---|---|
| DuckDB 07 表日期覆盖 | 2024-08-17 ~ 2026-07-24（覆盖本期 + 去年同期） |
| 本期窗口 07 表行数 / 商品数 | 6503 行 / 162 商品 |
| 去年同期窗口 07 表行数 / 商品数 | 6561 行 / 138 商品 |
| 快照 productDailyPriorYear 商品数 | 138（与 DuckDB 去年同期 distinct 商品数一致） |
| Top60 中有去年同期数据的商品数 | 49 / 60（11 个去年未上架，前端降级「数据不足」） |
| 公式自洽抽查（豆芽） | `(13462424 − 4792175) × 0.85 / 10000 = 736.9712万`，与快照派生值偏差 0.000000 |

Top10 商品对比表（供与 PowerBI Desktop 报表人工核对）：

| 商品 | 支付金额 | 退款 | 本期国补后(万) | 去年国补后(万) | 同比 | 销额占比 |
|---|---:|---:|---:|---:|---:|---:|
| 豆芽 | 13,462,424 | 4,792,175 | 736.97 | 814.02 | -9.47% | 19.97% |
| 豆7/M77 | 10,313,260 | 3,506,108 | 578.61 | 582.86 | -0.73% | 15.68% |
| 护脊宝/M88 | 8,906,423 | 2,969,156 | 504.67 | 620.35 | -18.65% | 13.68% |
| 豆苗 | 8,040,834 | 2,689,018 | 454.90 | 374.82 | +21.36% | 12.33% |

剩余人工核对：请用户在 PowerBI Desktop 打开 `麻大师店铺推广数据报表.pbix`「07-旗舰店商品销售数据」页，对照上表「本期国补后(万)」「去年国补后(万)」「同比」三列数值是否一致。
