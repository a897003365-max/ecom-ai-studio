# 运行与验证日志

本文件只记录可复核的运行事件、数据口径修复和验证结果；日期使用 YYYY-MM-DD。

## 2026-08-25

### 钉钉同步早间计划时间由 10:30 调整为 11:00

- 背景：运营要求看板早间更新从 10:30 推迟到 11:00（当日 10:30 已按旧计划正常执行一次，LastResult=0）。
- 改动（唯一口径来源为注册表 `HKCU:\Environment\DINGTALK_SYNC_TIMES`）：
  - 注册表值 `10:30,13:00,17:30` → `11:00,13:00,17:30`；
  - 重新运行 `scripts/register-dingtalk-schedule.ps1` 重建 `EcomAIStudio-DingTalk-Sync`（S4U/Limited/网络可用/失败重试属性保持不变），触发器验证为 11:00、13:00、17:30，State=Ready；
  - 代码回退默认值同步更新：`server/dingtalk-api.mjs`（scheduleTimes 默认串）、`scripts/register-dingtalk-schedule.ps1`（$Times 回退）、`src/pages/AnalyticsPage.tsx`（页头"每日同步计划"回退文案）；
  - `scripts/test-dingtalk-api.mjs` 两处断言改为 11:00；
  - 文档口径同步：AGENTS.md、docs/HANDOFF.md（§2 与 §8）、docs/OPERATIONS_DATA_INTEGRATION_PLAN.md、README.md（架构图与环境变量示例）。
- 验证：`npm run test:dingtalk-api`、`npm run test:dingtalk-unattended` 通过；计划任务 NextRun 指向当日 11:00（改动时点在 10:30 旧计划跑完之后、11:00 之前，新计划当日即生效）。
- 注意：`readLocalEnv` 优先读进程环境变量、其次注册表；改动前启动的旧 shell 会话与 dev server 进程会残留 10:30 展示值，新起进程一律从注册表读 11:00。改动时点 5180/5173 无运行中服务，下次启动自然生效，无需重启操作。

## 2026-08-07

### yudao 业务管理后台集成（方案 A：服务端只读代理）

