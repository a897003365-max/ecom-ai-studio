# 商品管理新增四模块 · 执行交接

> 交接时间：2026-07-24
> 执行模型：纯文本模型（未做任何视觉验证）
> 后续：切换多模态模型按第 5 节清单做 UI 视觉检查，并可继续 Phase 3–6

## 1. 总览

按 [reflective-dazzling-pie.md](C:/Users/Administrator/.claude/plans/reflective-dazzling-pie.md) 执行，Phase 0–6 全部完成，4 模块全链路跑通。

| Phase | 状态 | 说明 |
|---|---|---|
| Phase 0 数据审计 | ✅ 完成 | q18 验证、覆盖率、定制信号评估 |
| Phase 1 骨架 | ✅ 完成 | 类型、builder、4 panel、契约、测试 |
| Phase 2 价格结构 | ✅ 完成 | 7 档分桶 + 3 矩阵，ready |
| Phase 3 尺寸结构 | ✅ 完成 | q18->q27->颜色规格优先级，10 尺寸，ready |
| Phase 4 SPU 销量 | ✅ 完成 | 78 SPU，TOP15，渠道矩阵，ready |
| Phase 5 定制结构 | ✅ 完成 | 降级版，degraded，常规 vs 定制 + 7 标签 |
| Phase 6 综合验证 | ✅ 完成 | 43 测试 + 2 契约 + build 全绿 |

## 2. 验证状态（Phase 2 末尾，全绿）

```
python -m unittest pipeline.tests.test_product_identity_and_channel \
                      pipeline.tests.test_product_status_metrics \
                      pipeline.tests.test_product_structure_builders
# Ran 17 tests, OK

npx tsc --noEmit              # exit 0
node scripts/test-dashboard-ui-contract.mjs          # ok
node scripts/test-product-management-current-contract.mjs  # ok
npx vite build                # built in 1.70s
python pipeline/sync.py sync  # exit 0
```

snapshot `local-data/warehouse/analytics-snapshot.json` 的 `productManagement.priceStructure` 已含真实数据：status=ready，validOrderLines=130020，7 档分桶 + 3 个占比矩阵（渠道 7 行 / 类别 17 行 / TOP15 产品 15 行）。

## 3. Phase 0 关键发现（影响后续 Phase，必读）

完整审计见 [product-structure-data-audit.md](product-structure-data-audit.md)。要点：

### 3.1 q18 可直接 join（好消息）

- `辅4-床垫编码` 按 `商家规编（后台）` 是唯一 key：8055 行 0 重复、0 维度冲突。
- LEFT JOIN 订单事实不放大（行数/销量/商家实收差异均为 0）。
- 订单行覆盖率 90.1%（超 80% 阈值），SPU 映射率 90.1%（110 个 distinct SPU）。
- **Phase 3/4 可直接用 `q18.商家规编（后台） = 订单.商品编码` join**，无需额外去重。但 builder 仍保留 try/except 兜底。

### 3.2 定制模块严重降级（⚠️ Phase 5 必须调整）

颜色规格里的定制关键词极少：定制/定做/非标 仅 1 行，异形 0，缺角 0，折叠 3147（是产品属性非定制信号）。

**参考看板的 7 类定制标签在当前数仓无法推导。** Phase 5 降级方案：
1. 只做"常规订单 vs 折叠款订单"对比，折叠款用 q18.`是否折叠=是` 识别。
2. 7 标签仅保留实际有信号的，其余固定返回 0。
3. 页面标注："当前数仓无原生定制字段，定制结构仅基于折叠款属性与颜色规格关键词推导。"
4. 若用户接入 ERP 定制字段，再替换推导逻辑。

### 3.3 尺寸格式（Phase 3 用）

颜色规格以 `\d+MM*\d+MM` 为主（如 `1800MM*2000MM`），少量 `*CM`（如 `180*200CM`）和三围规格（枕头 `70*40*18CM`）。q18.尺寸 字段为补充来源。标准化需统一分隔符 `×`、单位转 mm、宽×长排序。

## 4. 剩余 Phase 待办

### Phase 3：尺寸结构

- 在 [product_structure_builders.py](pipeline/ecom_pipeline/product_structure_builders.py) 实现 `build_size_structure`：
  - 优先级：q18.尺寸 -> q27.尺寸 -> 颜色规格正则 `\d{3,4}\s*[×xX\*]\s*\d{3,4}` -> 未填写尺寸
  - 标准化：统一 `×`、去空格、mm 单位、宽×长排序
  - 低频尺寸（<0.5% 订单行）合并为"其他尺寸"
  - 矩阵：床垫类别×尺寸、TOP15产品×尺寸（复用 `_pivot_share_matrix`，但列是尺寸而非价格档）
  - quality.coverage 返回 q18 覆盖率
- 写测试：优先级、标准化、低频合并、unknown、join 不放大
- 实现 [SizeStructurePanel.tsx](src/components/product-management/SizeStructurePanel.tsx)（参考 PriceStructurePanel）
- 注意：`_pivot_share_matrix` 目前列固定为价格档，尺寸版需要参数化列或新 helper

### Phase 4：SPU 销量趋势

