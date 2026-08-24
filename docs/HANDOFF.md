# ecom AI Studio 交接文档

更新时间：2026-08-22（新增第 16 节 舆情页面增强 + 抓取笔记持久化；保留历史节）
项目路径：E:\Github\ecom-ai-studio

## 1. 服务与入口

- 生产预览地址：http://127.0.0.1:5180/
- 启动方式：在项目目录设置 PORT=5180 后执行 npm run start。
- 健康检查：http://127.0.0.1:5180/api/health
- 当前服务由 node server/index.mjs --production 提供；不要为清理过程文件而停止该服务。
- 前端路由覆盖经营概览、增长诊断和 PowerBI 复刻页面。

## 1.1 账号登录与权限

- 当前本地开发采用免登录模式：`AUTH_ENFORCEMENT_ENABLED` 默认是 `0`，页面和业务 API 不被登录拦截，Agent 可直接验收和修改；账号、登录页、用户与权限功能仍完整保留。
- 正式上线前必须设置 `AUTH_ENFORCEMENT_ENABLED=1`，重启服务后才会启用页面登录门禁、API 401 和逐用户权限校验。
- 强制模式下首次访问由 `/api/auth/status` 判断是否初始化；未初始化时页面引导创建首位管理员，不存在源码默认密码。
- 登录必须同时匹配邮箱、手机号和密码；密码使用 `scrypt` 加盐哈希，原文不落盘。
- 会话使用随机令牌和 HttpOnly、SameSite=Strict Cookie；服务端仅保存令牌摘要，默认 12 小时失效。
- 强制模式下，除 `/api/health`、登录和首次初始化外，业务 API 均要求登录，并按查看/操作权限再次校验；竞品图片路由同样受保护。
- 管理员在“用户与权限”页面创建、停用用户，配置页面查看和执行权限；系统禁止停用或降级最后一名启用中的管理员。
- 本地账号库：`local-data/auth/auth-store.json`，属于本机运行数据，不提交仓库。
- 关键实现：`server/auth.mjs`、`src/pages/LoginPage.tsx`、`src/pages/AccessManagementPage.tsx`；回归入口：`npm run test:auth`。

## 2. 钉钉无人值守同步

- Windows 任务：EcomAIStudio-DingTalk-Sync。
- 任务属性：Ready、S4U、Limited、StartWhenAvailable、IgnoreNew、网络可用、失败重试 3 次、重试间隔 10 分钟。
- 执行时间：10:30、13:00、17:30（Asia/Shanghai）。
- 2026-07-14 06:03:50 启动的同步在 06:09:32 成功，读取 19 张表、7669 条记录。
- 健康状态文件：local-data/runtime/dingtalk-sync-health.json。
- 运行日志：local-data/logs/dingtalk-sync.log。
- 2026-07-14 健康检查显示 dingtalk healthy、无人值守正常、最后成功时间为 2026-07-14 06:09:32。
- 2026-07-15 三个计划时间均执行成功；10:00 的完整数据日为 2026-07-14，属于正常 T-1 数据，而不是任务漏跑。
- 2026-07-16 10:00 因钉钉 HTTP 500 失败；请求层和脚本层已将 500 纳入重试，手动补跑验证了 3 次退避重试。12:30 计划任务已自动恢复并在 12:34 同步成功，当前健康状态为 healthy、快照记录数 7739。
- 生产环境不要把 .env、钉钉应用凭证或读写指南复制到公域；同步接口必须继续由服务端受保护。

## 3. 运营数据口径

- 钉钉表是运营看板的权威来源，PowerBI 本地数仓只补充钉钉表没有覆盖的字段和明细。
- MTD 计算按筛选月份及筛选结束日期执行。只有钉钉汇总行的完成日期等于筛选结束日期时才使用汇总行；否则按日明细重算。
- 2026-07-01 至 2026-07-12 的汇总行仍停留在 2026-07-12，而日明细已经覆盖到 2026-07-13；修复后筛选至 2026-07-13 的月累计回款额为 ¥984.5 万，日明细合计为 9844916.615，目标为 ¥2430 万。
- 修复文件：server/dingtalk-api.mjs；回归覆盖：scripts/test-dingtalk-api.mjs。
- 同步范围不覆盖钉钉权威的 00-月表汇总、03-1-各渠道目标金额；这两个查询在 PowerBI 迁移矩阵中标记为已排除。

## 4. PowerBI 本地数仓

- 迁移查询总数 25：23 个独有查询纳入本地数仓，2 个钉钉权威查询排除。
- 数据源规模：3854 个源文件、3854 个 Parquet 分区、2433553 条事实行。
- 快照：local-data/warehouse/analytics-snapshot.json，scope 为 powerbi_unique_only。
- 商品图片只接受已验证的 https://img.alicdn.com/ 地址；快照包含 68 个符合白名单的图片链接。
- 复刻页面包括天猫旗舰店整体数据、天猫推广费用明细、天猫商品推广费用。
- 推广费用明细和商品推广费用页面已接入商品缩略图；商品行高和字体已按可读性要求调整。
- 运营分层视图已通过 `/api/analytics -> warehouse.dashboard` 接入本地数仓：访客、成交客户、支付转化、加购、客单价、件单价和推广 ROI 均为快照聚合值。
- 数仓同比/环比按相同筛选区间平移计算；对比期超出快照覆盖范围时返回 null，前端显示 `—`，不再生成随机 MOCK。

- 2026-07-25 商品经营明细字段补齐：新增「国补后金额(万)」「销额占比」「国补后金额同比」「国补后费比」列；原「商品费比」（分母为支付金额）由「国补后费比」（`花费 / ((支付−退款)×0.85)`）替换。国补后金额、销额占比、国补后费比为前端纯派生；国补后金额同比由 `_build_powerbi_pages` 新增的 `product_daily_prior_year` 查询提供（窗口 `period_start−365 ~ period_end−365`，对齐 .pbix `DATEADD(-365, DAY)`），缺失时前端降级「数据不足」。
- catalog 内部 `07-旗舰店商品销售数据` 映射到 `model_q08_*` 视图（query 清单编号与文件名编号不一致，属正常）；warehouse.py 用 query_name 查 `warehouse_query_catalog` 取视图，对账脚本 `scripts/audit-product-subsidized-yoy.py` 同样走 catalog，不要按 `model_q07_*` 表名硬查。
- 完整方案与对账数据见 `docs/POWERBI-PRODUCT-TABLE-FIELD-GAP-PLAN.md`；本次对账确认 07 表覆盖 2024-08-17 ~ 2026-07-24，去年同期 138 商品 = 快照 productDailyPriorYear 138 商品。

## 4.1 分层视图图表

- 各渠道 GMV 占比已改为 `渠道 GMV / 全渠道 GMV`，按占比降序展示。
- 近 12 月销售达成使用钉钉实际回款、月目标和达成率，当前月按 MTD；图形为双柱 + 折线双轴图。
- 销售目标以目标表日期行解析为 `YYYY-MM`；旧快照的两位月份键只兼容映射到快照完成日期所在年份，禁止复用到其他年份。未配置目标的月份只显示净销售额。
- 有目标月份的净销售额与销售目标使用固定 6px 间距并排绘制；当前快照的 2026-01 至 2026-07 共 7 个达成率点连接为连续折线，2025-08 至 2025-12 不绘制目标和达成率。
- 流量转化漏斗复用全局指标卡视觉与动效，保持青色主色和末级荧光绿强调。
- L6 下方渠道汇总表已替换为「渠道规模对比」和「渠道效率与风险」两张横向条形图；店铺经营明细表继续保留用于钻取。
- 详细交接见 `docs/ANALYTICS-LAYERED-REFACTOR-HANDOFF.md`。

## 4.2 页面文案与交互

- 已从用户视角复核工作台首页、商品资产、文案与分镜、图片处理、运营看板、竞品情报、任务队列、商品管理和系统设置 9 个页面。
- 页面中面向开发过程的 `mock`、原型说明、API/本机路径、复刻比例和“对齐参考看板”等小字已删除或改为业务含义。
- 卡片增加聚焦光带，交互卡片和指标卡增加悬停抬升；筛选按钮、日期弹层、标签页和视图切换增加统一的展开与选中反馈。
- 动效遵循 `prefers-reduced-motion`，移动端 390 × 844 的 9 个页面均无页面级横向溢出。

## 5. Intelligence Stage B

- 已实现本地 source_raw.xlsx → 图片提取 → Vision/Mock 解析 → 结构化合并的处理链。
- 入口脚本：scripts/extract-images-from-xlsx.py、scripts/build-intelligence-dataset.mjs。
- 服务模块：server/intelligence-pipeline.mjs、server/vision-client.mjs、server/vision-prompt.mjs。
- API：GET /api/intelligence/analyze-status、POST /api/intelligence/analyze-source。
- 尚未实现：浏览器上传 xlsx 的完整接口、目录监视器和生产级异步队列；不要在交接时把这三项描述为已完成。

## 6. 关键文件

