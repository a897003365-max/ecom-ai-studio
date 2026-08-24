# 渠道质量关键信息透出方案

> 起草：数妙妙（Phoebe）/ DataAnalyticsReporter
> 日期：2026-08-03
> 承接：《渠道质量数据分析报告体系设计》（CHANNEL-QUALITY-ANALYTICS-DESIGN.md）
> 范围：把报告体系的 L1/L2 决策信息，从"独立 HTML 报告"延伸进"商品总览 → 渠道质量判断"界面（`ChannelQualityPanel.tsx`）
> 目标：运营在日常界面里直接看到判断、风险、动作，而不是另开报告；让"摆数据"变成"给判断"。

---

## 一、透出目标

报告体系（L1/L2/L3）解决的是"分析深度"，但落地形态是独立报告，运营不会每天打开。透出方案解决的是"决策信息日常可见"——把报告里最关键的 4 类信息（评级 / 红黄灯 / 头部建议 / 置信度）嵌进 `ChannelQualityPanel`，让运营在原工作界面第一眼就拿到判断。

**不透出什么**：不把完整 L2 报告塞进界面（太重），不重复三张明细表（它们本身就是证据层）。只透出"决策入口"，下钻才进证据。

---

## 二、现状界面盘点

`ChannelQualityPanel.tsx` 当前结构（`tab === "channel"` 时挂载，`pm: ProductManagementPages` 驱动）：

| 区域 | 现状 | 问题 |
|------|------|------|
| 顶部左 | 渠道毛利率&实收对比条形图 | 只是摆数据，无判断 |
| 顶部右 | `judgeChannelQuality` callout | **描述性文字**："X毛利率最高、Y垫底，优先拆解促销"——回答了 What，没回答 Why / So-what |
| 7.1 渠道销售明细表 | 6 列原始数据 | 无评级、无风险标记、不可下钻 |
| 7.2 床垫类别表 | 8 列 | 无判断列 |
| 7.3 单品明细表 | 8 列 | 无判断列 |
| 每日×渠道毛利率矩阵 | MatrixTable | 有趋势数据但未提炼成"增长力"信号 |

**核心痛点**：决策者要逐行读表自己拼判断，callout 给的是描述不是动作。

---

## 三、pm 数据可用性盘点（关键发现）

承接报告体系设计时认为"投入/漏斗/目标数据在钉钉侧，pm 没有"。重新盘点后发现 **pm 里已有的数据比预期丰富**，足以先做三维评分 + 退款归因下钻，不必干等钉钉接入。

### 3.1 pm 里立即可用的数据

| pm 字段 | 类型 | 支撑的评分维度 / 透出 |
|---------|------|---------------------|
| `channelBreakdown` | 产出+毛利+退款率 | 产出力、盈利力、风险力 |
| `returnChannelBreakdown` | 渠道退款：refundRate / preShipRefundShare / fullRefundShare | **风险力 + 退款根因**（发货前退款占比 vs 全额退款占比） |
| `returnRanking` | SKU 退款排行：spu / refundAmount / refundRate | **退款归因下钻**（点风险渠道→Top3 退款 SKU） |
| `mattressCategoryBreakdown` | 类目毛利/退款 | 品类归因（天猫退款集中在哪个床垫类目） |
| `dailyChannelMarginMatrix` | 每日×渠道毛利率 | **增长力**（毛利率 7 日趋势 / 环比） |
| `monthlyComparison` | 月度对比 | 增长力（环比） |

### 3.2 缺口（钉钉侧，Phase 2 接入）

| 缺口字段 | 来源 | 支撑维度 |
|---------|------|---------|
| spend / roi / feeRate | dt-channel-metrics | 效率力 |
| exposure / clicks / ctr / addToCart | dt-channel-metrics | 漏斗效率 |
| target | dt-channel-metrics | 目标达成 + 预算建议 |

> **结论**：Phase 1 用 pm 现有数据即可上线三维精简评分（产出力 / 盈利力 / 风险力 + 增长力代理），覆盖 80% 决策场景；Phase 2 接钉钉补效率力与目标，做预算建议。

---

## 四、透出内容设计（透出什么）

从报告体系里选 4 类"决策入口级"信息，控制信息密度——多了就回到"摆数据"。