- 实现 `build_spu_sales_trend`：
  - SPU 取 q18.`SPU产品商编`，缺失归"未识别 SPU"（禁止用床垫类别冒充）
  - spuChannelMatrix（values=销售数量，用现有 ProductMatrix 类型，不是 ShareMatrix）
  - dailySpuTrend：TOP15 SPU + 未识别 SPU 的日趋势
  - categoryDailyTrend：床垫类别日趋势
- 写测试：SPU 映射、缺失归未识别、TOP15、日期升序
- 实现 [SpuSalesTrendPanel.tsx](src/components/product-management/SpuSalesTrendPanel.tsx)

### Phase 5：定制结构（降级版）

- 实现 `build_customization_structure`（按第 3.2 节降级）：
  - comparison：常规 vs 折叠款（不是常规 vs 定制）
  - tags：7 标签固定返回，大部分为 0
  - quality.status = "degraded"，warnings 说明降级原因
- 写测试：折叠款识别、7 标签固定、常规不进未填写
- 实现 [CustomizationStructurePanel.tsx](src/components/product-management/CustomizationStructurePanel.tsx)

### Phase 6：综合验证

- 跑全量测试 + 契约 + build + sync
- 用 code-reviewer / python-reviewer / typescript-reviewer 审查
- 验证隐私（不泄露原始订单行/源路径）
- 验证 4 个 Tab 在 320/768/1024/1440 宽度无溢出

## 5. 多模态检查清单（需视觉验证）

启动本地应用 `npx vite`（或 `node server/index.mjs --production`），访问商品管理页：

### 5.1 价格结构 Tab（Phase 2 已实现，重点检查）

- [x] 4 个新 Tab（价格结构/尺寸结构/SPU 销量/定制结构）能正常切换，无白屏
- [x] 价格结构 Tab 的"商家实收价格段分布"表：7 档全显示，数值格式正确（¥金额带千分位、百分比 1 位小数）
- [x] 表头可点击排序
- [x] "渠道 × 价格段"矩阵：7 行渠道 × 7 列价格档，百分比显示
- [x] "床垫类别 × 价格段"矩阵：17 行类别
- [x] "TOP15 产品 × 价格段"矩阵：15 行产品
- [x] 顶部口径说明文字正确（单件实收价公式、无效行数、有效订单行数、商家实收合计）
- [ ] 宽度 320/768/1024/1440 无页面横向溢出（宽表应内部滚动）——768/1024/1440 通过；320 下页面本身不横向溢出、宽表可内部滚动，但 Tab 导航被压缩并裁剪，未通过
- [x] 表格在窄屏不错位、不截断数值（通过卡片内横向滚动查看完整列）

### 5.2 占位 Tab（Phase 3–5 未实现）

- [x] 尺寸结构 Tab 显示"尺寸结构模块开发中。"
- [x] SPU 销量趋势 Tab 显示"SPU 销量趋势模块开发中。"
- [x] 定制结构 Tab 显示"定制结构模块开发中。"

### 5.3 现有 Tab 无回归

- [x] 商品总览/销售趋势/退货分析/渠道与达人/每日订单分析/仓配履约 6 个 Tab 均能正常渲染和切换，无白屏
- [ ] KPI 卡、矩阵、表格数值与改动前一致——当前没有改动前快照或 golden baseline，且工作树同时包含退货分析改动，无法严格证明数值未回归

### 5.4 2026-07-24 Codex 实机验收补充

本次验收以当前工作树和当前本地快照为准，没有把交接中的历史“全绿”描述直接当作当前事实。使用真实浏览器检查了 320/768/1024/1440 四档宽度、10 个商品管理 Tab、排序、宽表滚动、控制台和接口返回。

#### 已确认通过

- 价格结构 API `quality.status=ready`，返回 7 个价格档、7 行渠道、17 行床垫类别、15 行 TOP 产品。
- 当前快照有效订单行 130,020、无效行 0；订单行占比与金额占比均合计为 100%。
- `privacy.rawRowsExposed=false`、`privacy.sourcePathsExposed=false`。
- 768/1024/1440 无页面级横向溢出；价格表和三个矩阵在空间不足时使用卡片内横向滚动。
- 浏览器控制台为 0 error、0 warning；未观察到失败网络请求。
- 三个占位模块的 API 状态均为 `unavailable`，与 Phase 3–5 尚未实现的交接状态一致。

#### 验收阻塞项

1. **320px Tab 导航未通过。** `Tabs.tsx` 的 Tab 容器没有横向滚动，`.tab-trigger` 又允许收缩；10 个 Tab 被压成逐字竖排，尺寸结构、SPU 销量、定制结构落入裁剪区域。修复建议：Tab 容器增加 `overflow-x-auto`，按钮增加 `shrink-0` 和 `whitespace-nowrap`。
2. **价格金额占比分母存在边界口径错误。** `product_structure_builders.py` 的 `total_recv` 只过滤“商家实收 > 0”，没有同时过滤“销售数量 > 0”。最小复现中，一条有效行加一条销量为 0 的正实收行，会得到 `valid=1`、`excluded=1`、金额占比合计 50%，与“无效行不进入占比分母”冲突。当前快照无效行恰好为 0，因此现有页面暂未受影响；修复时应复用有效行条件并补充回归测试。
3. **旧页面数值回归缺少证据基线。** 6 个旧 Tab 的渲染和切换已验证，但没有改动前快照；同时 `ProductManagementPage.tsx`、`warehouse.py` 和类型文件还混有退货分析改动，不能仅凭页面可打开就认定原数值完全未变。