- 背景：调研 yudao-boot-mini 后确定用它的人工录入后台承载看板缺失的档案类数据（商品档案、店铺渠道、竞品价格）；集成方式为方案 A——看板 Node 服务端以只读服务账号调 yudao REST API，前端不直连、不感知 yudao。不做 SSO/权限托管/Java 迁移，钉钉权威口径与数仓链路不动。
- 环境（全部绿色安装，未污染系统）：JDK17/Maven/MySQL 8.0.42（3306，root/123456，库 ruoyi-vue-pro）/Redis 5.0.14（6379）在 `E:/Github/yudao-env/`；后端仓库 `E:/Github/yudao-boot-mini`（48080）；管理 UI `E:/Github/yudao-ui-admin-vue3`（48081，pnpm dev）。yudao 与看板分属不同仓库，互不进对方 git。
- ecom 模块：新增 `yudao-module-ecom`，代码生成器产出 4 张表 CRUD——`ecom_channel`（7 渠道）、`ecom_store`（24 店铺）、`ecom_product`（335 商品，种子自 PowerBI 快照）、`ecom_competitor_price`（0 行，留待业务录入）；菜单挂在父菜单「电商数据」（id 6735）下；admin UI 生成页面经 vite transform 编译验证。
- 修复：`ecom_competitor_price.low_30d` 列被 MyBatis Plus 反推为 `low30d`，create 报 `Unknown column 'low30d' in 'field list'`；在 `CompetitorPriceDO.java` 加 `@TableField("low_30d")` 重建后修复。教训：列名含「下划线+数字」时代码生成器反推不可靠，需显式注解。
- 服务账号：`ecomdashboard`，角色 id 160 仅含 4 个 `ecom:*:query` 权限；越权写操作返回 403 已验证。看板 `.env` 增加 `YUDAO_BASE_URL/YUDAO_USERNAME/YUDAO_PASSWORD/YUDAO_TENANT_ID`；dotenv 会把未加引号值中的 `#` 当注释截断，密码必须写成 `YUDAO_PASSWORD="..."`（带引号），`.env.example` 已注明。
- 看板改动：`server/yudao-client.mjs`（新增，登录缓存+分页拉取）；`server/index.mjs` 新增 `GET /api/masterdata/competitor-prices`（intelligence.view）与 `GET /api/masterdata/products`（products.view），yudao 不可达/登录失败时 HTTP 200 返回 `{items:[],total:0,degraded:true,reason}` 不炸页面；前端 `IntelligencePage` 竞品价格页签脱离 mock 接 API（loading/降级/空态三态），mock.ts 对应段落已删；`SettingsPage` 增加到 48081 后台的外链卡片。
- 验证：端到端链路（admin 建测试行 → 看板 5199 测试实例读到 total=1 且 `low30d=1499` 字段映射正确 → 删除 → 回空态）通过；`npm run build`、`git diff --check` 通过。注意 Windows Git Bash 下 `curl -d` 带中文会发 GBK 字节导致 yudao 500，中文测试一律用 node fetch。
- 菜单修复（同日，管理 UI 登录后卡登录页/404 的根因）：① 父菜单「电商数据」（id 6735）的 `path` 原写为 `ecom`，vue-router 要求顶级路由以 `/` 开头，登录后动态注册路由直接抛 `Route paths should start with a "/"`，已改为 `/ecom`；② 渠道/商品菜单的 `component_name` 原为 `Channel`/`Product`，与 yudao 自带路由（如 `/im/channel` 名为 `Channel`）重名——vue-router 同名后注册者会顶掉先注册者，导致 `/ecom/channel`、`/ecom/product` 404，已改为 `EcomChannel`/`EcomProduct`。教训：代码生成器产出的菜单 SQL 落地后，须以真实浏览器登录 + 逐页打开验证，仅编译页面文件不够。5173 dev server 已于同日重启加载新后端代码，竞品价格页签在 5173 上确认为正常空态（非降级）。
- 看板入口菜单（同日新增）：「电商数据」下新增菜单 id 6760「运营看板入口」，`path=http://127.0.0.1:5173/`（外链菜单，前端 `meta.link` 机制 `window.open` 新标签页打开，非 iframe）；与看板「系统设置 → 业务管理后台」外链形成双向互通。真实浏览器验证：菜单出现、点击新标签页打开 5173 且完整加载、渠道/商品档案页回归正常。回滚：`DELETE FROM system_menu WHERE id=6760`。若看板入口改 5180：`UPDATE system_menu SET path='http://127.0.0.1:5180/' WHERE id=6760`。
- 遗留：4 个店铺（「神机榜」×2、兰知春序、崔氏家具）的渠道映射待业务方在后台补录；竞品价格表留空待业务录入；yudao 四件套（MySQL/Redis/server/UI）当前为手工启动的会话进程，未注册为 Windows 计划任务。

## 2026-08-05

### 顶部智能找数 v1.1：普通用户视角体验优化