| 领域 | 文件 |
|---|---|
| 钉钉接口与口径 | server/dingtalk-api.mjs、scripts/sync-dingtalk.mjs |
| 无人值守 | scripts/register-dingtalk-schedule.ps1、server/dingtalk-lock.mjs |
| PowerBI 复刻 | src/components/PowerBiReplica.tsx、src/styles.css |
| 本地数仓 | pipeline/ecom_pipeline/warehouse.py、local-data/warehouse/analytics-snapshot.json |
| 分层运营看板 | src/components/LayeredAnalyticsView.tsx、server/warehouse.mjs |
| Intelligence | server/intelligence-pipeline.mjs、src/components/AnalysisProgress.tsx |
| 安全说明 | docs/DINGTALK-SECURITY.md、docs/DINGTALK-SHEET-API-GUIDE-SAFE.md |
| 登录与权限 | server/auth.mjs、src/pages/LoginPage.tsx、src/pages/AccessManagementPage.tsx |
| yudao 主数据代理 | server/yudao-client.mjs、server/index.mjs（/api/masterdata/*）、.env 的 YUDAO_* 配置 |
| 运行记录 | docs/OPERATIONS-LOG.md、.learnings/SESSION-LOG.md |
| Coze 工作流代理 | server/workflow-proxy.mjs、src/services/workflowApi.ts |
| 舆情分析页面 | src/pages/SentimentPage.tsx、src/types/sentiment.ts |
| Windows 自启动 | start-server.bat、Startup/ecom-ai-studio.vbs |

## 7. 已验证命令

以下命令在 2026-07-16 通过：npm run build、npm run test:auth、npm run test:analytics-dashboard、npm run test:smoke、npm run test:dingtalk-api、npm run test:dingtalk-unattended、npm run test:powerbi-images、npm run test:powerbi-replica、npm run test:dashboard-ui、npm run test:select-theme、npm run test:analytics-sync、npm run test:public-surface、python -m unittest discover -s pipeline/tests -v、git diff --check。

2026-07-25 增量验证：`npx tsc --noEmit`、`node scripts/sync-warehouse.mjs`、`python scripts/audit-product-subsidized-yoy.py`、`node scripts/test-powerbi-replica-contract.mjs` 均通过。

当前 `npm run test:ux-polish` 有一个既存的过期文案断言：它要求商品管理页出现“商品销售、履约、退货与渠道分布”，而当前页面已经移除该句。目标年份、漏斗和无人值守相关测试均通过。

## 8. 接手前检查

1. 访问 /api/health，确认 dingtalk healthy、schedule 为 10:30,13:00,17:30。
2. 确认 Windows 任务 EcomAIStudio-DingTalk-Sync 的 LastResult 为 0。
3. 保留 local-data/runtime/dingtalk-sync-health.json 和 local-data/logs/dingtalk-sync.log，勿将它们清理为“临时文件”。
4. 检查 MaterialId、ContentId、SKU 的映射是否仍与 PowerBI 快照一致。
5. Intelligence 上传、目录监视和真实 Vision 长任务仍是待实施项。
6. 本地默认免登录；上线设置 `AUTH_ENFORCEMENT_ENABLED=1` 后，首次启动若出现管理员初始化页属于预期。不要在仓库、日志或交接文档记录实际账号密码。
7. 工作区保留用户已有未提交改动；本次没有执行 reset、checkout 或提交。
8. 商品经营明细「国补后金额同比」依赖 07 表覆盖去年同期（当前 07 表覆盖 2024-08-17 ~ 2026-07-24）；可跑 `python scripts/audit-product-subsidized-yoy.py` 复核数据通道，若同比列显示「数据不足」说明该商品去年未上架或源数据未覆盖，属预期降级。

## 9. 残余风险

- HTTPS / 反向代理部署时必须设置 `AUTH_SECURE_COOKIE=1`；只有代理会覆盖客户端转发头时才设置 `AUTH_TRUST_PROXY=1`，并继续限制可信代理写入 `X-Forwarded-Proto` / `X-Forwarded-For`。
- 钉钉接口仍可能出现短时 500、503 或 fetch failed；程序已覆盖退避重试、单实例锁和健康状态观测，但连续服务端故障仍会保留上一份成功快照并标记 degraded。
- PowerBI 独有数据的源文件持续增量时，需要重新生成快照并复跑图片白名单检查。

## 10. 实施任务书：Luna Max Fast 自定义 Subagent

### 10.1 任务状态与目标

- 状态：部分完成（2026-08-08）；自定义 Agent TOML、CLI 和独立子 Agent 调用已配置/验证，轻量 Skill 尚未创建，不再通过即时委派参数覆盖模型。
- 目标：新增一个个人级自定义 Agent `luna_max_fast`，固定使用 `gpt-5.6-luna`、`max` 推理强度和 `fast` 服务档；再提供一个轻量 Skill，让用户用一句话把明确任务委派给该 Agent。
- 作用范围：只影响显式选择 `luna_max_fast` 的新子 Agent，不热切换当前根 Agent，也不改变普通子 Agent、项目配置或全局默认模型。
- 失败策略：自定义 Agent 未加载、模型不可用或任一配置未生效时立即停止并报告，禁止静默改用 Terra/Sol、降低推理强度或关闭 Fast mode。

### 10.2 官方配置依据与本机现状（2026-08-08）

- Codex 官方手册规定，个人自定义 Agent 使用 `~/.codex/agents/*.toml`，项目级自定义 Agent 使用 `.codex/agents/*.toml`。
- 每个独立 Agent 文件必须包含 `name`、`description`、`developer_instructions`；还可使用常规 `config.toml` 字段，包括 `model`、`model_reasoning_effort`、`service_tier` 和 `[features]`。
- Agent 文件中的 `model` 与 `model_reasoning_effort` 优先于委派时的临时值；未写入的沙箱、MCP、Skill 等设置从父会话继承。
- Codex Fast mode 的持久配置为 `service_tier = "fast"` 并启用 `[features].fast_mode = true`。Luna 在本机模型目录中声明支持 `max` 和 `fast`。
- 本机已创建 `C:\Users\Administrator\.codex\agents\luna-max-fast.toml`，此前不存在自定义 Agent 目录，因此没有覆盖既有 Agent。
- 本机全局 `C:\Users\Administrator\.codex\config.toml` 当前使用 `service_tier = "priority"`。不要修改这个全局值；由 `luna_max_fast` Agent 文件局部覆盖为 `fast`，确保根 Agent 和其他 Agent 行为不变。
- 全局 npm CLI 已从 `@openai/codex@0.130.0` 升级到 `@openai/codex@0.147.0`；`codex --version` 已验证为 `codex-cli 0.147.0`。OpenAI 官方 GPT-5.6 说明要求 Codex CLI 至少为 `0.144.0`。
- 官方参考：`https://learn.chatgpt.com/docs/agent-configuration/subagents`、`https://learn.chatgpt.com/docs/agent-configuration/speed`。

### 10.3 交付结构

```text
C:\Users\Administrator\.codex\agents\
└── luna-max-fast.toml

C:\Users\Administrator\.codex\skills\delegate-luna-max-fast\
├── SKILL.md
└── agents\
    └── openai.yaml
```

- 自定义 Agent TOML 是模型、推理强度和速度的唯一配置来源。
- Skill 只负责识别触发语义、要求使用 `luna_max_fast` Agent 并定义失败/回报规则，不重复维护模型参数。
- 不新增 README、安装指南、变更日志或与执行无关的辅助文件。

### 10.4 自定义 Agent 配置

已创建 `C:\Users\Administrator\.codex\agents\luna-max-fast.toml`，内容以以下契约为准：

```toml
name = "luna_max_fast"
description = "Use for clearly scoped delegated tasks that must run with GPT-5.6 Luna, max reasoning, and Fast mode."
model = "gpt-5.6-luna"
model_reasoning_effort = "max"
service_tier = "fast"
developer_instructions = """
Complete only the delegated task. Preserve the parent task's scope and permissions.
Return a concise result with verification evidence, and report blockers explicitly.
"""

[features]
fast_mode = true
```

实施约束：

- `name` 是 Codex 识别 Agent 的真实标识；文件名与名称保持对应，便于维护。
- 不在该文件中设置 `sandbox_mode`、审批策略、MCP 或额外 Skills，让它们从父会话继承。
- 不在全局 `config.toml` 中设置 `agents.default_subagent_model`，避免所有委派任务都被改成 Luna。
- 不编辑 `models_cache.json`、应用安装文件、工具 schema 或服务端配置。

### 10.5 一键调用 Skill

1. 使用 `skill-creator/scripts/init_skill.py` 初始化 `delegate-luna-max-fast`，安装到用户级 Codex Skills 目录。
2. `SKILL.md` frontmatter 只包含 `name` 和 `description`；description 覆盖“子 Agent 使用 Luna”“切换 Luna max fast”“使用 Luna 子代理”“委派给 luna_max_fast”等触发语义。
3. `agents/openai.yaml` 通过 `skill-creator` 提供的生成脚本创建，包含与 Skill 一致的 `display_name`、`short_description` 和 `default_prompt`。
4. Skill 被触发后：
   - 确认 `luna_max_fast` 出现在当前会话可用的自定义 Agent 列表中；
   - 将用户给出的完整任务原样委派给 `luna_max_fast`，补充必要的范围、输出和验证要求；
   - 不再在委派动作中单独传入 model、reasoning 或 speed，让 Agent TOML 成为单一事实来源；
   - 等待该 Agent 完成，汇总结果并保留验证证据。
5. 如果当前会话没有加载 `luna_max_fast`，停止执行并提示重启 Codex/新建会话；不得退回内置 Agent。

### 10.6 实施顺序

1. 已备份式只读检查现有 `~/.codex/agents`、目标 Skill 目录和全局 `config.toml`；目标 Agent 目录此前不存在。
2. 已创建并静态检查 `luna-max-fast.toml`；Codex Doctor 报告全局配置 loaded，未发现该配置导致的解析错误。
3. 初始化和编写 `delegate-luna-max-fast` Skill，生成 `agents/openai.yaml`。
4. Skill 尚未创建，因此尚未运行 `skill-creator/scripts/quick_validate.py`。
5. 已用新 CLI 启动隔离只读调用，实际返回 `LUNA_CLI_OK`，证明 `gpt-5.6-luna` 可由 CLI 调用。
6. 已用 Terra 根 Agent 请求创建不继承完整历史的独立 `luna_max_fast` 子线程，返回精确结果 `CUSTOM_LUNA_OK`，并报告 `Named custom agent loaded: Yes`；子 Agent 的实际 model、reasoning effort、service tier 元数据未由 JSON 事件单独暴露，仍需后续从线程面板或运行记录确认。
7. 首次冒烟曾触发 `Full-history forked agents inherit the parent agent type`；改为独立新线程后复验通过。正式调用必须使用独立子线程路径，不使用 full-history fork。

### 10.7 验收标准

- 文件验收：`luna-max-fast.toml` 与 Skill 两个必需文件存在；没有无关附属文档。
- TOML 验收：必填字段完整，`model = "gpt-5.6-luna"`、`model_reasoning_effort = "max"`、`service_tier = "fast"`、`features.fast_mode = true` 均能被解析。
- 加载验收：重启后的 Codex 能按名称识别 `luna_max_fast`，且普通内置 Agent 仍可正常使用。
- 触发验收：至少覆盖“让子 Agent 用 Luna max fast”“后续委派给 luna_max_fast”“使用 Luna 子代理完成这个任务”三种表达。
- 正向验收：用 `luna_max_fast` 执行无副作用的只读任务；从 Agent 线程或运行元数据确认 model、reasoning effort、service tier 三项实际生效。
- 已验证：`codex-cli 0.147.0` 直接调用 `gpt-5.6-luna` 返回 `LUNA_CLI_OK`；Terra 根 Agent 能识别 `luna_max_fast`。
- 已验证：独立 `luna_max_fast` 子线程返回 `CUSTOM_LUNA_OK`，并确认命名 Agent 已加载。
- 未完成：子 Agent 三项实际运行元数据尚未取得；当前只能确认配置被加载且调用链成功，不能把配置文件内容等同于运行时生效证据。
- 严格失败验收：临时使用不存在的 Agent 名称进行测试时，流程必须停止并报告未加载，不得自动改用内置 Agent。
- 隔离验收：未触发 Skill 的新子 Agent 不受该配置影响；根 Agent 和全局 `service_tier = "priority"` 保持不变。
- 重启验收：关闭并重新打开桌面应用后再次执行同一触发语句，行为一致。

### 10.8 状态回报契约

最终交接必须分别报告以下状态，不能合并为“配置成功”：

```text
自定义 Agent 文件：已创建 / 未创建
Codex 加载状态：已识别 / 未识别
请求配置：gpt-5.6-luna / max / fast
实际配置：已验证值 / 未验证
子任务状态：已完成 / 未执行 / 失败
降级行为：无
```

如果无法取得实际运行元数据，只能标记“配置已写入、运行值未验证”，不得声称 Luna Max Fast 已经生效。

### 10.9 非目标与禁止项

- 不将一次性委派参数作为模型配置入口；模型选择统一由 `luna-max-fast.toml` 管理。
- 不修改全局默认模型或全局 Fast mode，不影响根 Agent 和其他子 Agent。
- 不通过普通 API 请求模拟 Codex 子 Agent，不篡改本地模型缓存或应用内部文件。
- 不自动升级 CLI、替换桌面应用或更改账号/工作区权限；遇到版本或权限问题时单独报告。

### 10.10 完成交付物

- `C:\Users\Administrator\.codex\agents\luna-max-fast.toml`。
- 通过校验的用户级 `delegate-luna-max-fast` Skill。
- 自定义 Agent 加载与正向/负向验收记录，不包含凭证或会话令牌。
- 更新后的交接说明，明确区分文件写入、配置加载和实际运行三个阶段。

---

## 11. 顶部智能找数 v1（2026-08-05）

在顶部栏加入全局智能搜索，支持自然语言找页面/找指标/找实体/找数据，并自动导航到正确页面、应用筛选、定位高亮。

### 11.1 架构与数据边界

- 搜索是**目录 + 匹配 + 导航层**，不生成经营数字。
- 经营数值读取钉钉权威快照（`filterDingTalkSnapshot()`），商品数值读取本地数仓快照（`warehouse.productManagement`）。
- **搜索路径不启动 Python、不调用 DuckDB CLI、不调用 `/api/analytics`/`/api/products`、不接任何外部模型/向量库**。
- 商品历史日期/指定店铺/当前快照无法直接证明的组合 → `navigate_required`，带条件跳到商品页由现有筛选接口计算。
- 索引指纹 = 钉钉 `finishedAt` + 数仓快照 mtime；指纹不变复用内存索引，变化时 single-flight 重建；索引失败仍返回静态指标和页面区域。
- **不记录查询文本**到 SQLite、日志、操作日志或长期文件；响应不含原始行、文件路径、外部图片地址、用户信息或凭证状态。

### 11.2 文件清单

#### 新增（7 个）

| 文件 | 职责 |
|------|------|
| `src/types/search.ts` | SearchTarget 联合类型、SearchRequest/Response、Answer/Result 类型 |
| `src/components/GlobalSearch.tsx` | 搜索框、浮层、联想、答案、键盘交互、移动端、焦点陷阱 |
| `src/hooks/useSearchTarget.ts` | 页面加载后滚动/定位/高亮锚点，支持 onMissing Toast，轮询等待页签切换后 DOM 就绪 |
| `server/search-catalog.mjs` | 指标/页面区域/别名/定义/来源/导航落点目录（经营 10 指标、商品 11 指标、21 个锚点） |
| `server/search-service.mjs` | 纯函数 normalizeQuery/parsePeriod/matchMetrics/matchEntities/rankCatalogEntries/answerFromSnapshots + searchSite 主编排 + 权限二次过滤 |
| `scripts/test-global-search-contract.mjs` | 静态契约（接入、认证、锚点、suggest 不调 Python、长度/数量上限、navigate_required、requestId 注入） |
| `scripts/test-global-search-api.mjs` | 真实快照数据对账（6 固定查询、权限隔离、0 分母/null/缺失/超范围） |

#### 修改（13 个）

`src/App.tsx`（SearchTarget state + 在导航入口集中注入新 requestId）、`src/components/Topbar.tsx`（左侧接入搜索，保留右侧功能）、`src/services/localApi.ts`（searchSite + AbortSignal）、`src/pages/AnalyticsPage.tsx`、`src/pages/ProductManagementPage.tsx`、`src/components/PowerBiReplica.tsx`、`src/components/ExecutiveCommerceOverview.tsx`、`src/components/product-management/ProductCommandOverview.tsx`、`src/components/product-management/PriorityProductsTable.tsx`（自动切页+行高亮）、`server/index.mjs`（`POST /api/search`，入口权限 `analytics.view OR products.view`）、`src/styles.css`（搜索框/浮层/结果/加载/高亮/响应式/答案元数据）、`package.json`（`test:global-search`）、`server/search-catalog.mjs`（商品页签补 section）。

### 11.3 六个固定验收查询

| 查询 | 预期 |
|------|------|
| `8月天猫退款率` | 经营答案卡，退款率（refund/gmv），天猫渠道，8 月周期，含周期/范围/数据源/更新时间/状态；点击跳经营页应用日期+天猫、高亮 |
| `豆7销量和退货率` | 两张商品答案卡（销量、退货率），数值来自 productNameOverview；点击进商品管理**总览**页签重点商品表，自动定位高亮「豆7」行 |
| `M5209` | `ambiguous`，豆芽 2.0 / 豆芽 3.0 分开供选择（SPU 多商品不聚合） |
| `7月豆7退货率` | `navigate_required`，带 7 月日期 + 豆7焦点进商品页由页面聚合 |
| `仓配履约在哪里` | 导航到商品管理 fulfillment 页签并高亮 `products-fulfillment` |
| `费比怎么算` | 返回定义/公式（spend / netRevenue），**不返回计算数值** |

### 11.4 已通过验证

- `npm run typecheck` — 通过
- `npm run build` — 通过
- `npm run test:global-search` — contract + api 均通过
- `npm run test:products`、`test:ux-polish`、`test:select-theme`、`test:auth`、`test:public-surface` — 均通过
- `git diff --check` — 无空白错误
- 代码隔离验收（glm-5.2）：数据隔离/权限/口径/不做项全部通过；其报告的 requestId 缺失 HIGH bug 已修复
- 视觉验收（kimi-k2.7-code）：控制台零错误、深色风格一致、快捷键、ambiguous、navigate_required、响应式无横向滚动等通过；报告的 6 项问题已修复

### 11.5 本会话修复的问题

1. **requestId 缺失（HIGH）**：后端 target 不含 requestId，导致同页面导航时依赖 `[requestId]` 的 useEffect 不重跑。在 `App.tsx handleSearchNavigate` 集中为每个 target 注入新 requestId（`search-${Date.now()}-${seq}`），并加契约测试防回归。
2. **空状态违规列本地页面**：空状态改为仅三条固定示例。
3. **Tab 焦点陷阱**：原 Tab 处理器只绑在 `<input>`，焦点到结果按钮后失控。重构为 panel 层级 `onKeyDown` 捕获，方向键也一并提到 panel 层。
4. **商品答案未高亮商品行**：商品指标 catalog 原 tab=returns/fulfillment 时 focus 传不到 PriorityProductsTable（该表只在 overview 渲染）。带 focus 的商品答案统一落 overview/priority。
5. **锚点缺失无 Toast**：useSearchTarget 加 onMissing 回调，两页面接 `onAction("已进入对应数据页","目标区域暂未加载")`；并加 requestAnimationFrame 轮询（最多 30 帧）等页签切换后 DOM 就绪。
6. **答案卡元数据缺失**：新增 AnswerMeta，展示统计周期、筛选范围、数据源（钉钉经营快照/本地数仓）、更新时间、数据状态（最新/部分覆盖/过期/缺失）。
7. **费比定义返回数值**：定义意图分支改为只返回公式/定义，rawValue=null。
8. **商品页签缺 section**：catalog 中 9 个商品页签补 section 字段，导航 target 才能滚动高亮。
9. **移动端浮层**：≤767px 改为 100vw/100vh 全屏覆盖，结果区内部滚动。

### 11.6 ✅ 已完成：重启 Node 服务器（2026-08-05）

dev server（5173）已于 2026-08-05 重启并加载新后端代码。注意：**Node 服务器不会热重载 .mjs**，Vite HMR 只更新前端；凡改动 `server/*.mjs`，必须重启 Node 进程后浏览器才能看到新后端行为。验证后端是否为新代码：

```bash
curl -s -X POST http://127.0.0.1:5173/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"费比怎么算","mode":"answer"}'
# 预期 answers[0].rawValue === null（旧代码会返回 23.94）
# 注意：Windows 版 curl 会把命令行中文参数转成 GBK 字节导致服务端乱码，
# 中文查询请改用 node fetch 或 --data-binary @file（UTF-8 文件）验证。
```

### 11.7 ✅ 复验结果（2026-08-05）

- 六个固定查询浏览器复验通过：豆7销量/退货率两张答案卡进商品**总览**页签；费比定义卡无计算数值；仓配履约区域高亮生效；点击答案卡可导航并高亮目标区域（`search-target-highlight` 命中）。
- M5209 多义选择、Tab/Shift+Tab 焦点循环、移动端 390×844 全屏浮层无横向溢出，均通过（Playwright + 系统 Chrome，控制台零错误）。
- v1 验收未发现的浮层层叠 bug 在 v1.1 复验中暴露并修复，见 §11.10。

### 11.8 已知遗留（非阻塞）

- `test:dashboard-ui` / `test:analytics-dashboard` 失败：期望 `const sharedMax = Math.max(` 模式。经 `git stash` 验证为**预存在失败**，与搜索改动无关（涉及图表 sharedMax 代码）。
- ~~ranking 意图类型已定义但未实现排名查询逻辑~~ → v1.1 已实现渠道维度 Top3（见 §11.10）；店铺/商品维度仍为明示导航降级。
- dataState 只产出 `fresh`/`missing`，未产出 `partial`/`stale`（超范围日期目前不标 partial）。
- 相关结果上限 3，未用满任务书提到的 8（在 8 以内，不违规）。
- AnalyticsPage 未消费 `searchTarget.analyticsView`（后端恒返回 "layered"，默认也是 layered，实际无影响）。
- 时间词仍未覆盖：季度/Q1-Q4/去年/星期X 等；这类查询会落到最新完整数据日并在周期标签明示，不再静默全周期。
- 实体归一化不含「十」开头的中文数字（如"豆十"≠"豆10"）。

### 11.9 不做项（已遵守）

不接 OpenAI/Gemini/Ollama，不建向量库/embedding，不让 LLM/RAG/任意 SQL 生成经营数字，不做多轮对话/预测/归因，不保存个人搜索历史，不调整既有指标口径/业务接口/路由/数据同步流程。

---

## 11.10 智能找数 v1.1：普通用户视角体验优化（2026-08-05）

以普通用户口径实测 v1 后实施的优化，全部沿用 §11.1 的架构边界（目录+匹配+导航层，不生成经营数字，不接 LLM，不记查询历史）。完整事件记录见 `docs/OPERATIONS-LOG.md` 2026-08-05 条目。

### 行为变化（用户可感知）

- **口语时间词**：新增昨天/前天/本周/上周/这个月/上个月、单日 `8月1日`（v1 会静默扩成整月）、中文完整日期 `2026年8月1日`、中文月份 `八月`。
- **禁止静默错答**：含未识别时间词（去年/季度等）时落到最新完整数据日并在周期标签明示；裸指标无时间词时默认本月 MTD；答案卡始终回填实际统计周期（v1 周期为 null 时前端不显示周期，用户无法判断数字口径）。
- **排名意图**：`退款率最高的渠道` 返回渠道 Top3 答案卡（纯函数读快照平台行，口径与看板一致）；店铺/商品维度降级为明示导航（"请到重点商品表查看"），不再静默改答全渠道总值。
- **裸实体兜底**：`豆7` → 销量/退货率/净销售额三张卡；`天猫` → 该渠道 GMV/净回款/退款率三张卡；店铺 → 明示导航。v1 对裸实体直接 unsupported。
- **变体归一**：豆七↔豆7、M52O9↔M5209（`normalizeTerm` 两侧同规则，精确匹配不受影响；不含"十"开头中文数字）。
- **全局商品 KPI**：无实体时待发货件数/定制率直接回答全局值（v1 只给导航）。
- **可读性**：答案卡数值改为右侧大字号主视觉；定义卡中文化（"站内推广费 ÷ 净回款"）；unsupported 显示"没看懂这个问题，换个说法试试"；kbd 按平台显示（Windows→Ctrl K）；面板底部加键盘操作提示。

### 修复的 bug

- **浮层层叠（v1 预存，HIGH）**：浮层原渲染在带 `backdrop-blur` 的 `.topbar` 内，`backdrop-filter` 使 fixed 后代被困进 topbar 的层叠上下文与包含块，主内容区压在浮层之上——鼠标点击结果被页头拦截、页面内容透进浮层（v1 验收截图 02-search-modal-open.png 中已可见，当时未发现）。已改 `createPortal` 挂到 `document.body`，点击导航与视觉遮挡均修复。
- **后端页面导航权限过滤（v1 预存）**：`OTHER_PAGES` 用裸页面 id 对比 `${page}.view` 权限串，恒为空，后端页面导航结果从不产出（v1 靠前端本地页面兜底掩盖）。已修为权限映射（权限管理页对应 `admin.users`）。
- **实体索引越权缓存（v1 预存）**：索引指纹只含数据版本，无商品权限的调用会复用含商品实体的缓存索引。指纹已加权限 salt。

### 验证

- `npm run test:global-search`（api 新增第 9/10/11 节：口语时间词与默认周期、排名意图与快照对账、裸实体/变体/KPI/页面导航权限）、`npm run typecheck`、`npm run build`、`test:ux-polish`、`test:select-theme`、`test:products`、`test:auth`、`test:public-surface`、`test:dingtalk-api`、`test:analytics-sync`、`git diff --check` 均通过。
- 浏览器实测（Playwright + 系统 Chrome，截图在 output/playwright/）：六个固定验收查询 + 昨天退款率/上个月GMV/这个月回款/8月1日天猫退款率/退款率最高的渠道/豆7/天猫/豆七销量/待发货件数/竞品/销量最高的商品 均符合预期；点击答案卡导航+高亮生效；移动端无横向溢出；控制台零错误。
- 注意：Windows 版 curl 会把命令行中文参数转成 GBK 字节，验证中文查询请用 node fetch（见 §11.6）。
- 预存在失败保持记录：`test:smoke`（钉钉 2026-08-04 09:30 同步失败 degraded）、`test:analytics-dashboard`（sharedMax，见 §11.8）。

---

## 12. yudao 业务管理后台集成（2026-08-07）

用 yudao-boot-mini 的人工录入后台承载看板缺失的档案类数据；看板保持主入口地位，yudao 只做后台支撑。

### 12.1 架构边界

- 集成方式为方案 A：看板 Node 服务端以只读服务账号调 yudao REST API（`/admin-api/ecom/*/page`），前端不直连 yudao；yudao 不可达时接口降级返回 `{items:[],total:0,degraded:true}`，页面显示降级提示而不是报错。
- 不做 SSO、不把看板权限托管给 yudao、不做 Java 迁移；钉钉权威口径与 PowerBI 数仓链路完全不动。
- yudao 侧只读：服务账号角色只含 4 个 `ecom:*:query` 权限；数据录入由业务方在 yudao 管理 UI（48081）手工完成。

### 12.2 组件与位置

| 组件 | 端口 | 位置 | 说明 |
|------|------|------|------|
| MySQL 8.0.42 | 3306 | `E:/Github/yudao-env/mysql` | 库 `ruoyi-vue-pro`，root/123456，仅绑 127.0.0.1 |
| Redis 5.0.14 | 6379 | `E:/Github/yudao-env/redis` | 仅绑 127.0.0.1 |
| yudao-server | 48080 | `E:/Github/yudao-boot-mini` | `java -jar yudao-server/target/yudao-server.jar`，需 JAVA_HOME 指向 `E:/Github/yudao-env/jdk` |
| yudao 管理 UI | 48081 | `E:/Github/yudao-ui-admin-vue3` | `pnpm run dev`，admin/admin123，租户 1 |

- JDK17、Maven 与上述组件全部绿色安装在 `E:/Github/yudao-env/`，未写入系统环境变量；构建命令：`mvn -s E:/Github/yudao-env/maven/settings.xml -DskipTests clean install`。
- 四个组件当前为手工启动的会话进程，重启机器后需按上表顺序（MySQL → Redis → server → UI）手动拉起；未注册 Windows 计划任务。
- yudao 两个目录是独立 git 仓库/克隆，不进本仓库；本仓库只保留 `.env` 配置与代理代码。

### 12.3 ecom 模块与数据

- 新增 `yudao-module-ecom`（代码生成器产出）：`ecom_channel` 7 渠道、`ecom_store` 24 店铺、`ecom_product` 335 商品（种子自 PowerBI 快照）、`ecom_competitor_price` 留空待业务录入。
- 后台菜单位于「电商数据」（id 6735）下；4 个 CRUD 只读接口已验证。菜单 id 6760「运营看板入口」为外链菜单（`path=http://127.0.0.1:5173/`，新标签页打开看板），与看板「系统设置 → 业务管理后台」外链双向互通。
- 已知坑：`low_30d` 这类「下划线+数字」列名会被 MyBatis Plus 反推为 `low30d` 导致写入 500，`CompetitorPriceDO.java` 已加 `@TableField("low_30d")`；以后新增同类列必须显式注解。
- 已知坑：菜单 SQL 有两个 vue-router 约束——顶级目录菜单 `path` 必须以 `/` 开头（id 6735 已为 `/ecom`）；`component_name` 必须与全局路由名唯一（渠道/商品已改为 `EcomChannel`/`EcomProduct`，原名 `Channel`/`Product` 与内置路由重名会被顶掉导致 404）。新增菜单后必须真实登录并逐页打开验证。
- 4 个店铺（「神机榜」×2、兰知春序、崔氏家具）的渠道映射未填，待业务方在后台补录。