#### 本次复跑验证

```text
python -m unittest pipeline.tests.test_product_identity_and_channel \
                      pipeline.tests.test_product_status_metrics \
                      pipeline.tests.test_product_structure_builders
# Ran 17 tests, OK

npx tsc --noEmit
# exit 0

node scripts/test-dashboard-ui-contract.mjs
# dashboard-ui contract: ok

node scripts/test-product-management-current-contract.mjs
# product management current contract: ok

npx vite build
# built successfully

git diff --check
# exit 0
```

本轮没有执行 `python pipeline/sync.py sync`，因为该命令会刷新本地快照，不属于只读验收。正式验收前应重启从 2026-07-18 持续运行的 5180 生产进程，再复跑冒烟测试。

#### 当前项目判断与建议顺序

- Phase 0–2 的数据、API、桌面 UI 已实质完成，但第 5 节尚未全量通过。
- Phase 3–5 仍为占位模块，建议先修复 320px Tab 导航和金额占比分母，再继续尺寸结构。
- 2026-07-24 检查时工作树共有 44 项未提交状态（23 个修改、21 个未跟踪），商品结构、退货分析、运营看板和同步脚本等改动互相混杂。提交前应先按真实差异拆分范围，不要直接依据第 7 节的两类建议粗分提交。
- 修复阻塞项后，为 6 个旧 Tab 保存可比较的 API/页面基线，再执行 Phase 3 和最终全量回归。

## 6. 文件清单

### 新建

- [pipeline/ecom_pipeline/product_structure_builders.py](pipeline/ecom_pipeline/product_structure_builders.py) — 4 模块 builder（价格已实现，其余返回空）
- [pipeline/tests/test_product_structure_builders.py](pipeline/tests/test_product_structure_builders.py) — 11 个测试（schema + 价格边界/占比/矩阵/TOP15）
- [src/components/product-management/StructureMatrixTable.tsx](src/components/product-management/StructureMatrixTable.tsx) — 共用占比矩阵组件
- [src/components/product-management/PriceStructurePanel.tsx](src/components/product-management/PriceStructurePanel.tsx) — 价格 Tab（已实现）
- [src/components/product-management/SizeStructurePanel.tsx](src/components/product-management/SizeStructurePanel.tsx) — 尺寸 Tab（占位）
- [src/components/product-management/SpuSalesTrendPanel.tsx](src/components/product-management/SpuSalesTrendPanel.tsx) — SPU Tab（占位）
- [src/components/product-management/CustomizationStructurePanel.tsx](src/components/product-management/CustomizationStructurePanel.tsx) — 定制 Tab（占位）
- [scripts/audit-product-structure-data.py](scripts/audit-product-structure-data.py) — Phase 0 审计脚本（可复现）
- [docs/product-structure-data-audit.md](docs/product-structure-data-audit.md) — Phase 0 审计报告

### 修改

- [src/types/integration.ts](src/types/integration.ts) — 新增 4 模块类型 + 扩展 ProductManagementPages
- [pipeline/ecom_pipeline/warehouse.py](pipeline/ecom_pipeline/warehouse.py) — import builder + 正常返回/空降级路径接入 4 模块
- [src/pages/ProductManagementPage.tsx](src/pages/ProductManagementPage.tsx) — 4 个 Tab + panel 渲染分支
- [scripts/test-product-management-current-contract.mjs](scripts/test-product-management-current-contract.mjs) — 新字段运行时断言
- [scripts/test-dashboard-ui-contract.mjs](scripts/test-dashboard-ui-contract.mjs) — 4 个 Tab 静态断言

## 7. 已知未提交

所有改动均未 git commit（按规则用户未要求不提交）。当前分支 `agent/publish-ecom-ai-studio`。如需提交，建议分 commit：数据层+API / UI+契约。

## 8. 第二轮执行（2026-07-24，Phase 3–6 + bug 修复）

### 8.1 已修复 Codex 验收阻塞项

1. **320px Tab 导航裁剪** - [Tabs.tsx](src/components/Tabs.tsx) 容器加 `overflow-x-auto`，按钮加 `shrink-0 whitespace-nowrap`。需多模态复验 320px。
2. **价格金额占比分母口径** - [product_structure_builders.py](pipeline/ecom_pipeline/product_structure_builders.py) 的 `total_recv` 改为同时过滤 `销售数量>0`，与有效行条件一致。补回归测试 `test_price_zero_quantity_excluded_from_amount_share`。

### 8.2 Phase 3–5 实现完成

- **Phase 3 尺寸结构**：`build_size_structure` + `_normalize_size`。优先级 q18->q27->颜色规格->未填写。标准化 `宽×长mm`（cm 转 mm，3-4 位数字过滤枕头三围）。低频 <0.5% 并入"其他尺寸"。snapshot：10 尺寸，1800×2000mm 占 50.6%，q18 覆盖 90.1%。
- **Phase 4 SPU 销量**：`build_spu_sales_trend` + `_pivot_count_matrix`。SPU 取 q18.SPU产品商编，缺失归"未识别 SPU"。TOP15 + 未识别日趋势。snapshot：78 SPU，M77 居首（4432万），未识别 9.9%。
- **Phase 5 定制结构（降级）**：`build_customization_structure`。颜色规格关键词推导，7 标签互斥（缺角>异形>折叠>尺寸>厚度>内材>未填写）。quality=degraded。snapshot：常规 128077 vs 定制 1943（1.5%），TOP20 履约。毛利因成本口径复杂暂返回 null。

