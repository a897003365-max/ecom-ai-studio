# Errors

## ERR-20260711-001：DuckDB 文件监听 EBUSY

- 状态：resolved
- 症状：Vite 监听 local-data/warehouse/ecom.duckdb 时返回 EBUSY。
- 处理：数据库保留在服务端数据目录，前端开发监听不再依赖该文件；生产服务改用独立日志路径。
- 证据：docs/OPERATIONS-LOG.md 的 2026-07-11 条目。

## ERR-20260713-001：WebSocket 端口 24678 被占用

- 状态：resolved
- 症状：开发服务无法绑定 WebSocket 端口。
- 处理：以实际监听端口为准，生产服务固定使用 5180，旧进程日志已归档后清理。
- 证据：docs/OPERATIONS-LOG.md 的 2026-07-13 条目。

## ERR-20260714-001：生产 PORT 环境继承

- 状态：resolved
- 症状：启动命令未显式设置 PORT 时可能继承非预期端口。
- 处理：显式设置 PORT=5180，并通过监听端口和 /api/health 验证。

## ERR-20260714-002：MTD 使用过期汇总行

- 状态：resolved
- 症状：筛选结束日为 2026-07-13 时仍使用完成于 2026-07-12 的汇总行。
- 处理：汇总行日期必须等于筛选结束日，否则按日明细重算；新增回归测试。
- 证据：server/dingtalk-api.mjs、scripts/test-dingtalk-api.mjs、docs/OPERATIONS-LOG.md。