### 12.4 看板侧改动

- `server/yudao-client.mjs`（新增）：yudao 登录（token 缓存复用）+ 分页拉取。
- `server/index.mjs`：`GET /api/masterdata/competitor-prices`（权限 intelligence.view）、`GET /api/masterdata/products`（权限 products.view）。
- `.env` / `.env.example`：`YUDAO_BASE_URL`（默认 http://127.0.0.1:48080）、`YUDAO_USERNAME`、`YUDAO_PASSWORD`、`YUDAO_TENANT_ID`（默认 1）；**密码含 `#` 必须用双引号包裹**，否则 dotenv 把它当注释截断。
- 前端：`IntelligencePage` 竞品价格页签脱离 mock 改接 API（loading/降级/空态三态）；`SettingsPage` 增后台入口外链卡片。
- 服务账号 `ecomdashboard` 只读；不要在仓库、日志或交接文档记录其密码（仅 `.env` 本机持有）。
- `server/*.mjs` 不热重载：改动代理代码后必须重启看板 Node 进程。

### 12.5 验证

- 端到端：yudao 建竞品价格测试行 → 看板测试实例（5199）读到且 `low30d` 字段映射正确 → 删除 → 看板回空态，全链路通过（2026-08-07）。
- 只读账号越权写返回 403；yudao 停服时看板接口降级 200 不报错。
- `npm run build`、`git diff --check` 通过；详细事件见 `docs/OPERATIONS-LOG.md` 2026-08-07 条目。