### 8.3 Phase 6 综合验证（全绿）

```text
python -m unittest discover -s pipeline/tests      # Ran 43 tests, OK
npx tsc --noEmit                                    # exit 0
node scripts/test-dashboard-ui-contract.mjs         # ok
node scripts/test-product-management-current-contract.mjs  # ok
npx vite build                                      # built in 1.71s
python pipeline/sync.py sync                        # exit 0
```

snapshot 4 模块状态：priceStructure=ready、sizeStructure=ready、spuSalesTrend=ready、customizationStructure=degraded。

### 8.4 多模态复验清单（第二轮）

启动应用访问商品管理页，4 个 Tab 现在都有真实内容：

- [x] 价格结构 Tab：同 5.1（已验过，确认 bug 修复后金额占比合计仍 100%）——API 实测合计 1.000000，1440px 视觉确认 7 档表 + 3 矩阵 + 口径说明
- [x] 尺寸结构 Tab：尺寸分布表 10 行，来源列显示"产品主数据/颜色规格"，未填写尺寸提示，2 个矩阵（类别 16 行 / TOP15 产品 15 行）——实测未填写 1,430 行（1.1%）提示在表尾，q18 覆盖 90.1%
- [x] SPU 销量 Tab：SPU 汇总表 78 行按商家实收降序，SPU×渠道矩阵 16 行×7 列（含合计列），类别日趋势表——M77 居首（合计 36,090），日趋势日期升序
- [x] 定制结构 Tab：顶部橙色降级提示，常规 vs 定制对比表（定制 1943 行），7 标签明细表，TOP20 履约表
- [x] 320px 宽度：Tab 导航横向滚动不裁剪（bug 修复验证）——容器 scrollWidth=878>288，10 Tab 单行 40px，末位"定制结构"滚动后完整可见
- [x] 4 个 Tab 在 320/768/1024/1440 宽度无横向页面溢出——16/16 自动化断言通过，320px 下宽表卡片内滚动正常
- [ ] 现有 6 个 Tab 无回归——本轮验证 6 Tab 均渲染非空、切换正常、控制台 0 error、0 失败请求；但仍无改动前数值 baseline，数值一致性无法严格证明（同 5.3 残留限制）

### 8.5 多模态复验记录（2026-07-24，Kimi Code）

复验环境：5180 生产进程（2026-07-18 启动）。已确认 `server/index.mjs`/`server/warehouse.mjs` 自该日起无改动，且快照按请求读盘（`readWarehouseSnapshot` 无内存缓存），磁盘快照为 Phase 6 刷新版本，故旧进程不影响本轮复验有效性。`server/dingtalk-api.mjs` 有未提交修改未进入该进程，与商品管理无关，重启后才会生效。

- API 层 34 项断言：`output/playwright/verify-product-structure-api.mjs`，33/34 通过；唯一 FAIL 是脚本期望写错指标（把全链路识别率 98.9% 当成 q18 覆盖率），实测 `quality.coverage.orderLineRatio=0.9008` 与交接一致，数据无问题。
- UI 层 28 项断言 + 截图：`output/playwright/verify_product_structure_ui.py`（python-playwright + chromium_headless_shell-1228），28/28 通过；控制台 0 error、0 warning、0 失败请求。
- 截图证据：`output/playwright/round2-*.png`（4 新 Tab × 1440/320、Tab 导航 320 起止、6 旧 Tab 1440）。
- 冒烟：`npm run test:smoke` 通过（注意该脚本默认打 5173 端口，5173 上另有一个健康实例：warehouse 2,702,637 行、dingtalk 7,899、feishu 7,590、agents 12/12）。
- 残留限制：旧 Tab 数值回归仍缺改动前 baseline；SPU 类别日趋势 1,827 行全量渲染导致页面 8,400px 高（8.6 已记为已知限制）。

### 8.6 已知限制

- 定制结构模块为降级版，信号弱（1.5%），不等同参考看板 7 类标签。需接入 ERP 定制字段才能完整。
- 定制 comparison 的 grossMargin 暂为 null（成本口径复杂，未计算）。
- SPU 日趋势 `dailySpuTrend` 全量化后 5476 点（78 SPU），snapshot 增至 4.44MB。前端已做多选搜索+折线图（见第 9 节）。
- 价格/尺寸/SPU 的 coverage.productCodeRatio 均为 null（未统计 distinct 编码）。

## 9. SPU 日销量趋势图表（2026-07-24 第三轮）

### 9.1 方案

模仿参考看板"SPU产品商编日销量趋势"，按用户决策改为**多选 SPU 折线对比**（参考看板是单 SPU 柱状图；移植其 `salesLineChart` 多折线实现）。搜索框支持 **SPU 编码 + 产品名称** 模糊匹配。

### 9.2 改动

后端（[product_structure_builders.py](pipeline/ecom_pipeline/product_structure_builders.py) `build_spu_sales_trend`）：

- `dailySpuTrend` 改全量 SPU 日趋势（去掉 TOP15 限制，5476 点，78 SPU）
- `summaries` 加 `productName`（q18 产品名称 `any_value`）
- 类型 `ProductSpuSummary` 加 `productName` 字段

