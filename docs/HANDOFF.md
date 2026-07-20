# ecom AI Studio 交接文档

更新时间：2026-07-16  
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
- 执行时间：10:00、12:30、17:30（Asia/Shanghai）。
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
| 运行记录 | docs/OPERATIONS-LOG.md、.learnings/SESSION-LOG.md |

## 7. 已验证命令

以下命令在 2026-07-16 通过：npm run build、npm run test:auth、npm run test:analytics-dashboard、npm run test:smoke、npm run test:dingtalk-api、npm run test:dingtalk-unattended、npm run test:powerbi-images、npm run test:powerbi-replica、npm run test:dashboard-ui、npm run test:select-theme、npm run test:analytics-sync、npm run test:public-surface、python -m unittest discover -s pipeline/tests -v、git diff --check。

当前 `npm run test:ux-polish` 有一个既存的过期文案断言：它要求商品管理页出现“商品销售、履约、退货与渠道分布”，而当前页面已经移除该句。目标年份、漏斗和无人值守相关测试均通过。

## 8. 接手前检查

1. 访问 /api/health，确认 dingtalk healthy、schedule 为 10:00,12:30,17:30。
2. 确认 Windows 任务 EcomAIStudio-DingTalk-Sync 的 LastResult 为 0。
3. 保留 local-data/runtime/dingtalk-sync-health.json 和 local-data/logs/dingtalk-sync.log，勿将它们清理为“临时文件”。
4. 检查 MaterialId、ContentId、SKU 的映射是否仍与 PowerBI 快照一致。
5. Intelligence 上传、目录监视和真实 Vision 长任务仍是待实施项。
6. 本地默认免登录；上线设置 `AUTH_ENFORCEMENT_ENABLED=1` 后，首次启动若出现管理员初始化页属于预期。不要在仓库、日志或交接文档记录实际账号密码。
7. 工作区保留用户已有未提交改动；本次没有执行 reset、checkout 或提交。

## 9. 残余风险

- HTTPS / 反向代理部署时必须设置 `AUTH_SECURE_COOKIE=1`；只有代理会覆盖客户端转发头时才设置 `AUTH_TRUST_PROXY=1`，并继续限制可信代理写入 `X-Forwarded-Proto` / `X-Forwarded-For`。
- 钉钉接口仍可能出现短时 500、503 或 fetch failed；程序已覆盖退避重试、单实例锁和健康状态观测，但连续服务端故障仍会保留上一份成功快照并标记 degraded。
- PowerBI 独有数据的源文件持续增量时，需要重新生成快照并复跑图片白名单检查。
