# 钉钉 Sheet API 脱敏接入说明

本项目通过服务端 HTTP 直连 DingTalk Sheet API，只读同步运营表格，并在本机保存脱敏后的聚合快照。

## 接入配置

真实值只放在本机用户级环境变量，不进入代码、文档、日志或前端：

```text
DINGTALK_APP_KEY
DINGTALK_APP_SECRET
DINGTALK_WORKBOOK_ID
DINGTALK_OPERATOR_ID
DINGTALK_SYNC_TIMES=10:00,12:30,17:30
```

## API 读取范围

- Base URL：`https://api.dingtalk.com/v1.0`
- 工作簿子表：`GET /doc/workbooks/{workbookId}/sheets`
- 单元格范围：`GET /doc/workbooks/{workbookId}/sheets/{sheetId}/ranges/{range}`
- 认证只在服务端进行，access token 不下发浏览器。
- 读取按 `A:BG`、每块 150 行分段；跨进程同步使用 `local-data/locks/dingtalk-sync.lock` 互斥。

## 运行与检查

```powershell
npm run sync:dingtalk
npm run sync:dingtalk:dry
npm run build
npm run test:public-surface
```

遇到 502/503/504 时服务端按指数退避重试；重复同步会跳过，避免并发请求触发限流或临时服务错误。日志只保留脱敏错误摘要。

## 发布前约束

不要把带真实凭证的操作指南复制到仓库或部署目录。若凭证文档曾被共享，应先在钉钉开发者后台轮换 App Secret，并同步更新本机环境变量。