前端新建：

- [SpuTrendLineChart.tsx](src/components/product-management/SpuTrendLineChart.tsx)：纯 SVG 多折线 + hover tooltip + 图例（移植 `salesLineChart`）
- [SpuSearchSelect.tsx](src/components/product-management/SpuSearchSelect.tsx)：多选 combobox，输入模糊匹配 SPU 编码+产品名称，tag 显示选中项

[SpuSalesTrendPanel.tsx](src/components/product-management/SpuSalesTrendPanel.tsx) 改造：

- 顶部搜索框（默认选中 TOP5）+ 折线图
- 选中 SPU 变化时前端本地筛选 `dailySpuTrend` 重新拼折线（Map 索引 O(1) 查找）
- 移除类别日趋势表格（折线图替代）
- 保留 SPU 汇总表（加产品名称列）+ 渠道矩阵

### 9.3 验证（全绿）

```text
npx tsc --noEmit                                    # exit 0
python -m unittest pipeline.tests.test_product_structure_builders  # Ran 25 tests, OK
python pipeline/sync.py sync                        # exit 0（snapshot 4.44MB）
node scripts/test-product-management-current-contract.mjs  # ok
node scripts/test-dashboard-ui-contract.mjs         # ok
npx vite build                                      # built in 2.09s
```

snapshot：dailySpuTrend 5476 点、78 SPU，summaries[0] = M77｜豆7，defaultSpus TOP5 = M77/M5209/M88/M610/S502。

### 9.4 多模态复验清单（第三轮）

启动应用访问商品管理页 SPU 销量 Tab：

- [x] 顶部搜索框显示，默认选中 5 个 SPU tag（M77｜豆7 等）——实测 5 tag：M77｜豆7 / M5209｜豆芽3.0 / M88｜护脊宝4.0 / M610｜豆苗 / S502｜豆芽4.0
- [x] 折线图渲染 5 条折线 + 图例，X 轴日期、Y 轴销量、网格线——5 polyline + 880 circle + 5 网格线 + Y 刻度 + X 日期（01-20~07-23）
- [x] 鼠标悬停折线图：显示日期 + 各 SPU 当日销量，垂直 guide line 跟随鼠标 X——tooltip 实测"2026-05-31 M77 637 件…"，guide line x1 随鼠标移动
- [x] 搜索框输入"豆7"：下拉显示含"豆7"的 SPU 选项（最多 50 项）——实测 1 项（M77｜豆7，全库"豆7"精确匹配仅 M77）
- [x] 点击下拉项：添加该 SPU 折线，tag 增加——先删 M77 再搜"豆7"点选加回，tag 4→5、折线 4→5
- [x] 点击 tag 的 X：移除该 SPU 折线——tag 5→4、折线 5→4
- [x] SPU 汇总表新增"主产品名称"列
- [x] 320/768/1024/1440 宽度折线图自适应（SVG width:100%）——svgWidth 实测 258/698/734/1150，均无页面横向溢出
- [x] 现有价格/尺寸/定制 Tab 无回归——3 Tab 渲染断言通过，控制台 0 error、0 失败请求

### 9.5 已知限制（更新）

- `dailySpuTrend` 全量化使 snapshot 增 1.17MB（3.27→4.44MB）。若后续 SPU 数或日期范围大增，可改回按需 API（`?spu=` 参数）。
- 折线图 hover tooltip 用固定位置（图例下方），不跟随鼠标 Y；guide line 跟随鼠标 X。
- 搜索框下拉最多显示 50 项匹配。

### 9.6 多模态复验记录（2026-07-25，Kimi Code，第三轮）

复验环境：5180 生产进程（磁盘快照 07-25 10:01 刷新，duckdb 无独占锁；PID 54656 已结束，只读打开 ecom.duckdb 成功）。

- API 层：`dailySpuTrend` 5,476 点 / 78 SPU，`summaries[].productName` 全量存在（M77｜豆7，44,320,540 元居首），前端默认选中 `defaultSpus.slice(0,5)`。
- UI 层 35 项断言：`output/playwright/verify_spu_trend_ui.py`（python-playwright），35/35 通过；截图 `round3-spu-*.png`。
- 参考看板实证：`output/playwright/shot_ref_dashboard.py` 打开本地参考 HTML，确认"SPU产品商编日销量趋势"布局（截图 `ref-spu-trend-panel.png`），提炼修改需求见第 10 节。

## 10. 对齐参考看板 SPU 趋势图的修改需求（2026-07-25 提出）

对照 `参考文件/2026年5月订单经营最终复盘看板.html` "商品销量"板块的"SPU产品商编日销量趋势"（实证截图 `output/playwright/ref-spu-trend-panel.png`），**排除柱状 vs 折线、单 SPU 卡片 vs 多选对比两项已决策差异**后，当前实现的差距与需求如下：

