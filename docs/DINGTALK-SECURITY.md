# 钉钉同步安全边界

## 凭证

钉钉 App Key、App Secret、Workbook ID 和 Operator ID 只允许通过本机用户级环境变量提供：

```text
DINGTALK_APP_KEY
DINGTALK_APP_SECRET
DINGTALK_WORKBOOK_ID
DINGTALK_OPERATOR_ID
```

不要把真实值写入仓库、文档、日志、截图、前端代码或 API 响应。带真实值的本地操作指南应保留在项目目录之外；项目根目录同名文件已列入 `.gitignore`。

## 同步边界

- 服务端只读调用 DingTalk Sheet API，前端只接收脱敏后的聚合快照。
- `server/dingtalk-api.mjs` 不向浏览器返回 access token、App Secret 或工作簿标识。
- 定时脚本和网页服务使用互斥锁，避免并发读取触发 DingTalk 503。
- 503、网络中断按指数退避重试；每个 API 请求有超时，避免无人值守任务无限阻塞。
- Windows 计划任务使用 S4U、网络可用条件和失败自动重启；运行状态写入 `local-data/runtime/dingtalk-sync-health.json`，服务端 `/api/health` 仅返回状态和脱敏错误摘要。
- 公网部署时必须在反向代理或应用认证层保护 `/api/sync/*`；当前本地 MVP 不提供登录鉴权。

## 发布前检查

```powershell
npm run build
npm run test:public-surface
```

`test:public-surface` 会扫描 `dist`，阻止凭证名称、认证字段、钉钉 API 地址或当前环境变量值进入公域构建产物。

## 凭证轮换

如果带真实凭证的指南曾经被上传、提交、发送或共享，应在钉钉开发者后台立即轮换 App Secret（必要时同步更新 App Key），再更新本机用户级环境变量；不要把新值写回指南或仓库。

轮换后重启本地 Node 服务和计划任务进程，使缓存的认证配置失效并重新读取环境变量。
