# Learnings

## LRN-20260714-001：日期对齐优先于汇总行

- 类型：correction
- 状态：archived
- MTD 指标必须先验证汇总行的完成日期，再决定是否使用汇总；跨日期范围时以日明细重算。
- 已固化到 server/dingtalk-api.mjs、回归测试和 AGENTS.md。

## LRN-20260714-002：商品图片使用服务端白名单

- 类型：best_practice
- 状态：archived
- PowerBI 商品图片只从已验证 CDN 返回，避免把任意外部地址带入公域页面。
- 已固化到 PowerBiReplica、快照校验和 AGENTS.md。

## LRN-20260714-003：无人值守同步需要多层保护

- 类型：best_practice
- 状态：archived
- S4U 任务、网络条件、单实例锁、超时、重试、健康状态和脱敏接口需同时存在，单项配置不能替代完整观测。
- 已固化到任务注册脚本、同步服务、DingTalk 安全文档和 AGENTS.md。