- 背景：以普通用户口径实测 v1（直接驱动 `server/search-service.mjs` + 真实快照，钉钉 `completedThrough=2026-08-03`），发现三类问题：静默错答（"昨天/上个月/这个月"不识别时按全周期回答且无周期标识；"8月1日"单日被静默扩成整月；"退款率最高的渠道"被静默改答全渠道值）、实体死路（裸商品/裸渠道 unsupported）、浮层层叠 bug（见下）。
- 改动文件：
  - `server/search-service.mjs`：`parsePeriod` 新增昨天/前天/本周/上周/这个月/上个月/单日 `M月D日[号]`/中文完整日期/中文月份；含未识别时间词时落到最新完整数据日（不再静默全周期）；裸指标默认本月 MTD 并把实际周期回填答案卡；新增排名意图（渠道维度用快照平台行算 Top3 答案卡，店铺/商品维度降级为明示导航）；裸实体兜底（商品→销量/退货率/净销售额三卡，渠道→GMV/净回款/退款率三卡，店铺→明示导航）；无实体时带 kpi 聚合的商品指标（待发货件数/定制率）可直接回答；`OTHER_PAGES` 权限过滤修为 `${page}.view` 映射（权限管理页 admin.users）；实体索引指纹加入权限 salt，修复无商品权限调用复用含商品实体缓存索引的越权泄漏。
  - `server/search-catalog.mjs`：`normalizeTerm` 增加中文数字↔阿拉伯数字、o↔0 变体归一（豆七↔豆7、M52O9↔M5209），查询与索引两侧同规则。
  - `src/components/GlobalSearch.tsx`：答案卡数值提升为右侧大字号主视觉；定义卡去重并中文化（显示"站内推广费 ÷ 净回款"而非 spend/netRevenue）；unsupported 显示"没看懂这个问题，换个说法试试"，示例副标题改"试试这个问法"；kbd 按平台显示（Windows→Ctrl K）；面板底部加键盘提示；**浮层改 `createPortal` 挂到 document.body**。
  - `src/styles.css`：新增 `.global-search-item-value` / `.global-search-unsupported` / `.global-search-footer`。
  - `scripts/test-global-search-api.mjs`：新增 9/10/11 三节断言（口语时间词与默认周期、排名意图对账、裸实体/变体/KPI/页面导航权限）。
- 关键 bug（v1 预存）：搜索浮层渲染在带 `backdrop-blur` 的 `.topbar` 内，fixed 被困进 topbar 层叠上下文，主内容区压在浮层之上——鼠标点击结果被页头拦截、视觉上页面内容透进浮层。portal 到 body 后两者均消失（该问题在 v1 验收截图 02-search-modal-open.png 中已可见，当时未发现）。
- dev server（5173）已按 §11.6 重启为新后端；交接 §11.7 待复验项通过。
- 验证：`npm run test:global-search`（contract+api 新增 8 条用户口径查询断言）、`npm run typecheck`、`npm run build`、`npm run test:ux-polish`、`npm run test:select-theme`、`npm run test:products`、`npm run test:auth`、`npm run test:public-surface`、`npm run test:dingtalk-api`、`npm run test:analytics-sync`、`git diff --check` 均通过。浏览器实测（Playwright + 系统 Chrome）：六个固定验收查询 + 10 条新查询行为符合预期；答案卡大数值/周期 chip/页脚提示/unsupported 文案渲染正常；点击答案卡可导航并高亮目标区域；移动端 390×844 全屏浮层无横向溢出；控制台零错误（截图在 output/playwright/）。
- 预存在失败（与本次无关，保持记录）：`test:smoke` 因钉钉 2026-08-04 09:30 计划同步失败、健康状态 degraded 而断言失败（数据面沿用 08-04 05:03 成功快照）；`test:analytics-dashboard` 仍为 §11.8 记录的 sharedMax 预存在失败。
- 未做（沿用边界）：不接 LLM/向量库、不生成经营数字、不记录查询历史；排名仅用快照已有数据纯函数计算。

## 2026-07-25

### 商品经营明细字段补齐（对齐 .pbix）