## 13. 多机协作基线 + GitHub 安全加严（2026-08-17）

> 本节是真值状态；详细命令、决策过程、历史归档见 [`docs/handoff/2026-08-17-multi-machine-collab.md`](handoff/2026-08-17-multi-machine-collab.md)。

### 13.1 协作拓扑

两台 Win 工作机通过 Tailscale 私网协作。**代码走 GitHub 私有仓库，真实业务数据走 Tailscale SSH 点对点**——两者物理隔离。

| 节点 | Tailscale IP | 角色 | 服务 |
| --- | --- | --- | --- |
| l-user（本机） | 100.113.194.123 | 编辑 + push 接收方 + 5174 生产服务 | 5174 私域站（`--production` 跑 dist） |
| l-user-1（另一台） | 100.122.239.33 | 主要编辑 + push 发送方 | 仅编辑器 |
| l-user-2 | 100.115.250.53 | 备用 / 暂未使用 | — |

### 13.2 协作流程（已选 B1：纯 Git）

```text
另一台电脑：编辑 → git add . → git commit → git push origin agent/publish-ecom-ai-studio
本机：      git pull → npm run build → 杀 node 进程（看门狗 5s 自重启 5174）
```

**Tailscale SSH 暂未开**。如需 B3 混合（另一台用 VSCode Remote SSH 直连本机编辑）——本机执行 `tailscale up --ssh` 即可开启，开启后两台都能用脚本同步真实数据。