| # | 优先级 | 需求 | 参考看板做法 | 当前实现 |
|---|---|---|---|---|
| R1 | P1 | 数据点数值直接标注：选中 1 个 SPU 时在各数据点上方标注当日销量；≥2 个时不标注（避免拥挤），保留 hover | 所有非零日期的数值直接标在图形上方（8.5–10px，防溢出 `max(15,y-4)`），无需交互即可读数 | 图上无数值标注，必须 hover 才能读数 |
| R2 | P1 | hover tooltip 对齐：浮层跟随鼠标位置（clamp 在卡片内、`pointer-events:none`），table 排版逐系列列出，末尾加"当日合计"行 | `.sales-hover-tip` 跟随鼠标 X/Y，含 `tr.total` 当日合计行 | tooltip 固定于图例下方、纯文本行、无合计（9.5 已记） |
| R3 | P2 | 筛选器布局与作用域标识：搜索框移至卡片 head 右侧（或加边框/底色强调），说明文案对齐"默认选中销量 TOP5；搜索框可选择全部 SPU，仅影响此趋势图" | 筛选器在 panel-head 右侧，橙色 2px 边框 + 橙底 label 突出"仅影响此趋势图"，note 动态更新当前状态 | 搜索框在正文顶部，样式与普通输入框一致，作用域仅靠 12px 静态小字说明 |
| R4 | P3 | 折线图例色块改线段样式（16×3 圆角），与折线视觉一致 | `.sales-line-legend i` 为 16×3 圆角线段 | 10×10 方块（更像类别图例） |

已一致项（无需修改）：X 轴日期稀疏策略（首末 + 每 1/6）、"单位：件"左上标注、空态文案、选项格式 `SPU｜产品名称`、筛选器仅影响趋势图的解耦设计、日期范围联动。

实施提示：R1 单选标注可参考参考看板 `salesChart` 的字号与防溢出处理；R2 可直接移植 `bindSalesLineTooltip` 的 clamp 定位与合计行；两项均只改 [SpuTrendLineChart.tsx](src/components/product-management/SpuTrendLineChart.tsx)，不动数据层。

### 10.1 R1+R2 实施（2026-07-25）

已实施 R1+R2，只改 [SpuTrendLineChart.tsx](src/components/product-management/SpuTrendLineChart.tsx)：

- **R1 数据点标注**：`series.length === 1` 时在各非零数据点上方标注数值（字号 8.5，`y = max(15, yFor(val) - 4)` 防溢出）；≥2 个 SPU 时不标注。
- **R2 tooltip 对齐**：浮层跟随鼠标位置（`left/top` 用 `Math.max/Math.min` clamp 在容器内，`pointer-events: none` 不阻挡鼠标），table 排版逐系列列出 + 末尾"当日合计"行；guide line 跟随鼠标 X。
- R3（筛选器移至 head 右侧）/ R4（图例改线段样式）未做，P2/P3 待确认。

验证：`tsc --noEmit` + `vite build` + `test-dashboard-ui-contract` 全绿；未动后端，无需 sync。

### 10.2 多模态复验清单（R1+R2）

- [x] 单选 1 个 SPU（删到只剩 1 个 tag）：图上每个非零数据点上方显示数值——实测 172 个标注（颜色问题见 R8）
- [x] 多选 ≥2 个 SPU：图上无数值标注（避免拥挤）——加回 M5209 后标注数 0
- [x] hover：tooltip 浮层跟随鼠标移动，不超出卡片边界——p1(727,464)→p2(1130,445)，clamp 在卡片内
- [x] tooltip 含 table 排版（各 SPU 一行）+ 末尾"当日合计"行——实测"2026-04-06 …当日合计 204 件"
- [x] tooltip 不阻挡鼠标（pointer-events:none，可平滑滑动）
- [x] guide line 跟随鼠标 X
- [x] 单选标注 + hover tooltip 同时工作不冲突

功能全过；tooltip 背景透明属 UX 缺陷，见 10.5/R5。

### 10.3 R3+R4 实施（2026-07-25）

已实施 R3+R4：

- **R3 筛选器布局**：[SpuSalesTrendPanel.tsx](src/components/product-management/SpuSalesTrendPanel.tsx) 搜索框移至 Card `action`（head 右侧，`width: min(420px, 50vw)`）；说明文案加橙色"仅影响此趋势图"强调 + 动态"当前已选 N 个 SPU"。
- **R4 图例线段**：[SpuTrendLineChart.tsx](src/components/product-management/SpuTrendLineChart.tsx) 图例色块从 10×10 方块改 16×3 圆角线段，与折线视觉一致。

验证：`tsc --noEmit` + `vite build` + `test-dashboard-ui-contract` 全绿；未动后端，无需 sync。

### 10.4 多模态复验清单（R3+R4）

- [x] 搜索框在卡片 head 右侧（标题左、搜索框右两端对齐）——titleX=255 < searchX=985，searchRight=1405=headRight
- [x] "仅影响此趋势图"橙色强调显示
- [x] "当前已选 N 个 SPU"动态更新（增删 SPU 时数字变）——5→1 实测更新
- [x] 图例为 16×3 圆角线段（非 10×10 方块）——实测 16×3
- [x] 320/768/1024/1440 搜索框自适应（min(420,50vw)）——实测 160/384/420/420
- [x] 搜索框下拉浮层不被卡片裁剪——dd=(985,371,420×280) 在卡片内（但背景透明，见 R5）
- [ ] head 右侧搜索框在窄屏不挤压标题换行——**未通过**：320px 下标题被挤成 2 行（height=42），且 5 个 tag 在 160px 框内竖排撑高 head（截图 `round4-head-320.png`）；修复方案见 R6/R9

### 10.5 UX 审查记录（2026-07-25，Kimi Code，第四轮）