- 背景：网站「天猫明细 -> 旗舰店整体 -> 商品经营明细」表对比 `D:\麻大师\BI文件\麻大师店铺推广数据报表.pbix`「07-旗舰店商品销售数据」商品粒度 measure，缺少「国补后金额(万)」「国补后金额同比」「销额占比」；原「商品费比」分母为支付金额，与 .pbix 减退金额口径不一致，无法对账。
- 决策：用「国补后费比」（`花费 / ((支付−退款)×0.85)`）直接替换原「商品费比」列，不保留旧口径；两层全做（纯派生字段 + 国补后金额同比数据层扩展）；数仓去年同期数据已确认可用。
- 字段真值来源：[migration/powerbi-tmdl/tables/07-旗舰店商品销售数据.tmdl](../migration/powerbi-tmdl/tables/07-旗舰店商品销售数据.tmdl)；完整方案与对账数据：[docs/POWERBI-PRODUCT-TABLE-FIELD-GAP-PLAN.md](POWERBI-PRODUCT-TABLE-FIELD-GAP-PLAN.md)。
- 改动文件：
  - `pipeline/ecom_pipeline/warehouse.py`：`_build_powerbi_pages` 增加 `product_daily_prior_year` 查询，窗口 `period_start−365 ~ period_end−365`（对齐 .pbix `DATEADD(-365, DAY)`），按 productId 聚合 payAmount/refund；空返回兜底 `[]`。
  - `src/types/integration.ts`：`PowerBiPages` 增加 `productDailyPriorYear: Array<{productId, payAmount, refund}>`。
  - `src/components/PowerBiReplica.tsx`：`OverallPage` 增加 `priorYearMap` + `totalSubsidized`；表头 13->16 列；行内派生国补后金额/销额占比/同比/国补后费比；「商品费比」由「国补后费比」替换；同比复用 `Delta` 组件（红绿箭头），去年同期数据缺失时渲染 `.pb-na`「数据不足」。
  - `src/styles.css`：`.pb-business-product-table` min-width 1120->1440；新增 `.pb-na`（muted 兜底样式）。
  - `scripts/test-powerbi-replica-contract.mjs`：新增 5 条断言（国补后金额/销额占比/同比/国补后费比列、priorYear 接入、pb-na、类型、数仓）。
  - 新增 `scripts/audit-product-subsidized-yoy.py`：数仓对账脚本，同步后随时可跑。
- 数据约束：`POWERBI_PAGE_WINDOW_DAYS = 60`，productDaily 只查最近 60 天；同比需去年同期数据，由新增 `product_daily_prior_year` 提供；缺失时前端降级「数据不足」，不显示错误的 0%。
- 口径对照：网站原「商品费比」= 花费/支付金额；.pbix「商品费比」= 花费/(支付−退款)；.pbix「国补后费比」= 花费/((支付−退款)×0.85)。本次采用国补后费比替换。
- 验证：
  - `node scripts/test-powerbi-replica-contract.mjs` -> `powerbi replica contract ok`。
  - `npx tsc --noEmit` 通过。
  - 数仓同步 `node scripts/sync-warehouse.mjs` 成功，period 2026-05-26 ~ 2026-07-24，2,716,580 记录。
  - 对账 `python scripts/audit-product-subsidized-yoy.py`：07 表覆盖 2024-08-17 ~ 2026-07-24；去年同期窗口 138 商品 = 快照 productDailyPriorYear 138 商品（完全一致）；公式自洽抽查（豆芽）`(13462424−4792175)×0.85/10000 = 736.9712万`，偏差 0.000000；Top60 中 49 个有去年同期数据，11 个去年未上架降级「数据不足」。
- 待人工核对：在 PowerBI Desktop 打开 `麻大师店铺推广数据报表.pbix`「07-旗舰店商品销售数据」页，对照方案文档 §6.1 Top10 表的「本期国补后(万)」「去年国补后(万)」「同比」三列数值。
- 注意事项：catalog 内部 `07-旗舰店商品销售数据` 映射到 `model_q08_*` 视图（query 清单编号与文件名编号不一致，属正常）；warehouse.py 用 query_name 查 `warehouse_query_catalog` 取视图，对账脚本同样用 catalog 查询，不要按 `model_q07_*` 表名硬查。Windows cp936 locale 下 python 源码中文字面量传给 duckdb 时 stderr 报错信息会乱码，但实际查询不受影响。

## 2026-07-16

### 账号登录与权限管理

