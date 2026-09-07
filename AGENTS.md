# ecom AI Studio 项目约束

## 项目边界

- 前端与接口由单一 Vite/Node 服务提供，默认端口为 5180；保持现有深色运营看板视觉语言。
- 钉钉数据是运营看板的权威口径；PowerBI 本地数仓只承载钉钉表未覆盖的差异数据。
- local-data、dist、node_modules、.env 和运行日志属于本机运行目录，不应提交到仓库或复制到公域。
- 任何公开部署都必须移除明文凭证，并通过环境变量、受限接口和服务端代理访问外部数据。

## 数据口径硬规则

- 月累计回款额（MTD）按筛选月份和筛选结束日计算；优先使用与结束日一致的钉钉汇总行，否则用钉钉日明细重算。
- 当汇总行的完成日期早于筛选结束日时，不得继续使用该汇总行覆盖更晚的日明细。
- 钉钉同步只保留权威表范围；PowerBI 独有查询不得覆盖钉钉权威字段。
- PowerBI 商品图只允许来自已验证的图片 CDN 白名单；外部图片 URL 必须在服务端校验后返回。

## 避坑指南

### 源码改动"刷新没变化"

- 5174 端口是生产实例（node server/index.mjs --production），页面服务的是 dist/ 构建产物；只改 src/ 不跑 npm run build，页面永远不变。
- npm run build 可能被与本次改动无关的既有 TS 错误卡住（案例：IntelligencePage.tsx 误从 ./Pagination 导入，实际文件在 src/components/Pagination.tsx）；构建失败时 dist 保持旧版。排查顺序：先确认构建成功，再对比 curl http://100.113.194.123:5174/ 的 asset hash 与 dist/index.html 是否一致。
- 数据侧同理：无筛选时 /api/products 返回上次同步的快照，pipeline 新增字段要等下次同步（11:00/13:00/17:30）或手动 POST /api/sync/warehouse 才出现；带日期筛选的按需查询即时执行最新 pipeline 代码，可用来先行验证。
- 天猫明细快照固定 60 天滚动窗口（POWERBI_PAGE_WINDOW_DAYS=60，随最新数据日前移）：全局筛选 ⊆ 窗口时页面用快照（零等待）；超出时走 /api/analytics/powerbi-pages 按需重算（30 天 ~18s、8 个月 ~30-75s，server 缓存后同区间毫秒级），渲染区间=全局筛选区间，数仓缺口在工具栏标签标注；按需路径不含客服聚合（客服 tab 恒读快照）。同步完成/服务重启后服务端自动预热「当年 1 月 1 日 ~ 数据最新日」（起点可用 POWERBI_PREWARM_START 覆盖，5 分钟轮询 mtime）；把全局筛选终点选到数据最新日可直接命中预热缓存。
- 同步进行中 ecom.duckdb 被独占锁定，按需查询会报 stale；等同步结束再验证。

### 契约/冒烟测试与实现漂移

- 改组件列名、KPI 占位、单元格合并等展示结构，或调整数据白名单口径时，必须同步更新对应契约断言（scripts/test-powerbi-replica-contract.mjs、scripts/smoke-local.mjs 等）；契约以线上实现为准，不允许让测试长期红着。
- 测试失败先判定是否既有失败：`git stash` 对照 HEAD 跑一遍再决定修复方向（案例：竞品表列名 ROI/点击率 简化后契约没跟、smoke 图片白名单只写死 alicdn 而 pipeline `_safe_product_image` 白名单已含 img.pddpic.com / h2.appsimg.com）。
- 白名单/口径类真值只在一处定义（如图片 CDN 白名单在 pipeline `_safe_product_image`），测试断言引用同一清单，不要各自写死副本。

### 隐藏截断导致图表/表格数据"不准"

- 折线图系列截断：matrixToTrendSeries 曾默认只画销量前 8 个系列，排名靠后的维度（案例：床架工厂，10 仓中排第 10）整张图消失。该参数已删除，新增图表不得再设 topN 类截断；SPU_TREND_COLORS 现有 14 色，超出会循环撞色。
- 口径混排截断：先按订单日期圈定订单、再按发货日期分组，会丢掉"下单早、发货晚"的长周期单（案例：2026-09-01 实际发货 30 件，图上仅 20/24 件）。发货量类图表必须用纯发货日期口径：基于 prev_view（保留状态/渠道/店铺筛选、无日期过滤），日期范围直接作用于发货日期。
- 无全局筛选时每日矩阵只取近 30 天窗口（warehouse.py 的 daily_window）；核对数据差异时先确认这个窗口。
- 渠道决策卡红黄灯最多 5 条、头部建议最多 4 条，超出静默丢弃（ChannelDecisionCard.tsx）；SPU 搜索下拉最多 50 个选项（SpuSearchSelect.tsx）。
- pipeline 端 LIMIT 5000/500000 是安全阀，当前数据量碰不到，勿当业务口径。
- 已披露、不算坑：7.3 单品明细表前 12 名与退款 Top3 在卡片标题/注释写明；MatrixTable 等的 pageSize 分页有翻页控件。

## 无人值守同步

- Windows 任务名为 EcomAIStudio-DingTalk-Sync，采用 S4U、网络可用、失败重试和单实例锁。
- 固定执行时间为 11:00、13:00、17:30（Asia/Shanghai）；同步成功与失败必须写入运行健康状态和操作日志。
- 同步脚本支持 dry-run、超时、重试和锁跳过；不要在浏览器端直接暴露钉钉凭证。
- 公网部署必须保护 /api/sync/*，并保留 /api/health 的脱敏状态信息。

## yudao 主数据后台

- yudao-boot-mini（E:/Github/yudao-boot-mini，独立仓库）承载人工录入的档案类数据：商品档案、店铺渠道、竞品价格；看板只做服务端只读代理，前端不直连。
- 看板侧只经 server/yudao-client.mjs 调 yudao REST API；服务账号只读（4 个 ecom:*:query 权限），yudao 不可达时 /api/masterdata/* 降级返回空列表，不得让页面报错。
- .env 的 YUDAO_PASSWORD 含 # 时必须加双引号；不在仓库记录实际密码。
- yudao 四件套（MySQL 3306 / Redis 6379 / server 48080 / UI 48081）为手工启动，启停方式见 docs/HANDOFF.md 第 12 节；不动钉钉权威口径与数仓链路。

## 常用验证

- npm run build
- npm run test:smoke
- npm run test:dingtalk-api
- npm run test:dingtalk-unattended
- npm run test:powerbi-images
- npm run test:powerbi-replica
- npm run test:dashboard-ui
- npm run test:select-theme
- npm run test:analytics-sync
- npm run test:public-surface
- python -m unittest discover -s pipeline/tests -v
- git diff --check

## 文档入口

- docs/HANDOFF.md：交接、运行入口、数据范围和已验证状态。
- docs/OPERATIONS-LOG.md：按绝对日期记录同步、修复和验证事件。
- docs/DINGTALK-SECURITY.md：钉钉凭证、接口和公域部署约束。
- docs/OPERATIONS_DATA_INTEGRATION_PLAN.md：运营数据集成方案。
- docs/POWERBI-UNIQUE-DATA-PRESENTATION-PLAN.md：PowerBI 独有数据呈现方案。
- docs/SENTIMENT-COZE-WORKFLOW.md：小红书舆情模块扣子工作流代码包（自包含，可移交其他 agent 复用）。