自动化 31 项断言 30/31 通过（`output/playwright/verify_r1r4_ui.py`），另以人类用户视角实证 4 类 UX 缺陷：

1. **下拉浮层全透明（用户指出，实证确认）**：computed `backgroundColor: rgba(0,0,0,0)`，选项文本直接压在折线图与网格线上不可读（截图 `round4-dropdown-open-1440.png`）。
2. **tooltip 全透明（连带发现）**：R2 新 tooltip 同样 `bg-[var(--paper)]`，网格线穿过 tooltip 文字（截图 `round4-tooltip-multi-1440.png`）。
3. **控件边界不可辨（用户指出，实证确认）**：搜索框 bg 透明 + border 仅 `1px solid rgba(175,203,190,0.11)`，用户分不清这是控件还是文字（截图同上）。
4. **多选 tag 堆叠（用户指出，实证确认）**：tag 全部堆在输入框内，320px 下 5 个 tag 竖排 5 行撑爆 head、标题被挤换行（截图 `round4-head-320.png`）。

**根因**：组件从参考看板移植时带入了本项目未定义的变量名 `--paper` / `--green-soft` / `--ink`（`SpuSearchSelect.tsx` 50/56/79/102 行、`SpuTrendLineChart.tsx` 64/72 行），`bg/text-[var(--xxx)]` 全部失效为透明/继承。另 R1 单选标注 `fill="#31445b"` 为浅色主题色，深色背景上对比度不足（`round4-single-hover-1440.png` 中"1,179"几乎不可读）。

## 11. 第四轮 UX 修改需求（2026-07-25 提出）

| # | 优先级 | 需求 | 验收 |
|---|---|---|---|
| R5 | P0 | 修复失效变量：`--paper`→不透明底色（如 `var(--panel-solid)`）、`--green-soft`→`var(--green-bg)`、`--ink`→`var(--text)`；覆盖搜索框/下拉/tag/tooltip/图例 | computed bg 非 transparent；下拉与 tooltip 文字在折线图上方清晰可读 |
| R6 | P1 | 多选不堆叠：输入框内不再渲染 tag 列表，框内仅显示"已选 N 个 SPU"类摘要；选中态改在下拉列表内高亮 + ✓，再次点击取消 | 任意选中数下搜索框高度恒定 ≈38px；下拉内选中项高亮可辨 |
| R7 | P1 | 控件边界强化：搜索框不透明底色 + 更可见边框（`var(--border-2)` 或聚焦态品牌色描边），对齐参考看板"2px 高亮边框标识控件"的可辨性目标 | 用户一眼可辨控件边界（截图对比） |
| R8 | P2 | 图表深色适配：单选标注 `#31445b`→亮色（`var(--text)`/浅色），网格线 `#e8edf3`→暗色（如 `rgba(175,203,190,0.14)`），轴标签 `#66758c`→`var(--muted)` 系 | 单选标注在深色背景清晰可读 |
| R9 | P2 | 320px head 布局：搜索框与标题上下两行（或搜索框 width:100%），标题单行不换行（R6 实施后自然缓解） | 320px 标题 height ≤30px，head 不被 tag 撑高 |

实施提示：R5 只改两个组件的 className，零逻辑风险，建议最先做；R6 改 `SpuSearchSelect.tsx` 结构（框内摘要 + 下拉高亮），交互参考常规多选下拉；R8/R9 顺带完成。

### 11.1 R5–R9 实施（2026-07-25）

已全部实施，未动后端：

- **R5 变量替换**：[SpuSearchSelect.tsx](src/components/product-management/SpuSearchSelect.tsx) + [SpuTrendLineChart.tsx](src/components/product-management/SpuTrendLineChart.tsx) 把失效变量 `--paper`->`--panel-solid`、`--green-soft`->`--green-bg`、`--ink`->`--text`、`--canvas`->`--bg-2`，覆盖搜索框/下拉/tag/tooltip/图例。下拉与 tooltip 现在不透明。
- **R6 多选不堆叠**：[SpuSearchSelect.tsx](src/components/product-management/SpuSearchSelect.tsx) 框内不再渲染 tag 列表，仅显示"已选 N 个 SPU"摘要 + 搜索 input；选中态改在下拉列表内 `bg-[var(--green-bg)]` 高亮 + ✓，再次点击取消。搜索框高度恒定 ≈38px。
- **R7 控件边界强化**：搜索框 `bg-[var(--panel-solid)]` + `border-[var(--border-2)]` + `focus-within:border-[var(--brand)]` 描边。
- **R8 图表深色适配**：[SpuTrendLineChart.tsx](src/components/product-management/SpuTrendLineChart.tsx) 单选标注 `fill="var(--text)"`、网格线 `stroke="var(--border)"`、轴标签/单位 `fill="var(--muted)"`、guide line `stroke="var(--muted-2)"`、基线 `stroke="var(--border)"`（均改用 CSS var，适配深色背景）。
- **R9 320px head 布局**：[styles.css](src/styles.css) 加 `.card-spu-trend .section-title { flex-wrap: wrap }`；[SpuSalesTrendPanel.tsx](src/components/product-management/SpuSalesTrendPanel.tsx) Card 加 `className="card-spu-trend"`，搜索框 `w-[min(420px,50vw)] max-md:w-full`。窄屏搜索框换到标题下方占满宽度，标题单行不被挤。

