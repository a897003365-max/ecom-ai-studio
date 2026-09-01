# 渠道质量模块 · 1:1 复刻验收规格

> 来源：`E:\微信文件\xwechat_files\j-bleach-z_0be7\msg\file\2026-07\2026年5月订单经营最终复盘看板.html` 中 `data-view="channel"`（渠道质量）视图。
> 本文件是验收基线，用于核对 `src/components/product-management/ChannelQualityPanel.tsx` 是否 1:1 复刻。

## 一、整体布局

顶部一行两栏网格（参考 `.layout` = `1.35fr 0.65fr`）：
- 左栏：**渠道毛利率对比** 条形图
- 右栏：**渠道质量判断** callout 结论卡

下方依次三张明细表：7.1 / 7.2 / 7.3。

## 二、控件 1：渠道毛利率对比 条形图

- 标题：`渠道毛利率对比`，副标题/单位：`毛利率`
- 脚注：`毛利率为已匹配成本数据的汇总结果。`
- 条形结构（参考 `.bar`）：`名称(106px) | 轨道(1fr) | 数值(70px)`，三列网格
- 轨道 `.track`：高 10px，圆角 99px，底色 `--bg-elevated`
- 填充 `.fill`：背景 `--green`，圆角 99px，宽度 = 该渠道毛利率 / 全表最大毛利率 × 100%（最小 2%）
- 数值：毛利率，1 位小数百分数（如 `75.2%`）
- 排序：按毛利率降序
- 数据源：`channelBreakdown`，排除 `grossMargin` 为 null 的渠道

## 三、控件 2：渠道质量判断 callout

- 左侧 4px 橙色边框（`--orange`），暖色底（`--orange-bg`），圆角 10px
- 标题：`渠道质量判断`
- 结论文本（动态生成，基于真实数据，织入 5 个分析维度）：
  - 毛利率最高渠道 + 其毛利率值（`grossMargin`）
  - 该渠道体量占比（`amountShare`）
  - 该渠道毛利额贡献占比（该渠道 `grossProfit` / 全渠道 `grossProfit` 之和）
  - 退款率最高渠道 + 其退款率值（`refundRate`，全 null 则跳过该分句）
  - 件单价最高渠道 + 其件单价值（`avgUnitPrice`，全 null 则跳过该分句）
  - 毛利率最低的两个渠道（按毛利率降序取末两位）
- 触发条件与降级：
  - 全部渠道 `grossMargin` 为 null -> `当前筛选范围未匹配到成本数据，暂无法计算渠道毛利率。`
  - 仅一个渠道有 `grossMargin` -> 给单一渠道提示，不带退款/件单价对比分句
  - 某维度数据全缺 -> 跳过该分句，不停报
- 判断逻辑抽为纯函数 `src/components/product-management/channelQualityJudge.ts`（导出 `judgeChannelQuality`），`ChannelQualityPanel.tsx` 调用它，便于行为测试。

## 四、表 7.1 渠道销售明细表

- 表注：`销售额采用"商家实收"口径；占比为该渠道商家实收占全渠道商家实收比例。`
- 列（6 列，数值列右对齐）：

| 列 | 数据源 | 格式 |
|---|---|---|
| 渠道平台 | channelBreakdown.channel | 原文 |
| 销售数量 | salesUnits | 整数千分位 |
| 商家实收 | receivedAmount | 整数千分位（无货币符号） |
| 毛利率 | grossMargin | 1 位小数百分数 |
| 占比 | amountShare | 1 位小数百分数 |
| 件单价 | avgUnitPrice | 2 位小数千分位 |

- 排序：按商家实收降序
- **必须含「总计」行**（置底，加粗 + 顶部分隔线）：
  - 销售数量 = sum(salesUnits)
  - 商家实收 = sum(receivedAmount)
  - 毛利率 = sum(grossProfit) / sum(matchedReceived)
  - 占比 = 100.0%
  - 件单价 = sum(receivedAmount) / sum(salesUnits)

## 五、表 7.2 床垫类别销售分析表

- 表注：`件单价 = 销售额 / 销售数量；类目销售金额占比按销售额计算；毛利销售金额贡献占比 = 毛利额 / 全表毛利额。`
- 列（8 列，数值列右对齐）：

| 列 | 数据源 | 格式 |
|---|---|---|
| 床垫类别 | mattressCategoryBreakdown.category | 原文 |
| 销售数量 | salesUnits | 整数千分位 |
| 销售额 | salesAmount | 整数千分位 |
| 退款率 | refundRate | 1 位小数百分数（真实数据，非"-"） |
| 件单价 | salesAmount / salesUnits | 2 位小数千分位 |
| 类目销售金额占比 | salesAmount / totalSalesAmount | 1 位小数百分数 |
| 毛利率 | grossMargin | 1 位小数百分数 |
| 毛利销售金额贡献占比 | grossProfit / totalGrossProfit | 1 位小数百分数 |

- 排序：按销售额降序
- 无总计行

## 六、表 7.3 单品明细分析表（按销售额前12名）

- 表注：`销售额采用"商家实收"口径；按商家实收降序取前 12 名；件单价 = 商家实收 / 销量。`
- 列（8 列，数值列右对齐）：

| 列 | 数据源 | 格式 |
|---|---|---|
| 产品名称 | productNameOverview.productName | 原文 |
| 销量 | salesUnits | 整数千分位 |
| 销售额 | receivedAmount（口径=商家实收） | 整数千分位 |
| 退款率 | refundRate | 1 位小数百分数（真实数据） |
| 件单价 | avgUnitPrice（=receivedAmount/salesUnits） | 2 位小数千分位 |
| 产品金额占比 | amountShare | 1 位小数百分数 |
| 毛利率 | grossMargin | 1 位小数百分数 |
| 毛利销售金额贡献占比 | grossProfit / totalGrossProfit | 1 位小数百分数 |

- 排序：按商家实收降序，**仅取前 12 行**
- 无总计行

## 七、后端数据真实性 + 全局筛选符合性（硬性要求）

- 所有数据必须来自真实 `ProductManagementPages`，禁止前端硬编码参考看板的 2026-05 数值。
- 数据源：`channelBreakdown` / `mattressCategoryBreakdown` / `productNameOverview`。
- 这三个字段由后端 `pipeline/sync.py query-products` 按全局筛选（日期范围 / 订单状态 / 渠道平台 / 店铺简称）实时计算。
- 验收方式：在页面顶部「运营筛选」工具栏切换筛选条件（如选某渠道、某店铺、某日期段），渠道质量模块的条形图、callout、三张表数据必须同步变化，且与同页面其他 tab（如「退货分析」的渠道拆分）口径一致。
- 前端访问这三个字段必须 `?? []` 容错，旧缓存下不得整面板白屏。

## 八、实现文件

- `src/components/product-management/ChannelQualityPanel.tsx`（主组件）
- `src/styles/channel-quality.css`（样式）
- `src/pages/ProductManagementPage.tsx`（新增 `channel` tab，置于「商品总览」之后）
- `src/main.tsx`（引入 channel-quality.css）

## 九、访问入口

- URL：`http://127.0.0.1:5173/`
- 路径：侧边栏进入「商品管理」→ 顶部 Tabs 选「渠道质量」
- 免登录（`enforcementEnabled: false`，本地免登录模式）