### 13.3 真实数据不存 Git（已加严）

客户/客服对话、爬虫结果、模型分析产物**永远不通过 Git 传输**：

- 共享脚本：[`scripts/sync-local-data.ps1`](../scripts/sync-local-data.ps1)（Tailscale SSH + tar 流式管道，支持 `-WhatIf` 干跑）
- 使用文档：[`docs/tailscale-data-sync.md`](tailscale-data-sync.md)
- `.gitignore` 已加严（commit `b5b8857`）：167 个客户数据/测试产物/本地配置/根目录散落工件被忽略，**untracked 从 227 降到 60**

### 13.4 关键文件

| 文件 | 用途 |
| --- | --- |
| `scripts/sync-local-data.ps1` | push/pull `local-data/`，前置 Tailscale SSH 检查 |
| `docs/tailscale-data-sync.md` | Tailscale SSH 启用、同步脚本用法、故障排查 |
| `.gitignore` | 客户数据 / 本地 Claude / 测试产物 / 散落工件忽略规则 |
| `local-data/` | 真实业务数据目录（gitignored） |

### 13.5 GitHub 安全状态

- 仓库：**PRIVATE**（个人账号 `a897003365-max`）
- Token：OAuth `gho_*`（keyring 存储，scopes: `gist` / `read:org` / `repo` / `workflow`）
- **2FA：用户已走到 GitHub 启用第 1 步（QR 码扫描 + 验证码）；recovery codes 待保存**——接手时第一件事是确认 2FA 实际生效
- 历史已推 57 commits 全部为源码/文档/截图，**无 .env / token / 客户数据**（已验证）

### 13.6 接手前检查

- [ ] GitHub 账号 2FA 已开启：`https://github.com/settings/security` 看 "Two-factor authentication" 状态
- [ ] 10 个 recovery codes 已保存到至少 2 个独立位置（纸 + 密码管理器），**不能只存在本机**
- [ ] Tailscale SSH 状态（按需）：`tailscale status` 的 `SSHStatus` 字段 = `running` 时已开
- [ ] 60 个 untracked（源码/文档/脚本/设计稿）按子目录分批 commit + push——见 `git ls-files --others --exclude-standard`

### 13.7 验证

- `git check-ignore -v agent_data.json chat_sessions.json` → 两个文件都被忽略
- `git ls-files --others --exclude-standard | wc -l` → 60
- 脚本：`pwsh -File scripts/sync-local-data.ps1 -Direction push -WhatIf` → 干跑不传数据
- `npm run build` + `git diff --check` 通过
- 详细决策树、命令清单、故障排查：见 [`docs/handoff/2026-08-17-multi-machine-collab.md`](handoff/2026-08-17-multi-machine-collab.md)
- 真实数据流（push / pull）需在两台电脑 + Tailscale SSH 开启后实测

## 14. 小红书负面舆情分析 + 方舟 LLM 网关修复（2026-08-21）

> 本节为新功能「小红书舆情分析」与方舟 LLM 调通的可执行状态。业务方需求：针对「麻大师床垫避雷」关键词的负面舆情，抓取小红书笔记正文并产出问题点分析与改善建议；视觉验收由 frontend-kimi 完成，全部 PASS。

### 14.1 功能与访问地址

- **私域访问地址（看门狗托管，绑定 tailscale）：http://100.113.194.123:5174/**，侧边栏「数据与监控」→「小红书舆情分析」。
- 注意：该服务只绑定 tailscale IP（`100.113.194.123`），**127.0.0.1:5174 不通属正常**；本地如需访问用 tailscale 地址即可。
- 页面：5 张 KPI 卡（笔记数 20 / 总互动 2921 / 风险等级 / 问题点 / 建议）→ 舆情摘要 → 问题点分析 → 改善建议 → 笔记明细表；运行中 4s 轮询进度。

### 14.2 数据链路

```
参考文件/麻大师床垫避雷.txt（关键词笔记元数据，20 条）
  → COZE_NOTE_DETAIL_WORKFLOW_ID=7631819451410907182  workflow（stream_run，input=笔记url）
  → server/sentiment.mjs  抓取正文（并发 2 / 批次间隔 60s / 失败重试 1 次）
  → 正文缓存 local-data/sentiment/notes-cache.json（重跑跳过 Coze，秒级）
  → LLM 综合（DashScope 优先 / Ark 兜底）→ 结果落盘 local-data/sentiment/result.json
  → GET /api/sentiment/status（status 含 notes + result）
```