验证：`tsc --noEmit` + `vite build` + `test-dashboard-ui-contract` 全绿；未动后端，无需 sync。

### 11.2 多模态复验清单（R5–R9）

- [x] 搜索框背景不透明（`--panel-solid`），下拉浮层文字在折线图上方清晰可读——computed bg `rgb(16,28,32)`，截图 `round5-dropdown-open-1440.png`
- [x] tooltip 背景不透明，网格线不再穿过 tooltip 文字——computed bg `rgb(16,28,32)`，截图 `round5-tooltip-1440.png`
- [x] 搜索框内不堆叠 tag，只显示"已选 N 个 SPU"摘要 + 搜索 input——无 `移除` tag 按钮，摘要实测"已选 5 个 SPU"
- [x] 任意选中数下搜索框高度恒定 ≈38px——4/5/6 个选中实测均 38.0px
- [x] 下拉内选中项高亮（`--green-bg`）+ ✓，再次点击取消——computed `rgba(133,216,63,0.14)`，点 M5209 取消（5→4）、再点加回、加选 M662（→6）均正确
- [x] 搜索框边界清晰（`--border-2`），聚焦时 `--brand` 描边——`rgba(175,203,190,0.2)` → 聚焦 `rgb(166,229,54)`
- [x] 单选 SPU 时数据点标注在深色背景清晰可读（`--text` 色）——computed fill `rgb(237,243,239)`，172 个标注，截图 `round5-single-labels-1440.png`
- [x] 网格线/轴标签/单位文字深色适配（不刺眼、可读）——网格 `rgba(175,203,190,0.11)`、轴标签 `rgb(157,179,173)`
- [x] 320px 下搜索框 width:100% 换到标题下方，标题单行不换行，head 不被撑高——titleHeight=21、搜索框 258px 满宽、高 38px，截图 `round5-head-320.png`
- [x] 1440px 下搜索框在 head 右侧（min(420,50vw)），标题左对齐——titleX=255、ctrlRight=1405=headRight，截图确认同一行（自动化对标题/控件顶边差 9px 的断言过严，视觉为基线对齐同一行）

### 11.3 复验记录（2026-07-25，Kimi Code，第五轮）

- 脚本 `output/playwright/verify_r5r9_ui.py`，30 项断言 29/30 通过；唯一 FAIL 为断言阈值过严（标题文字与 38px 控件顶边差 9px，属基线对齐的正常表现），截图人工确认 1440px 同行无误。
- 10 项清单全部经 computed style + 截图双重证实；控制台 0 error、0 失败请求。
- 交互路径变化备注：tag 移除按钮已随 R6 移除，增删 SPU 全部经下拉列表点击完成（选中项 ✓ + 高亮，再次点击取消）。
- 截图证据：`round5-dropdown-open-1440.png`、`round5-tooltip-1440.png`、`round5-single-labels-1440.png`、`round5-head-320.png`。

## 12 第六轮：控件配色协调化（2026-07-25，Kimi Code）

用户反馈：选中态荧光绿（`--brand`/`--green`）过于抢眼，下拉 UI 与文字参考《2026年5月订单经营最终复盘看板.html》原生 select（白色列表 + 蓝色选中高亮 + 宽松行高）协调化。仅改 [SpuSearchSelect.tsx](src/components/product-management/SpuSearchSelect.tsx)，未动后端：

- 控件聚焦描边 `focus-within:border-[var(--brand)]` → `focus-within:border-[var(--blue)]`。
- 下拉选中态 `bg-[var(--green-bg)] text-[var(--green)]` → `bg-[var(--blue-bg)]` + 蓝色文字/✓（`var(--blue)`）；未选中项 hover 改 `hover:bg-[var(--bg-elevated)]`。
- 下拉面板/选项行向参考图靠拢：面板 `rounded-lg p-1 max-h-[300px]`，选项行 `px-2.5 py-2 text-[12.5px] rounded-md`（行高更宽松）；SPU 编码 `font-medium text-[var(--text)]`、产品名称 `text-[var(--muted)]` 两色层次。
- 空态面板统一 `rounded-lg shadow-xl py-2.5 text-[12.5px]`。
- 修复复查中新发现的问题：input 获焦时出现荧光色矩形环。根因是 [styles.css](src/styles.css) 全局非分层规则 `:focus-visible { outline: 2px solid var(--brand) }` 会盖过 Tailwind 的 `outline-none`（分层样式优先级低于非分层）。最小修复：input 加内联 `style={{ outline: "none" }}`——外层容器已有 `focus-within` 蓝色描边表达焦点，无障碍焦点可见性不丢失。全局 `:focus-visible` 规则未动（影响整站）。

验证（全部通过）：

- `npx tsc --noEmit` + `npx vite build` 绿（built in 1.88s，dist 已刷新，5180 生产服务按请求读盘立即生效）。
- 探针 `output/playwright/shot_round6_dropdown.py` computed 实测：选中项 bg `rgba(73,191,227,0.14)`（蓝色系）、聚焦描边 `rgb(73,191,227)`；截图复查确认 input 荧光环消失。
- 截图证据：`round6-dropdown-blue.png`（下拉蓝色选中态 + 两色文字 + 不透明面板）、`round6-full-1440.png`（全页协调、无荧光残留）。

说明：图例与折线颜色（含绿色系 SPU 折线）属图表数据配色，不在本轮"控件荧光色"范围内，未动。