- 按本地开发与 Agent 验收需要增加 `AUTH_ENFORCEMENT_ENABLED` 开关：默认 `0` 时以本地免登录管理员身份放行业务页面、API 和竞品图片；设置为 `1` 后恢复登录页、401/403 和逐用户权限校验。
- 登录页、账号库、密码哈希、会话、登录限流和“用户与权限”页面均保留；`npm run test:auth` 在强制模式下继续覆盖完整安全链路。
- 新增首次管理员初始化；后续登录同时校验邮箱、手机号和密码，不设置源码默认账号或密码。
- 密码采用 `scrypt` 加盐哈希；会话 Cookie 使用 HttpOnly、SameSite=Strict，服务端账号库仅保存令牌摘要并放在 `local-data/auth/`。
- 业务 API、同步、上传、任务和竞品图片均增加服务端权限校验；未登录返回 401、权限不足返回 403。
- 新增“用户与权限”页面：管理员可创建、停用用户，设置角色及页面查看/操作权限；最后一名启用管理员受到保护。
- 登录失败使用 15 分钟窗口限流；认证单元、接口契约和真实 HTTP E2E 均由 `npm run test:auth` 覆盖。
- 浏览器隔离验收完成：首次管理员创建成功；错误手机号无法登录；受限分析员仅显示工作台和运营看板；未授权卡片跳转被拦截；新建批次与同步数据按钮按操作权限禁用。
- 5180 生产预览当前以免登录模式运行；`/api/auth/status` 返回 `enforcementEnabled=false` 和本地免登录管理员，未带 Cookie 访问 `/api/data-sources`、`/api/analytics` 均返回 200。强制模式的未登录 401 行为由隔离 HTTP E2E 覆盖。
- 隔离账号全量 smoke 通过：本地数仓 2616350 行、钉钉 7719 行、飞书 7590 行、工作流 12/12；测试账号库和临时日志已清理。

### 全页面文案与互动优化

- 逐页复核 9 个用户页面，删除或改写 `mock`、MVP、原型、API/本机路径、复刻比例和“对齐参考看板”等开发过程文案。
- 工作台数据源说明改为数据量和可用状态；运营看板移除重复的数据管线说明；商品页修正“净销售额”和“件单价”命名并精简毛利率说明。
- PowerBI 复刻页移除 `LAYOUT REPLICA`、原始尺寸和运行管线标记，保留日期与业务口径。
- 系统设置隐藏本机环境与接口占位组，不再展示接口路径、数据库路径和内部状态英文；保留同步状态、数据量、安全策略和工作流阶段。
- 卡片增加边缘光带、指标/可点击卡片悬停反馈；筛选按钮、日期弹层、渠道筛选、标签页和视图切换增加统一动画，并支持 reduced-motion。

### 销售目标年份与漏斗视觉修复

- 复核钉钉 `销售目标!A2:O12`：1 月至 12 月目标日期行属于 2026 年；旧快照只保存 `01` 至 `12`，导致 2026 年 8 月至 12 月目标错误套用到图中的 2025 年同月。
- 目标模型改为 `YYYY-MM` 键；旧快照的两位月份键仅映射到快照完成日期所在年份。缺少目标的月份只绘制净销售额，不再绘制目标柱或达成率。
- 近 12 月图返工：双柱使用固定 6px 间距和实色区分，2026-01 至 2026-07 的 7 个有效达成率点恢复为 1 条连续折线；2025-08 至 2025-12 保持无目标。1920px 桌面验收确认 7 个目标柱、7 个折线节点、无重叠、页面无横向溢出，控制台无错误。
- 转化漏斗改为复用全局 `metric-card card-glow` 视觉，使用统一青色填充、末级荧光绿转化率、逐层悬停和入场动画；reduced-motion 下停用动画。

### 钉钉计划任务排查与重试修复

