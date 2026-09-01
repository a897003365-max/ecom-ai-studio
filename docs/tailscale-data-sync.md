# Tailscale 私域数据同步指南

> 真实业务数据（客户对话、爬虫结果、分析产物）**不进 Git**，
> 通过 Tailscale 私网点对点同步给另一台电脑。

---

## 为什么不用 Git 同步数据

Git 设计为代码/文本协作，不是数据分发：

| 维度 | Git | Tailscale + tar/ssh |
|---|---|---|
| 数据流向 | 经过 GitHub 服务器中转 | 端到端直连，不过任何第三方 |
| 仓库大小 | 1 GB 就该考虑 LFS | 任意大小 |
| 历史保留 | 全量历史（占空间） | 单次传输，不留历史 |
| 撤销 | 改 commit | 重新传一份覆盖 |
| 误删保护 | 强 | 弱（只覆盖，不删） |
| 适合 | 代码、配置、文档 | 数据、模型、原始文件 |

---

## 前置：开启 Tailscale SSH

Tailscale SSH 默认**未开**，需要在本机执行一次：

```powershell
# 在本机（l-user / 100.113.194.123）执行
tailscale up --ssh
```

或在 Tailscale 控制面板（https://login.tailscale.com/admin/machines）启用 SSH。

**两台电脑都要开**（push 只需本机开，pull 需要远端也开）。

验证：
```powershell
ssh l-user-1 "echo ok"
# 应返回 ok（首次会问 host key 信任，输入 yes）
```

---

## 同步脚本：`scripts/sync-local-data.ps1`

### 基本用法

```powershell
# 推送：本机 local-data/ → 远端
.\scripts\sync-local-data.ps1 -Direction push -RemoteHost l-user-1

# 拉取：远端 local-data/ → 本机
.\scripts\sync-local-data.ps1 -Direction pull -RemoteHost l-user-1

# 预览（不实际传）
.\scripts\sync-local-data.ps1 -Direction push -WhatIf
```

### 自定义参数

```powershell
# 远端仓库不是默认路径
.\scripts\sync-local-data.ps1 -Direction push `
  -RemoteHost 100.122.239.33 `
  -RemoteRepoPath "D:\Projects\ecom-ai-studio"

# 同步别的子目录（如果将来有别的数据目录）
.\scripts\sync-local-data.ps1 -Direction push -RelativePath "local-data/dingtalk-cache"
```

### 工作原理

用 `tar | ssh` 流式管道：

```
push: 本机 tar czf - local-data/ | ssh 远端 "tar xzf - -C <仓库根>"
pull: ssh 远端 "tar czf - local-data/" | tar xzf - -C <本机仓库根>
```

- 边压缩边传输边解压，省一半空间（一台机器上不同时存压缩+解压产物）
- Windows / macOS / Linux 通用（都自带 tar + ssh）
- 远端不需要装 rsync
- 增量友好（tar 自动处理目录结构，覆盖写入）

---

## 同步的目录（必须在 .gitignore 内）

| 目录 | 内容 | 是否同步 |
|---|---|---|
| `local-data/` | 业务数据、缓存、API 快照 | ✅ 同步 |
| `local-data/intelligence/` | 竞品情报 + 60 张主图 | ✅ 同步（最大头） |
| `local-data/dashboard-cache/` | 看板缓存 | ✅ 同步 |
| `local-data/dingtalk-*.json` | 钉钉数据快照 | ✅ 同步 |
| `output/` | 一次性报告 | ❌ 重新生成为准 |
| `参考文件/` | 外部只读参考 | ❌ 不应该跨机共享 |

---

## 替代方案：纯手动 scp

如果不想用脚本，可以一行命令：

```powershell
# push
tar czf - -C $PWD local-data | ssh l-user-1 "tar xzf - -C D:\Github\ecom-ai-studio"

# pull
ssh l-user-1 "tar czf - -C D:\Github\ecom-ai-studio local-data" | tar xzf - -C $PWD
```

---

## 安全注意

1. **Tailscale SSH 默认对你的 Tailscale 账号下所有设备开放**——Tailscale 控制面板可以细粒度授权（按设备/按用户）
2. **不要把数据同步给不在你 Tailnet 内的设备**——脚本会校验 SSH 连通性，连不上会拒绝执行
3. **远端仓库根目录会被覆盖**——如果远端有未提交的 local-data 修改，会被 push 覆盖。建议远端永远保持 local-data 是 `git status` 里的 ignored 状态

---

## 故障排查

| 症状 | 原因 | 解决 |
|---|---|---|
| `Tailscale SSH 未开启` | 本机没 `tailscale up --ssh` | 本机执行该命令 |
| `无法 SSH 到 l-user-1` | 远端没开 Tailscale SSH / 节点名错 | `tailscale status` 看实际节点名 |
| `本机 local-data/ 不存在` | 本机没数据 | 确认是否有数据，或切换 -Direction pull |
| 远端覆盖了重要文件 | push 会覆盖不删除 | 远端有需要保留的先备份再 push |