- 前端页面：`src/pages/SentimentPage.tsx`；服务：`src/services/sentimentApi.ts`；类型：`src/types/sentiment.ts`
- 后端：`server/sentiment.mjs`；路由：`GET /api/sentiment/notes`、`GET /api/sentiment/status`、`POST /api/sentiment/analyze`（server/index.mjs 已注册，权限挂 intelligence.view/manage）
- 导航接入：`src/data/mock.ts`(navItems)、`src/components/NavIcon.tsx`(Megaphone)、`src/App.tsx`(pagePermissions + lazy)、`src/components/GlobalSearch.tsx`

### 14.3 方舟 LLM 调通要点（踩坑，勿回退）

- **端点**：`deepseek-v4-flash-ga-260731`（以及其它方舟模型）**只能走 coding 端点** `https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions`；标准 `/api/v3/chat/completions` 报 `ModelNotOpen`，Anthropic `/api/v3/messages` 报 401。
- **鉴权**：本仓库 `ARK_API_KEY` 是方舟账号 key（`ark-*`），用 `Authorization: Bearer`；`x-api-key` + Anthropic 头是旧写法，无效。
- **格式**：chat/completions 需要 `messages` 数组，system 提示词并入首条 `{role:'system'}`；响应取 `choices[0].message.content`。
- **模型**：默认 `deepseek-v4-flash-ga-260731`（sentiment 可被 `ARK_SENTIMENT_MODEL`、`SENTIMENT_MODEL` 覆盖）。方舟账号 2121568962 已开通该模型。
- **arkProxy 曾有的死代码 bug**：上游响应对象只有 `{status, body}`，原 `if (!upstream.ok)` 恒真导致成功分支永不执行、`/api/ark/call` 从未真正成功过；已修为 `status !== 200`，现在实测返回正常。
- 前端模型硬编码已同步：`src/services/volcengineClient.ts` `ARK_MODEL = deepseek-v4-flash-ga-260731`。

### 14.4 密钥位置（均为 gitignored，勿提交）

- Coze token：`local-data/source-config.json` 的 `coze.token`（`sat_*`）+ `coze.noteDetailWorkflowId`
- 方舟 key：`.env` 的 `ARK_API_KEY`（`ark-*`）
- DashScope key（可选，未配置）：`.env` 的 `DASHSCOPE_API_KEY`，配置后 DashScope 优先于 Ark

### 14.5 运行/重跑

- 页面点「开始舆情分析」或 `POST /api/sentiment/analyze`。正文已缓存（`notes-cache.json` 20 条），重跑不调 Coze、几秒内只调 LLM 出报告。
- 修改 `server/*.mjs` 后**必须杀 node 重启**（看门狗 5s 内自拉起，绑回 tailscale）。端口只认 `PORT` 环境变量，不认 `--port` 参数。

### 14.6 验证

- `curl http://100.113.194.123:5174/api/sentiment/status` → status done、riskLevel high、problemPoints 4
- `curl -X POST http://100.113.194.123:5174/api/ark/call`（body 含 system/messages）→ 返回 text「连通」
- 双主题/响应式视觉验收：frontend-kimi 截图 `.playwright-mcp/`，9/10 PASS（另 1 项为开发态 Vite HMR 残留，生产无）
- `npx tsc --noEmit`、`npm run build` 通过；当前 HEAD `d2a885b`（分支 agent/publish-ecom-ai-studio，工作区含大量未提交 WIP，提交范围待人类定）

## 15. Coze 工作流集成 + 舆情分析页面增强 + Windows 自启动（2026-08-22）

> 本节记录将 Coze workflow stream_run API 嵌入小红书舆情分析页面、多轮前后端增强以及 Windows 开机自启动的全过程。共 6 轮改动，`npx tsc --noEmit` + `npm run build` 全量通过。

### 15.1 功能概述

在 SentimentPage 顶部新增工作流搜索栏，用户输入关键词后通过 Coze workflow API 搜索小红书笔记，结果自动写入笔记明细表；后端自动逐条抓取笔记正文并显示预览；点「开始舆情分析」弹出筛选弹窗（关键词单选下拉 + 日期范围），确认后触发后端舆情分析。

### 15.2 Coze Workflow API

| 项目 | 值 |
|------|------|
| 端点 | `https://api.coze.cn/v1/workflow/stream_run` |
| Token | `local-data/source-config.json` 的 `coze.token`（`sat_*`） |
| 搜索 Workflow ID | `7675983801533644836`（硬编码在 `workflow-proxy.mjs`） |
| 笔记详情 Workflow ID | `source-config.json` 的 `coze.noteDetailWorkflowId`（`7631819451410907182`） |
| 请求体 | `{ "workflow_id": "...", "parameters": { "input": "用户输入文本" } }` |
| 响应格式 | SSE（`data:` 行），`content` 字段为双重编码 JSON 字符串 |

**笔记字段映射**（Coze → 前端类型）：
`note_id→noteId`、`note_display_title→title`、`author_nick_name→author`、`note_liked_count→liked`、`comment_count→comment`、`collected_count→collected`、`shared_count→shared`、`note_url→url`

### 15.3 新增 API 端点

| 端点 | 方法 | 入参 | 出参 | 位置 |
|------|------|------|------|------|
| `/api/workflow/run` | POST | `{ input: string }` | `{ output: string }` 或 `{ error: string }` | `server/index.mjs` line ~903 |
| `/api/note/detail` | POST | `{ url: string }` | `{ body: string, raw: string }` 或 `{ error: string }` | `server/index.mjs` line ~913 |

两个路由均在 `handleApi` 函数内，404 fallback `return sendJson(response, 404, { error: "API 路径不存在" })` 在 `handleApi` 末尾。

### 15.4 文件清单

#### 新增（3 个）

| 文件 | 职责 |
|------|------|
| `server/workflow-proxy.mjs` | Coze workflow API 代理：`httpsPostStream` + `extractStreamText` + `runWorkflow` + `cozeNoteDetailConfig` + `formatNoteBody` + `fetchNoteDetail`；从 `source-config.json` 读取 token 和 workflow ID |
| `src/services/workflowApi.ts` | 前端工作流 API 封装：`runWorkflow(input)` 调 `/api/workflow/run`，`fetchNoteDetail(url)` 调 `/api/note/detail`；含 `NoteDetailResult` 接口 |
| `start-server.bat` | Windows 启动脚本：`cd /d E:\Github\ecom-ai-studio` + 完整 node 路径执行 `server/index.mjs --production`，输出重定向到 `server-startup.log` |

#### 修改（8 个）

| 文件 | 改动 |
|------|------|
| `server/index.mjs`（1114 行） | import 含 `fetchNoteDetail`；新增 `POST /api/workflow/run` 和 `POST /api/note/detail` 路由 |
| `src/pages/SentimentPage.tsx`（~485 行） | 全文重写：工作流搜索栏 + 笔记明细表（含正文预览/关键词/抓取时间/抓取状态列）+ 非阻塞自动抓取正文（并发 2/批次 3s）+ 弹窗（select 下拉+日期范围+确认/取消）+ `keywordOptions` 和 `tableNotes` 多分支 keyword fallback |
| `src/types/sentiment.ts`（74 行） | `SentimentNoteMeta` 新增 `keyword?` 和 `crawledAt?`；`SentimentNotesPayload` 有 `keyword: string` 顶层字段；`SentimentStatus` 有 `keyword: string` 顶层字段 |
| `src/App.tsx` | 移除 `WorkflowPage` 路由和 lazy import |
| `src/types/index.ts` | 移除 `"workflow"` PageId |
| `src/data/mock.ts` | 移除 workflow navItem |
| `src/components/NavIcon.tsx` | 移除 `Zap` import 和 workflow 映射 |
| `src/components/PageHeader.tsx` | `subtitle` 改为可选（`subtitle?: string`），条件渲染 |
| `src/styles.css`（~5300 行） | 新增 `.workflow-*`、`.workflow-search-bar`、`.workflow-search-input`、`.analyze-filter-*`、`.analyze-modal-*` CSS 类 |

#### 已弃用但未删除

- `src/pages/WorkflowPage.tsx`：第一轮创建的独立工作流页面，第二轮合并到 SentimentPage 后不再引用，文件仍存在。

### 15.5 六轮改动详情

| 轮次 | 内容 | 验证 |
|------|------|------|
| R1 | 创建 workflow-proxy.mjs + workflowApi.ts + WorkflowPage.tsx，修改 App.tsx/mock.ts/types/index.ts/NavIcon.tsx/server/index.mjs/styles.css；修复 abortRef 错误 | tsc + build 通过；subagent 6 项隔离验收全部 PASS |
| R2 | 合并工作流到舆情分析页面，移除独立 WorkflowPage 路由/导航/类型/图标 | tsc + build 通过 |
| R3 | 全文重写 SentimentPage.tsx（工作流结果写入表格 + 关键词/抓取时间列 + 分析筛选栏）；云端 curl 测试 Coze API 成功 | tsc + build 通过；后端服务启动在 5173 |
| R4 | workflow-proxy.mjs 新增 fetchNoteDetail + formatNoteBody；server/index.mjs 新增 POST /api/note/detail；workflowApi.ts 新增 fetchNoteDetail；SentimentPage 实现非阻塞自动抓取正文 + 正文预览列 | tsc + build 通过 |
| R5 | 弹窗化「开始舆情分析」筛选 — 移除内联筛选 Card、新增弹窗（select 下拉+日期范围+确认/取消按钮）、新增 .analyze-modal-* CSS | tsc + build 通过 |
| R6 | 修复关键词列显示「—」— keywordOptions 补充 `notesPayload.keyword` + `status.keyword` + `jobNotes` 关键词提取；tableNotes 的 `jobNotes` 分支和 `notesPayload.notes` 分支均加 keyword fallback | tsc + build 通过 |

