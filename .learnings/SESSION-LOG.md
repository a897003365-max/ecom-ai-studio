# Session Log

## 2026-07-14

- 交接：补充项目约束、运行入口、数据口径、无人值守状态和残余风险。
- 清理：登记并清理浏览器快照、旧开发/预览进程日志与测试缓存；保留业务快照、同步健康状态和当前服务日志。
- 验证：复跑构建、钉钉、PowerBI、本地数仓和 Python 测试，并核对文档日期与路径。
- 运行：15:26:37 重启 5180 生产服务加载服务端修正，15:27:11 健康检查恢复正常。

## 2026-07-23

- 诊断：钉钉 10:00 同步失败根因 = 钉钉 Sheet API 早高峰 503，脚本 3 次重试（5s/10s 退避）窗口太短全败；本地数仓无定时任务、与钉钉无联动，设计上只能 HTTP 手动触发。
- 修复 A：sync-dingtalk.mjs 退避改为 30s/60s/120s 封顶 120s；环境变量 DINGTALK_SYNC_ATTEMPTS=5。验证：手动同步第 3 次重试成功（此前 3 次全败），recordCount 7879。
- 修复 B：DINGTALK_SYNC_TIMES 改为 10:30,13:00,17:30 错峰；register-dingtalk-schedule.ps1 改为从注册表读该变量作默认时间，避免计划任务与环境变量脱节；重跑 ps1 重新注册。
- 修复 D：新建 server/warehouse-lock.mjs + scripts/sync-warehouse.mjs + scripts/register-warehouse-schedule.ps1；注册数仓计划任务 EcomAIStudio-Warehouse-Sync（11:00,18:00，S4U）。验证：真实同步 29s 成功，recordCount 2687759。
- 环境：setx PYTHON=E:\anaconda\python.exe，sync-warehouse.mjs 启动时从注册表补设 process.env.PYTHON，确保 S4U 计划任务下 executeSync 用绝对路径调 python。
- 陷阱：PowerShell 5.1 按 GBK 读取无 BOM 的 UTF-8 .ps1，中文注释会破坏语法；.ps1 注释保持英文。