| 信息 | 形态 | 决策意义 |
|------|------|---------|
| **健康度评级** | 每渠道 A/B/C/D 徽章 + 一句话根因 | 一眼排序优先级 |
| **红黄灯** | 突破阈值的风险渠道，P0/P1 标记 | 触发干预 |
| **头部建议** | 2–3 条可执行动作 + 预期影响 | 直接行动 |
| **置信度标注** | 高/中/低 + 缺数据说明 | 知道该信几分 |

每条建议沿用报告体系的固定结构：`现象 + 量化影响 + 根因(置信度) + 建议动作 + 预期收益 + 优先级`，但界面版精简为一行 + 可展开详情。

---

## 五、透出位置设计（怎么透出）

界面三处分层透出，对应报告体系的"决策层 / 表格层 / 证据层"。

```
┌─────────────────────────────────────────────────────────────┐
│  决策层（顶部）· 取代现有 callout                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 渠道质量决策卡 ChannelDecisionCard                       │ │
│  │  · 评级条：天猫C 抖音C 京东B 拼多多C 唯品D              │ │
│  │  · 红黄灯：抖音退款率46%(P0) 拼多多退款率44%(P0)        │ │
│  │  · 头部建议：3条可执行动作（展开看预期收益+置信度）       │ │
│  └────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  表格层（7.1）· 加判断列 + 可下钻                              │
│  渠道销售明细表 + [评级]列 + [风险]标记 + 点击展开退款归因      │
├─────────────────────────────────────────────────────────────┤
│  证据层（7.2 / 7.3 / 矩阵）· 保持，作为下钻证据                │
└─────────────────────────────────────────────────────────────┘
```

### 5.1 决策层 · `ChannelDecisionCard`（新增，取代 callout）

取代现有 `cq-callout`，由 `scoreChannelHealth` 纯函数驱动。三段：

1. **评级条**：每渠道一个胶囊（A 绿 / B 蓝 / C 琥珀 / D 红），右侧一句话根因（"抖音 C · 退款率 46% 超阈值"）
2. **红黄灯区**：列出突破阈值的风险（退款率 > 15% / 毛利率低于中位数），P0/P1 优先级标记
3. **头部建议**：2–3 条动作，每条可展开看预期收益与置信度；建议附带"跳转下钻"按钮

### 5.2 表格层 · 7.1 加评级列 + 退款归因下钻

- 7.1 表新增两列：`评级`（A/B/C/D 徽章）、`风险`（红黄灯图标，hover 显示阈值与缺口）
- 行可点击展开 `RefundDrilldown`：从 `returnRanking` 取该渠道 Top3 退款 SKU + `returnChannelBreakdown` 的发货前/全额退款占比，直接回答"退款集中在哪些 SKU、是发货前退还是到货后退"

### 5.3 证据层 · 保持

7.2 / 7.3 / 矩阵保持原样，但顶部决策卡的"跳转下钻"按钮可锚定到对应表（如"天猫退款品类归因"→ 滚动到 7.2 并高亮退款率最高的类目行）。

---

## 六、分阶段实施

### Phase 1 · 纯 pm 数据，三维评分先行（2 周）

**可立即上线**，无需等钉钉接入。

| 项 | 内容 |
|----|------|
| 新增纯函数 | `scoreChannelHealth(pm): ChannelHealthScore`，三维精简版（产出力 30% / 盈利力 35% / 风险力 35%），增长力用 `dailyChannelMarginMatrix` 毛利率趋势做代理 |
| 新增组件 | `ChannelDecisionCard.tsx`（取代 callout）、`RefundDrilldown.tsx`（退款归因展开） |
| 改造组件 | 7.1 表加评级列 + 风险列 + 行展开 |
| 评分逻辑 | 产出力 = GMV/渠道均值；盈利力 = 毛利率 vs 中位数 + 毛利贡献占比；风险力 = 退款率超 15% 扣分 + 发货前退款占比高加权扣（用 `preShipRefundShare`） |
| 透出 | 评级条 + 红黄灯 + 2–3 条头部建议（退款归因 / 毛利率优化）+ 置信度 |
| 验收 | `test:dashboard-ui` + 新增 `test:channel-health` 覆盖评分边界（空数据 / 单渠道 / 全 null 毛利） |

### Phase 2 · 接入钉钉，五维评分 + 预算建议（4 周）

| 项 | 内容 |
|----|------|
| 数据接入 | 路线 B（见第七节）：前端 join pm + analytics.dingtalk |
| 评分补全 | 效率力（ROI/费比）、目标达成（target/缺口）→ 五维完整版 |
| 透出增强 | 评级条加效率力、红黄灯加达成落后、头部建议加预算重分配（边际 ROI → 增量毛利） |
| 验收 | `test:channel-health` 补钉钉字段边界 + 渠道名对齐测试 |