### 15.6 keyword fallback 策略

后端返回的笔记数据有多个来源分支，每条笔记本身**不携带** `keyword` 字段，需要从顶层兜底：

| 数据源 | 顶层 keyword 来源 | fallback 代码 |
|--------|------------------|---------------|
| `notesPayload.notes`（工作流搜索结果） | `notesPayload.keyword` | `n.keyword ?? notesPayload?.keyword` |
| `jobNotes`（后端分析结果） | `status.keyword` | `n.keyword ?? status?.keyword` |
| `wfNotes`（前端工作流搜索直出） | 搜索输入 `wfInput.trim()` | `keyword: wfInput.trim()` |

`keywordOptions`（弹窗下拉选项）同样从以上三个来源去重提取。

### 15.7 弹窗交互流程

1. 用户点「开始舆情分析」→ `showAnalyzeModal = true`，弹窗出现
2. 弹窗内含：关键词单选下拉（`keywordOptions` 去重列表）+ 日期范围（dateFrom / dateTo）
3. 表格无笔记时下拉为空，但按钮可点击
4. 用户选中关键词后点「开始分析」→ 关闭弹窗 + 触发 `startSentimentAnalyze()` 后端调用
5. 点「取消」→ 仅关闭弹窗

### 15.8 非阻塞正文抓取

工作流搜索返回笔记列表后：
1. 笔记立即写入表格，`detailState: "pending"`，解除 `wfLoading`
2. 后台 IIFE 异步逐条调用 `fetchNoteDetail(note.url)`
3. 并发 2、批次间隔 3s
4. 每条完成后 `setWfNotes` 更新 `detailState`（"done"）、`bodyLength`、`noteBody`
5. 表格「正文预览」列显示前 80 字 + 省略号，「抓取状态」列显示「成功 N字」/「待抓取」/「失败」

### 15.9 Windows 开机自启动