- `EcomAIStudio-DingTalk-Sync` 在 2026-07-15 10:00:01、12:30:01、17:30:01 均正常启动并成功，分别写入 7683、7683、7719 条聚合记录；10:00 快照的完整数据日为 2026-07-14，页面显示 07-14 符合 T-1 口径，不是计划任务漏跑。
- 2026-07-16 10:00:01 任务因钉钉 HTTP 500 失败；发现请求层和脚本层均未把 500 纳入瞬时故障重试范围，且失败健康文件错误写入最大尝试次数而非实际尝试次数。
- 请求层与脚本层已覆盖 HTTP 500；失败健康状态改为记录实际尝试次数。11:27 手动补跑已验证 3 次退避重试生效，但三次均收到钉钉 HTTP 503；12:30 恢复前系统继续沿用 2026-07-15 17:34 的最后成功快照，未用失败响应覆盖本地数据。
- 12:30:01 计划任务按时再次启动并于 12:34:24 同步成功；健康状态恢复为 healthy，钉钉快照记录数更新为 7739，说明故障来自钉钉短时 500/503，而不是 Windows 计划任务未执行。
- 本轮 `npm run build`、`npm run test:analytics-dashboard`、`npm run test:dingtalk-unattended` 与 `git diff --check` 通过；隔离浏览器验收确认 2025 年无目标柱、漏斗卡片视觉统一、控制台无错误、页面级横向溢出为 0。
- `npm run test:ux-polish` 当前仍有一个既存文案断言：测试要求商品管理页包含“商品销售、履约、退货与渠道分布”，当前页面已移除该句；该失败与本轮目标、漏斗和同步修改无关，未为迎合旧断言恢复冗余文案。

### 浏览器与回归

- 桌面端逐页检查：9 个页面均未发现用户可见的开发标记；日期筛选展开动画为 0.24 秒，近 7 日预设正确更新日期草稿，商品标签切换状态正确。
- 移动端 390 × 844 逐页检查：9 个页面 body 均无横向溢出。
- npm run build、npm run test:ux-polish、npm run test:analytics-dashboard、npm run test:smoke、PowerBI/钉钉/同步/主题/公域契约及 pipeline 9 项测试均通过。
- git diff --check：通过；仅有工作区既存的 LF/CRLF 提示，无空白错误。

## 2026-07-15

### 分层运营看板与本地数仓

- 各渠道 GMV 占比改为使用 GMV 总额作分母并按占比降序，不再使用回款额份额冒充 GMV 份额。
- 近 12 月销售达成改为连续 12 个月的净销售额、钉钉月目标和达成率双轴图；当前月使用筛选结束日的 MTD。
- L6 下方渠道经营汇总表替换为渠道规模、渠道效率与风险两张横向条形图；店铺明细表保留。
- `/api/analytics` 增加 `warehouse.dashboard`，从 PowerBI 本地快照聚合访客、成交客户、支付转化、加购、客单价、件单价和推广 ROI。
- 前端 `Math.random()` 趋势和 MOCK 指标已移除；同比/环比由服务端计算，无对比期覆盖时返回 null。

### UI 与接口复核

- API 复核：PowerBI 看板区间为 2026-07-01 至 2026-07-14，返回访客 718755、成交客户 4543、推广 ROI 5.181；月度达成返回 12 个连续月份。
- 浏览器桌面端复核：GMV 占比、12 月达成、渠道规模、渠道效率与风险图正常展示。
- 浏览器移动端 390 × 844 复核：document 无横向溢出，图表卡片宽度为 350px；12 月图仅在卡片内部横向滚动。
- 5180 生产预览已重启加载本轮服务端改动；健康检查为 true，正式 `/api/analytics` 返回 `warehouse.dashboard.available=true`、12 个月度达成点和渠道 GMV 占比合计 1。

### 验证命令

- npm run build：通过。
- npm run test:analytics-dashboard：通过。
- npm run test:smoke：通过；warehouse 2616350 行、dingtalk 7719 行、feishu 7590 行、workflow agents 12/12。
- npm run test:dingtalk-unattended、test:powerbi-images、test:powerbi-replica、test:select-theme、test:analytics-sync、test:public-surface：通过。
- python -m unittest discover -s pipeline/tests -v：9/9 通过。
- git diff --check：通过；仅有工作区既存的 LF/CRLF 提示，无空白错误。

## 2026-07-14

### 无人值守同步

- 06:03:50：Windows 任务 EcomAIStudio-DingTalk-Sync 启动。
- 06:09:32：同步成功，19 张表、7669 条记录；健康状态为 success。
- 06:10 至 06:15：dry-run 成功，未写入外部数据。
- 任务配置验证：S4U、StartWhenAvailable、网络可用、IgnoreNew、失败重试 3 次；计划时间 10:00、12:30、17:30。

