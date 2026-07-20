# 运行与验证日志

本文件只记录可复核的运行事件、数据口径修复和验证结果；日期使用 YYYY-MM-DD。

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