| 文件 | 路径 | 作用 |
|------|------|------|
| `ecom-ai-studio.vbs` | `C:\Users\Administrator\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\` | 开机登录后自动执行，隐藏窗口启动 Node 服务 |
| `start-server.bat` | `E:\Github\ecom-ai-studio\start-server.bat` | 被早期 VBS 版本调用，含完整 node 路径 + 日志重定向 |

**当前 VBS 内容**（最终版）：
```vbs
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c cd /d E:\Github\ecom-ai-studio && ""C:\Program Files\nodejs\node.exe"" server/index.mjs --production > server-startup.log 2>&1", 0, False
Set WshShell = Nothing
```

- `0` = 隐藏窗口（无终端弹出），`False` = 不等待完成
- Node 完整路径：`C:\Program Files\nodejs\node.exe`（`where node` 确认）
- 日志输出：`E:\Github\ecom-ai-studio\server-startup.log`
- 服务端口：**5173**（`--production` 模式，API 和 UI 共享端口）
- 手动启动命令（CMD）：`cd /d E:\Github\ecom-ai-studio && node server/index.mjs --production`

### 15.10 注意事项

- **`server/*.mjs` 不热重载**：修改后端代码后必须重启 Node 进程（杀旧进程 + 重跑启动命令），否则前端请求会命中 404 `API 路径不存在`。
- **生产服务端口为 5173**，与 §1 的 5180 和 §14.1 的 5174（看门狗 tailscale 绑定）不同；自启动 VBS 走 5173 直连模式。
- **`edit_file` 在 Windows CRLF 文件上多行替换可能失败**：单行替换可行，复杂修改优先用 `write_file` 全文重写。
- **bash/PowerShell 命令被沙箱高危拦截**：`npx tsc`、`npm run build`、`curl`、`wscript` 等均需用户确认卡片。
- **Coze workflow SSE 响应解析**：`content` 字段为双重编码 JSON 字符串，需 `JSON.parse(JSON.parse(content))` 解析笔记列表。

## 16. 舆情分析工作流重构：统一引擎 + 报告留档（2026-08-22）

> 按方案落地：消除双抓取引擎/双缓存/假筛选，分析结果入档可翻查。核心文件 `server/sentiment.mjs`（全量重写）、`src/pages/SentimentPage.tsx`（全量重写）。

### 16.1 架构（一个笔记库、一个抓取引擎、分析入档）

```
抓取笔记（页面搜索栏）→ POST /api/sentiment/crawl {keyword}
  → 服务端调 Coze 搜索 workflow → 笔记 upsert 入库（待抓取）
  → 服务端后台补抓正文（并发 2 / 批次间隔 3s / 每批落盘）
  → 前端进度弹窗轮询 GET /api/sentiment/crawl/status

开始舆情分析（弹窗真参数）→ POST /api/sentiment/analyze {keyword, dateFrom, dateTo}
  → 从笔记库筛选：关键词精确 + 发布时间范围 + 正文抓取成功
  → LLM 综合（DashScope 优先 / Ark 兜底，提示词含发布时间）
  → 报告写入 local-data/sentiment/analyses/{id}.json + index.json

历史笔记分析（页面按钮）→ GET /api/sentiment/analyses / analyses/{id}
  → 弹窗列表切换任意历史报告，页面报告区/KPI 整体联动
```

### 16.2 数据与文件

| 文件 | 说明 |
|---|---|
| `local-data/sentiment/crawled-notes.json` | 唯一笔记库（noteId+keyword 去重，上限 500，含正文/发布时间） |
| `local-data/sentiment/analyses/index.json` | 报告索引（id/keyword/createdAt/noteCount/riskLevel/problemCount），按时间倒序 |
| `local-data/sentiment/analyses/{id}.json` | 完整报告（summary/riskLevel/problemPoints/suggestions/noteIds/totalEngagement/period） |
| `参考文件/麻大师床垫避雷.txt` | 保留作一次性导入源（启动时有"库中已含该关键词"守卫，不会重复导入），不参与运行时 |
| `notes-cache.json`、`result.json` | 迁移完成后已删除，被笔记库和 analyses/ 取代 |

### 16.3 API（server/index.mjs）

| 端点 | 说明 |
|---|---|
| `POST /api/sentiment/crawl` | 服务端搜索+入库，返回 {added, pending}；进行中重复调用 409 |
| `GET /api/sentiment/crawl/status` | 抓取进度 {running, keyword, total, ok, failed} |
| `POST /api/sentiment/analyze` | 带参分析（keyword 必填 + 发布时间范围），无匹配笔记 409 |
| `GET /api/sentiment/status` | 分析任务状态 {status, reportId, error} |
| `GET /api/sentiment/analyses[/{id}]` | 历史列表 / 单份报告 |
| `GET /api/sentiment/crawled` | 笔记库读取 |
| 已删除 | `GET /api/sentiment/notes`（txt 运行时读取）、`POST /api/sentiment/crawled`（前端写入）、`POST /api/workflow/run` 与 `POST /api/note/detail`（页面直连工作流的过渡路由，改由 sentiment.mjs 内部调用 workflow-proxy）、`src/services/workflowApi.ts`（无消费者死代码） |

权限沿用 `/api/sentiment` 前缀映射（GET → intelligence.view，POST → intelligence.manage）。

### 16.4 页面变化

- 「刷新笔记列表」按钮 → 「历史笔记分析（N）」：弹历史列表，点击切换报告区/KPI/摘要/问题点/建议。
- 抓取进度弹窗改为轮询服务端状态；正文由服务端抓取并逐批落盘，关页/刷新不中断、不丢进度。
- 分析弹窗参数真正生效：关键词单选 + 笔记发布时间范围（此前服务端忽略参数、只认 txt）。
- 重抓同一关键词：已有正文的笔记保留，失败/待抓取的重新入队；页面不再出现重复行。
- KPI/报告区绑定「当前选中报告」（默认最新），不再绑定最近一次运行。

### 16.5 详情工作流升级 + 小红书号列（2026-08-22 晚）

- 笔记详情工作流换为 `coze.noteDetailWorkflowId=7676769225382297634`（source-config.json）：返回 `author.author_info`（red_id/nick_name/fans/follows/desc/ip）+ `note.note`（note_desc 正文/note_create_time/note_tags）。
- `fetchNoteDetail` 返回新增 `redId`、`fans`；正文模板新增「小红书号」「粉丝」行；`parseNoteDetail` 统一解析新旧嵌套层级。
- 笔记库条目新增 `redId`/`fans` 字段（随正文抓取回填）；监控笔记明细新增「小红书号」列（列宽 110，表格 1540）。
- 已验证：直调 fetchNoteDetail 返回 redId=5313889366/fans=121；新关键词「麻大师异味」爬 20 条，redId 20/20、publishTime 20/20；浏览器确认列显示正常。
- 旧工作流 7631819451410907182 停用；旧笔记的 redId 为空显示「—」，重抓该关键词即可补齐。

### 16.6 全局滚动条可拖动 + 白天模式可见性修复（2026-08-22 晚）

- `src/styles.css` 全局滚动条：滑块 8px → 10px、圆角 5px、border 2px + background-clip: padding-box；hover 加深；白天主题（`:root[data-theme="light"]`）滑块改深色 rgba(15,42,53,0.45)、hover 0.7、轨道 0.06——修复白色 12% 滑块在浅色背景上肉眼不可见。
- **关键坑**：`:root[data-theme="light"] ::-webkit-scrollbar-thumb`（后代选择器）匹配不到 html 自身的窗口级滚动条；舆情页等内容超长的页面滚在 window 级，深色滑块对它们不生效。已补 `:root[data-theme="light"]::-webkit-scrollbar-thumb`（无空格）双选择器。
- Firefox：`html { scrollbar-width: thin; scrollbar-color }` + 白天 `color-scheme: light`。
- 验证：GLM 视觉模型看图判定白天模式滑块「清晰可见、色差明显、约 6-8px 适合拖动」（窗口级 + 容器级两处）；有头 Chrome 真实鼠标拖动滑块 scrollY 0 → 3557。注意 headless 模式 CDP 鼠标事件拖不动浏览器滚动条属测试环境限制，非功能缺陷。

### 16.7 相关关键词多选抓取 + 舆情词云（2026-08-22 深夜）

- **相关关键词**：`POST /api/sentiment/related-keywords {keyword}` → `fetchRelatedKeywords`（workflow-proxy.mjs，Coze 工作流 `coze.keywordTopicsWorkflowId=7676780578120745010`，解析 `note.topic_list` → `[{name, viewNum}]` 去重上限 20）。页面搜索按钮改「获取相关关键词」，chips 多选（原始词默认选中，显示浏览量），「抓取所选（N）」批量抓取。
- **多关键词抓取**：`startCrawl(keywords[])` 上限 10、自动去重；runCrawlJob 两阶段（先全部搜索入库 → 统一补抓正文）；`crawl/status` 增加 `keywords/keywordIndex/phase/errors`；单关键词搜索失败不中断任务。进度弹窗显示「第 k/N 个关键词」。
- **舆情词云**：纯前端派生（无新接口）。`Intl.Segmenter('zh')` 分词 + 模块级停用词表 + 关键词自身词元排除 + 词频≥2 + Top40；字号对数映射 12~28px，三档色阶（Top3 绿 / Top4-10 青 / 其余蓝灰）；点击词联动明细表过滤。卡片默认跟随当前报告关键词。
- 已验证：Playwright 端到端（20 chips、多选抓取 2 关键词 22 条 0 失败、词云 40 词最高频「黄麻」、点击词过滤 162→109、控制台零错误）；5V 视觉模型验收 chips 选中态与词云层次/配色/排除词全 PASS。
- 词云停用词表在 `src/pages/SentimentPage.tsx` 的 `WORD_CLOUD_STOPWORDS`，按需增删。

### 16.8 验收修复：redId/fans 保留 + 409 挂接加固（2026-08-22 深夜）

- **bug（glm-5.3 subagent 发现）**：`upsertNotes` 的「已有正文保留」分支没回抄 `existing.redId/fans`，重抓同关键词会把小红书号清空且不会自动恢复（ok 笔记不重新进队列）。已修：合并对象补 `redId/fans`。存量数据已回填（102 条，现 9 个关键词 redId 覆盖 20/20~22/24，仅 2 条无标题笔记源数据抓不到）。
- **409 挂接加固**：此前挂接「进行中任务」依赖错误文案 `msg.includes("正在进行中")`，响应体异常时会走错误分支显示「请求 /api/sentiment/crawl 失败：409」。现在 `fetchJson` 把 HTTP 状态码挂在 Error.status 上，抓取入口对 `status === 409` 一律挂接轮询（浏览器复现挂接正常，该加固为防御性）。
- 代码层验收 13/13 PASS（边界/契约/死代码/旧签名残留全过）；视觉层 5V 验收 chips 与词云全 PASS（见 16.7）。
- 回填脚本一次性执行后已删除，未入仓。

### 16.9 明细表增强 + 舆论倾向 + LLM 推理拉满（2026-08-22 深夜二）

- **词云关键词优先透出**：舆情词云下拉切换关键词时，监控笔记明细默认把该关键词的笔记排在最前（其余按库序）；用户点了列排序后以排序为准。
- **明细表列排序**：关键词/作者/发布时间/赞/评论/收藏/转发/舆论倾向/抓取时间 9 列可点击表头升降序（再点切换方向，箭头指示；文本列中文 localeCompare）。
- **舆论倾向列（固定算法，不接 LLM）**：领域情感词典打分（负面 ~74 词 + 正面 ~29 词，`SentimentPage.tsx` 的 `NEGATIVE_TERMS/POSITIVE_TERMS`，命中次数比较），负面>正面→负面(red)，反之正面(green)，相等或无正文→中性(muted)；悬停显示命中明细；可按倾向分排序（最负面在前）。选词典算法而非 LLM 的原因：204 条笔记即时计算零成本、可解释、确定性；逐条 LLM 分类成本/延迟高且整体态势已由分析报告覆盖；反讽/否定句是已知盲区，后续可升级批量 LLM 分类。实测分布：负面 108 / 正面 41 / 中性 55，降序首位为强负面笔记（合理）。
- **分析 LLM 推理强度拉满**：`callArk` 请求加 `reasoning_effort: "max"`（已实测端点接受 max/xhigh/high；该模型默认带思维链）；配套 `max_tokens` 4096→16384、`LLM_TIMEOUT_MS` 120s→300s 防 max 推理截断/超时。实测「麻大师异味」20 条笔记分析 50s 完成、报告正常（问题点 6/建议 6）。
- 表格列 13→14（舆论倾向），minWidth 1540→1650。

### 16.11 大规模扩库 + 倾向算法优化（2026-08-22 深夜三）

- **扩库战役**：笔记库上限 500→2000（`CRAWLED_MAX_NOTES`）；用相关关键词 API 从 4 个种子收集 42 个候选，剔除 6 个非品牌噪声（麻将/麻辣烫游戏等）取 36 个，4 批串行抓取约 60 分钟。最终笔记库 **992 条 / 38 个关键词 / 正文成功率 992/992**。
- **倾向算法 v2**（三个机制 + 词典扩充）：
  1. 最长匹配消耗式扫描（首字分桶）：修掉"骗人"同时命中"骗"、"千万别买"同时命中"别买"的双重计数；
  2. 否定窗口：命中前 1~2 字为 不/没/无/毫无/并不/不太/没啥/从未 时不计分（"没有异味"不再算负面）；"无异味/没味道"等作为显式正面词先被消耗；
  3. 标题命中权重 ×2（标题是最强立场信号）；
  4. 词典扩到 负面 ~106 词 / 正面 ~48 词，含反转句式（"拯救塌陷""救了我的腰""后悔没早""相见恨晚"先于负面词被消耗，避免把好评误判成负面）。
- **992 条实测分布**：负面 383（38.6%）/ 中性 398（40.1%）/ 正面 211（21.3%）；双向抽查明检率：负面关键词下判正面 13 条（多为 yyds/爆拆好评帖，判对）、推荐关键词下判负面 27 条（多为真踩雷帖，判对），误判率约 2~3%，集中在反讽与"过去腰疼vs现在"语境，属词典法已知边界。
- 调参入口：`SentimentPage.tsx` 顶部 `NEGATIVE_TERMS/POSITIVE_TERMS`，改完 `npm run build` 即生效（纯前端，无需重启 Node）。

### 16.12 报错笔记剔除 + 工作流失效识别（2026-08-23 凌晨）

- **问题**：详情工作流 cookie 失效时返回 `{a_msg:"false…", cookie_status:false, author_info 全空}`，旧逻辑把原始 JSON 当正文入库——992 条中 345 条是报错笔记。
- **修复**：`fetchNoteDetail` 新增 `isDetailErrorResponse`（a_msg/msg/n_msg 以 false 开头、cookie_status===false、无 desc/title/tags 任一内容 → 抛错按抓取失败处理，不再入库）；正文为空同样抛错。
- **存量清理**：已从笔记库删除 345 条报错笔记（剩余 647 条真实笔记）；受影响关键词清单存 `local-data/tmp-affected-kws.json`（22 个）。
- **搜索失效上报**：`runCrawlJob` 对搜索工作流返回 false/cookie_status:false 的关键词记入 `crawlJob.errors`（进度弹窗显示「部分关键词失败」），不再静默当作"没搜到笔记"。
- **待人工处理**：搜索工作流（7675983801533644836）cookie 已失效（多次实测稳定返回 false、0 笔记；详情工作流 7676769225382297634 仍正常）。需在 Coze/服务方侧续期 cookie；恢复后重抓 22 个受影响关键词即可补回被删笔记（页面多选或用 tmp-affected-kws.json 清单）。

### 16.10 重构初期验证记录（2026-08-22）

- 迁移：txt 20 条 + 正文缓存 + 旧 result.json → 笔记库（当前 101 条 / 5 关键词，含验收期新增「麻大师甲醛」20 条）/ 首份历史报告（2026-08-21 那份，时间戳已修正为真实完成时间）。
- Playwright + 系统 Chrome：历史弹窗切换新旧报告、带参分析生成新报告（麻大师床垫，20 条笔记）入档、刷新后报告保留、控制台零错误。
- 服务端抓取引擎 API 级测试：新关键词「麻大师甲醛」入库 20 条，后台补抓 20/20 成功、发布时间 20/20，~45s 完成。
- subagent 独立验收 18/18 PASS（功能重复消除、API 契约、前端接线、dist 一致性、tsc/build/git diff --check）；其指出的 workflowApi.ts 死代码与两条过渡路由已删除。
- `npx tsc --noEmit`、`npm run build` 通过；5174 已部署。