### MTD 口径修复

- 发现：钉钉汇总行完成日期为 2026-07-12，日明细完成日期为 2026-07-13。
- 原因：旧逻辑只按 completedThrough 选汇总行，筛选结束日为 2026-07-13 时错误覆盖了更晚的日明细。
- 修复：server/dingtalk-api.mjs 仅在 summary.end 等于筛选结束日时使用汇总行，否则按日明细重算。
- 回归：2026-07-01 至 2026-07-13 的 MTD 为 9844916.615（展示 ¥984.5 万），与日明细合计一致；最新日回款为 63.7 万；目标为 2430 万。

### PowerBI 数据

- 迁移矩阵复核：25 个查询中 23 个进入本地 PowerBI 独有数仓，00-月表汇总和 03-1-各渠道目标金额由钉钉权威口径覆盖并排除。
- 快照复核：3854 个源文件、3854 个 Parquet 分区、2433553 条事实行。
- 图片复核：商品图片使用已验证的 img.alicdn.com 白名单地址，快照中 68 个链接符合白名单。

### UI 与浏览器复核

- 页面区间显示 2026-07-01 至 2026-07-13。
- MTD 卡片显示 ¥984.5 万，目标进度使用 ¥984.5 万 / ¥2430 万。
- 日回款折线包含 07-13；PowerBI 三个复刻页面保留商品图片、表格行高和可读性调整。

### 过程文件清理

- 已删除项目根目录旧 Vite、开发服务和预览服务日志、PowerBI 过程截图、Playwright 快照目录，以及 pipeline 测试缓存目录。
- 已删除 local-data/runtime 下旧的 server-5180 启动日志；保留 local-data/logs/server-5180.stdout.log、local-data/logs/server-5180.stderr.log，因为它们对应 5180 生产服务。
- 保留 local-data/logs/dingtalk-sync.log、local-data/runtime/dingtalk-sync-health.json、local-data/warehouse、dist、node_modules、.env 和 .git_disabled。
- 15:26:37：为加载服务端文案修正，按预期进程命令重启 5180 生产服务；15:27:11 健康检查恢复正常。

### 验证命令

- npm run build：通过。
- npm run test:smoke：通过；warehouse 2433553 行、dingtalk 7669 行、feishu 7590 行、workflow agents 12/12。
- npm run test:dingtalk-api：通过。
- npm run test:dingtalk-unattended：通过。
- npm run test:powerbi-images：通过。
- npm run test:powerbi-replica：通过。
- npm run test:dashboard-ui：通过。
- npm run test:select-theme：通过。
- npm run test:analytics-sync：通过。
- npm run test:public-surface：通过。
- python -m unittest discover -s pipeline/tests -v：9/9 通过。
- git diff --check：通过。

## 历史问题记录

### 2026-07-11：DuckDB 文件监听 EBUSY

- Vite 监听 local-data/warehouse/ecom.duckdb 时出现 EBUSY。
- 影响：旧开发进程启动失败或热更新中断。
- 处理：保留数据库文件，使用生产服务和单独日志路径；不再把数据库文件加入前端监听范围。

### 2026-07-13：WebSocket 端口占用

- 开发服务报告 24678 端口已被占用。
- 影响：旧开发服务无法建立 WebSocket。
- 处理：以实际监听端口为准，生产服务固定使用 5180；过程日志已记录后清理。

### 2026-07-14：生产 PORT 继承

- 发现父进程环境变量 PORT 可能导致服务尝试使用非预期端口。
- 处理：启动生产服务时显式设置 PORT=5180，并以 /api/health 和监听端口复核。

## 日志保留策略

- 保留 local-data/logs/dingtalk-sync.log 和 local-data/runtime/dingtalk-sync-health.json，它们是无人值守同步的审计与健康证据。
- 清理根目录旧 Vite、预览服务日志以及浏览器快照；这些文件不承载业务数据。
- 不读取、不记录 .env 中的凭证值；公域部署只使用环境变量和服务端受保护接口。
