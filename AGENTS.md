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

## 无人值守同步

- Windows 任务名为 EcomAIStudio-DingTalk-Sync，采用 S4U、网络可用、失败重试和单实例锁。
- 固定执行时间为 10:30、13:00、17:30（Asia/Shanghai）；同步成功与失败必须写入运行健康状态和操作日志。
- 同步脚本支持 dry-run、超时、重试和锁跳过；不要在浏览器端直接暴露钉钉凭证。
- 公网部署必须保护 /api/sync/*，并保留 /api/health 的脱敏状态信息。

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
