# PROGRESS · 渠道质量判断 callout 增加分析维度

## 开工回执（2026-08-01）
- 目标：把「渠道质量判断」callout 从 2 维度（毛利率+体量）扩到 5 维度（加退款率/件单价/毛利额贡献），抽成纯函数 + 行为测试 + 更新规格。
- 顺序：任务 1（抽 channelQualityJudge.ts 纯函数）-> 任务 2（行为测试）-> 任务 3（更新 spec）-> 反向验证 -> 验收。
- 最大风险：①件单价/毛利贡献值的断言易被千分位或小数位格式击穿，已选无千分位样本值（980/46.2/12.4/90.0）规避；②strip-types 跑 .ts 导入链路失败（实测通过）。

## 基线（任务 0 实测）
- node v26.1.0；`node scripts/test-dashboard-ui-contract.mjs` -> ok (exit 0)；`npm run typecheck` -> exit 0。

## 进度
- [x] 任务 0：基线核对通过。
- [x] 任务 1：抽 `channelQualityJudge.ts` 纯函数，织入 5 维度；`ChannelQualityPanel.tsx` 删旧 `buildCallout`、改调用 `judgeChannelQuality`。
- [x] 任务 2：`scripts/test-channel-quality-judgment.mjs` 3 用例（5 维度断言 / 全 null 降级 / 单渠道），绿。
- [x] 任务 3：`_channel_quality_spec.md` 第三节改为多维度动态结论说明，删旧两句模板原文样例。
- [x] 反向验证：临时回退旧 2 维度逻辑 -> 测试红（「12.4」断言失败，exit 1）-> 还原 -> 绿（exit 0）。

## 验收（2026-08-01 实测）
- 门 1 `node --experimental-strip-types scripts/test-channel-quality-judgment.mjs` -> `channel quality judgment: ok`，exit 0。
- 门 2 `node scripts/test-dashboard-ui-contract.mjs` -> `dashboard-ui contract: ok`，exit 0。
- 门 3 `npm run typecheck` -> exit 0。
- 门 4 白名单：本次只动 6 个白名单文件（均为未跟踪文件），无跟踪文件被改动；git status 的 M 文件与会话起始一致。

---

# PROGRESS · 商品运营画册

## 开工回执（2026-08-01）
- 目标：新增商品画册页签，以产品汇总为卡片，点击核对全部 SKU 的实收、毛利、销量和等长上期变化。
- 顺序：先冻结数据契约并跑红，再补聚合跑绿；随后冻结 UI 契约、实现画册，最后做六宽度真实浏览器验收。
- 最大风险：现有 46 个已跟踪改动与 57 个未跟踪路径必须原样保留；SKU 单品最多 350 行，抽屉需分页；图片多义不得错配。
- 当前基线：`/api/products` 为 336 个产品汇总、4058 个 SKU、206 个多 SKU 产品；现有三项 npm 契约、typecheck、48 个 Python tests、`git diff --check` 均通过。
- 工作方式：目标书禁止顺手提交，故用白名单测试 hash 与红→绿输出替代 TDD checkpoint commit。
- [x] 任务 0：规则、scoped diff、数据形状、服务、测试与图片参考均已复核。
- [x] 任务 1：数据契约先因缺少 `imageUrl` 双 RED；实现 SKU 毛利/等长上期、产品唯一白名单图后，真实接口、49 个 Python tests、图片契约与 typecheck 全绿。反向把唯一候选条件从 1 改为 2 时测试红，复原绿；冻结 hash `5c994c1c...` / `274f9372...` 不变。
- [x] 任务 2：新增商品画册、20 张卡分页、搜索/排序、可访问详情抽屉与 20 行 SKU 分页；UI 契约先因组件不存在 RED，后 GREEN。临时把画册 testid 改为错误值时得到“缺少 product-gallery 稳定定位”RED，复原后 GREEN；冻结 hash `c967098b...` 不变。

## 最终验收（2026-08-01）
- 接口与画册：当前按周期重算接口为 336 个产品、4058 个 SKU，画册显示 `336 / 336`；30 张卡获得唯一白名单主图，非白名单为 0，SKU 新字段缺失为 0，隐私标记仍为 `false/false`。筛到 2026-07-01~07-31 时，143 个产品、1730 个 SKU 有等长上期值，豆7实收变化实算为 -33.18%。
- 数据抽样：随机抽到 `MD906`（7 SKU）、`M16`（5 SKU）、`M03`（79 SKU），三者的 SKU 实收、销量、毛利额与产品总计差值均为 0。旧缓存快照多 SKU 产品为 206，当前按周期重算为 205；产品数与 SKU 数未变，属于旧缓存与当前重算的分组快照差异，未触发同步。
- 浏览器路径：真实点击“商品画册”→卡片→SKU 第 18/18 页→SKU 搜索→Esc/关闭；SKU 反查、四种排序、空结果、键盘 Enter 打开、焦点回卡片均通过，控制台 `Errors: 0`。
- 响应式：1440/1280/1024/768/390/375 分别为 4/4/3/2/1/1 列，六档根溢出差均为 0；390 抽屉宽 390px，SKU 表仅内部横滚 305px，主图实测 280×280。
- 截图：`output/playwright/product-gallery-1440.png` 与 `output/playwright/product-gallery-390.png` 已生成并目检。
- 回归：`test:products`、`test:powerbi-images`、`test:dashboard-ui`、`typecheck`、`build`、49 个 Python tests 与 `git diff --check` 全绿；未新增 `skip/todo`，数据/UI 三个冻结 hash 仍为 `5c994c1c...`、`274f9372...`、`c967098b...`。
- 工作树：只叠加目标书白名单文件与两张指定截图；未提交、未同步数仓、未修改接口路径/筛选参数/依赖。