---

## 七、数据接入路线（路线 B · 前端 join）

投入/漏斗/目标在钉钉侧，pm 在 PowerBI 侧。**不把钉钉字段塞回 PowerBI**（违反 AGENTS.md"钉钉权威、PowerBI 不覆盖"硬规则），而是在前端展示层 join。

```
ProductManagementPage
  ├─ getProductData() → pm (PowerBI 产出/毛利/退款)
  └─ getAnalyticsData() → integration.dingtalk (投入/漏斗/目标)
        ↓ ChannelQualityPanel 内部按 channel 名 join
        ↓ scoreChannelHealth(pm, dingtalkChannelMap) → 五维评分
```

**渠道名对齐**（前置依赖）：pm.`channelBreakdown[].channel` 与钉钉 `dt-channel-metrics` 的渠道名需一致映射。若不一致，建一张 `channelNameMap`（如 "天猫" ↔ "天猫旗舰店"），在 join 前归一化。**Phase 2 启动前先核对映射表**。

**口径约束**：
- 钉钉字段在前端只读 join，不回写 PowerBI
- 评分纯函数签名 `scoreChannelHealth(pm, dingtalkMap?)`，dingtalkMap 可选（Phase 1 传 undefined 降级三维）
- 毛利率仍按 pm 的"已匹配成本"口径；成本匹配率低于阈值时评分降权 + 标注"成本不可信"

---

## 八、与现有组件的关系

| 现有 | 透出后 | 改动类型 |
|------|--------|---------|
| `channelQualityJudge.ts` | `scoreChannelHealth.ts`（新纯函数） | 新增，沿用可单测模式；judge 暂保留兼容 |
| `cq-callout`（callout 区） | `ChannelDecisionCard.tsx`（新组件） | 取代 |
| 7.1 渠道销售明细表 | 表头加评级/风险列 + 行展开 `RefundDrilldown` | 改造 |
| `returnRanking` / `returnChannelBreakdown` | 被 `RefundDrilldown` 消费 | 数据已就绪，新增消费方 |
| 7.2 / 7.3 / 矩阵 | 保持，加锚点跳转 | 小改 |

**风险**：`ChannelQualityPanel` 当前是纯展示组件，加入 join 后需多一个 `dingtalkChannelMap` 入参。`ProductManagementPage` 需同时持有 analytics 数据——需确认该页面是否已加载 analytics（若未加载，Phase 2 需在页面层并行请求）。

---

## 九、约束与口径

- 评分纯函数无 React 依赖，可被 `scripts/test-channel-health.mjs` 直接 import（沿用 `channelQualityJudge.ts` 模式）
- 钉钉字段只读 join，不回写 PowerBI；渠道名归一化在前端做
- 退款率阈值 15%、毛利率阈值用全渠道中位数、ROI 阈值 8——阈值集中配置，便于调参
- 决策卡信息密度上限：评级条 ≤6 渠道、红黄灯 ≤4 条、头部建议 ≤3 条，超出的折叠
- 深色主题适配：评级徽章用语义色（绿/蓝/琥珀/红），不依赖颜色单独区分（徽章带字母 A/B/C/D）

---

## 十、验收标准

1. **决策可见**：进入渠道质量 tab，3 秒内能看到评级、红黄灯、头部建议，无需读表
2. **可下钻**：点风险渠道 → 展开 Top3 退款 SKU + 发货前/全额退款占比
3. **可单测**：`scoreChannelHealth` 覆盖空数据 / 单渠道 / 全 null 毛利 / 退款率超阈值 / Phase2 钉钉缺失降级
4. **口径一致**：评分基于 pm 口径（Phase 1）或 pm+钉钉 join（Phase 2），不引入第三套口径
5. **不破坏现有**：7.1/7.2/7.3 原有列与数据不变，只增不删

---

## 十一、落地次序建议

1. 先写 `scoreChannelHealth` 三维纯函数 + 单测（无 UI 依赖，可独立验证）
2. 再写 `ChannelDecisionCard` 取代 callout（最小可视改动）
3. 再给 7.1 加评级列 + `RefundDrilldown`（下钻）
4. 跑 `npm run test:dashboard-ui` 回归
5. Phase 2 再接钉钉，补效率力与预算建议

第 1 步纯函数可立即开始，是否现在动手写 `scoreChannelHealth` 和它的单测？
