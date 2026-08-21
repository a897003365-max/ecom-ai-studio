# 2026-08-17 · 多机协作基线 + GitHub 安全加严（历史归档）

> 本文件是 2026-08-17 会话的详细归档。**真值状态以 [`../HANDOFF.md` §13](../HANDOFF.md#13-多机协作基线--github-安全加严-2026-08-17) 为准**，本文不再作为新决策的权威依据。

---

## 1. 背景

用户希望在另一台电脑（l-user-1）上继续修改本机的 ecom-ai-studio 项目，前置条件是 Tailscale 私网已通（之前已配好，3 个节点在线）。会话目标：

1. 把本机 56 个未推送的本地 commit + 工作区 baseline 推到 GitHub，作为协作基线
2. 评估「真实数据放 Git 是否有暴露风险」
3. 落实 Tailscale 私域数据同步方案（不走 Git）
4. 强化 GitHub 账号安全（2FA）

---

## 2. 执行的 5 步动作

### 2.1 推送 56 个本地 commit

- 命令：`git push origin agent/publish-ecom-ai-studio`
- 结果：`46d16c2..f8ed6fc`，无冲突
- 这些 commit 是用户之前自己 commit 过的（feat: image matching improvements、fix: product table folding 等），只是没 push

### 2.2 推送工作区 baseline（B 方案）

- 命令：`git add -u`（**只更新已跟踪文件的 M/D，不动 untracked**） + `git commit` + `git push`
- Commit：`da21d16 chore: sync working tree changes as collaboration baseline`
- 包含：60+ modified + 10+ deleted + 10 new + 14 重命名到 `archive/screenshots/`
- **明确排除**：280 个 untracked 文件（运行时/测试产物/客户数据）

### 2.3 加严 `.gitignore`

- Commit：`b5b8857 chore: tighten .gitignore for real data and runtime artifacts`
- 新增规则：
  - 客户/客服数据：`agent_data.json/pkl`、`chat_*.json`、`analytics-res.json`、`客服话术*.html`
  - 本机运行时：`.claude/`、`.workbuddy/`、`.build/`、`check-pw.cjs`
  - 测试产物：`test-*.png`、`test-results/`、`screenshots/`
  - 根目录散落：`01-cockpit.png`、`cockpit.png`、`workbench-light-after.png`、`tmall-detail-*.png`、`report.html`、`review-screenshots.cjs`、`generate_ppt.py`
- 验证：`git check-ignore -v` 9/9 危险文件被忽略；`untracked` 数量 `227 → 60`

### 2.4 生成 Tailscale 真实数据同步脚本

- 文件：`scripts/sync-local-data.ps1` + `docs/tailscale-data-sync.md`
- Commit：`d2a885b feat(scripts): add Tailscale data sync for local-data/`
- 设计要点：
  - 用 `tar | ssh` 流式管道，**不依赖 rsync**（Windows 自带 OpenSSH）
  - `[CmdletBinding(SupportsShouldProcess=$true)]` 支持 PowerShell 内建 `-WhatIf`
  - 前置检查：Tailscale 运行 + SSH 已开 + 本地 `local-data/` 存在 + SSH 连通性
  - 同步后校验：远端路径存在
  - 路径转换：本机用 Windows 路径，远端用 POSIX（`-replace '\\', '/'`）
- 修复历史：
  - 第 1 版有 `$this_host'` typo（JS 模板字符串混入 PowerShell）
  - 第 2 版用 `$WhatIfPreference` 但不是有效参数名
  - 第 3 版用 `[CmdletBinding(SupportsShouldProcess=$true)]` + `$PSCmdlet.ShouldProcess(...)`（PowerShell 标准做法）
  - 修了 PSShouldProcess 警告（函数级也需要 `SupportsShouldProcess`）

### 2.5 GitHub 2FA 启用（用户手动进行中）

- Token 类型：OAuth `gho_*`（gh CLI 管理）
- 当前状态：用户在 GitHub 设置页走第 1 步（QR 码扫描 + 6 位码验证）
- 未完成：第 2 步（保存 10 个 recovery codes）+ 第 3 步（最终确认）

---

## 3. 关键决策与理由

### 3.1 为什么选 B1 纯 Git 而不是 B2/B3

- **B1（纯 Git）**：另一台 clone + 编辑 + push，本机 pull + build。看代码走 GitHub，数据走 Tailscale
- **B2（纯 SSH）**：另一台 SSH 直连本机编辑。缺审计
- **B3（混合）**：B2 + 在 SSH 窗口里走 Git。最强但要先开 Tailscale SSH

用户先选 B1（最稳），但保留升级到 B3 的能力（脚本支持）。

### 3.2 为什么 push 全部工作区改动作为一个 commit

- 目的：「协作基线」= 让另一台电脑 clone 后能立即跑起来
- 拆分会增加合并复杂度，且每台电脑都要做相同的拆分
- 如果后悔：`git revert da21d16` 可整体回退

### 3.3 为什么真实数据走 Tailscale 不走 Git

| 维度 | Git | Tailscale + tar/ssh |
| --- | --- | --- |
| 数据流向 | 经 GitHub 服务器中转 | 端到端直连 |
| 仓库大小 | 1GB 该考虑 LFS | 任意大小 |
| 历史保留 | 全量历史（占空间） | 单次传输 |
| 误删保护 | 强（commit + revert） | 弱（覆盖不删） |
| 适合 | 代码、配置、文档 | 数据、模型、原始文件 |

**根本原因**：Tailscale 和 GitHub 是两套不同的信任体系。即使 GitHub private，信任边界已跳出 Tailscale 私域。

### 3.4 为什么 `git add -u` 不是 `git add .`

- `git add -u`：只更新**已跟踪文件**的 M/D，**不碰 untracked**
- `git add .`：包含 untracked，会把客户数据带上去
- 这个差异是这次操作能成功的关键——untracked 里的 167 个危险文件因此被正确排除

### 3.5 为什么脚本用 tar/ssh 而不是 rsync

- 本机 `which rsync` → `command not found`（Git Bash 不带）
- 本机 `which scp` / `which ssh` → 都在（Windows OpenSSH 自带）
- `tar czf - -C <repo> local-data | ssh <host> "tar xzf - -C <repo>"` 流式管道：
  - 跨 Windows / macOS / Linux 通用
  - 不需要远端装 rsync
  - 边压缩边传边解压
  - 自动处理目录结构

---

## 4. 用户需要做但只有他能做的事

| 事项 | 操作 | 紧急度 |
| --- | --- | --- |
| 完成 2FA 第 2 步（保存 recovery codes） | 抄到纸上 + 密码管理器各一份 | 立即 |
| 验证 2FA 实际生效 | 登出 → 重登 → 输 6 位码 | 立即 |
| 决定 Tailscale SSH 是否开启 | 本机 `tailscale up --ssh`（仅当需要 B3 模式或同步脚本） | 视需要 |
| 60 个 untracked 分批 commit | 按子目录：`git add scripts/` `git add src/` `git add docs/` 分多次 | 按需 |

---

## 5. 故障排查速查

| 症状 | 原因 | 解决 |
| --- | --- | --- |
| `git push` 报 `non-fast-forward` | 远端有本地没有的 commit | `git pull --rebase` 再 push |
| `git push` 报 `Permission denied` | GitHub 账号不是同一个 | VSCode 重登 GitHub |
| 脚本报 `Tailscale SSH 未开启` | 本机没 `tailscale up --ssh` | 本机执行该命令 |
| 脚本报 `无法 SSH 到 l-user-1` | 远端未开 Tailscale SSH / 节点名错 | `tailscale status` 看实际节点名 |
| 5174 没生效 | 工作模式是 `--production`，只读 `dist/` | 改完代码必须 `npm run build` |
| 看门狗没重启 | 进程没退 | `Stop-Process -Name node -Force` |

---

## 6. 验证清单

会话结束时已验证：

- 57 commits 全部推送成功（56 旧 + 1 baseline + 1 gitignore + 1 sync script）
- `.gitignore` 锁死 9/9 关键危险文件
- `pwsh -File scripts/sync-local-data.ps1 -Direction push -WhatIf` 语法 OK + 前置检查触发
- `npm run build` 通过
- `git diff --check` 通过

未验证（需要外部条件）：

- Tailscale SSH 实际开启后的 push/pull 流量（需用户在另一台电脑 + 开启 SSH）
- 2FA 实际生效（用户在浏览器完成第 2/3 步）
- 5174 私域站在新代码生效后 UI 正常

---

## 7. 相关链接

- 真值状态：[`../HANDOFF.md` §13](../HANDOFF.md#13-多机协作基线--github-安全加严-2026-08-17)
- 同步脚本：[`../../scripts/sync-local-data.ps1`](../../scripts/sync-local-data.ps1)
- 同步使用指南：[`../tailscale-data-sync.md`](../tailscale-data-sync.md)
- 之前的看板提速归档：[`2026-08-01-dashboard-perf.md`](2026-08-01-dashboard-perf.md)（参考协作归档格式）
