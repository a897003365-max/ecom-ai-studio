<#
.SYNOPSIS
  在 Tailscale 私域内的两台电脑间点对点同步 local-data/ 真实业务数据。

.DESCRIPTION
  设计原则：真实数据（客户对话、爬虫结果、分析产物）不进 Git，
  通过 Tailscale SSH + tar/ssh 流式管道 在两台电脑间传输。

  特性：
    - 走 Tailscale 私域，不经过任何第三方
    - 用 tar|ssh 流式传输，Windows/macOS/Linux 都通用，不需要装 rsync
    - -WhatIf 只预览不实际传输
    - 传输前测试 SSH 连通性，连不上直接报错不传半截
    - 传输后自动校验关键文件存在

.PARAMETER Direction
  push = 本机 → 远端（默认）
  pull = 远端 → 本机

.PARAMETER RemoteHost
  远端 Tailscale 节点名（默认 l-user-1）
  也可以是 Tailscale IP（100.x.x.x）

.PARAMETER RemoteRepoPath
  远端仓库根目录的绝对路径
  默认 D:\Github\ecom-ai-studio（按你另一台电脑的实际情况调整）

.PARAMETER RelativePath
  要同步的子目录（默认 local-data/）
  路径必须在 .gitignore 内，不应进 Git

.EXAMPLE
  # 推送：把本机 local-data/ 推到另一台电脑
  .\sync-local-data.ps1 -Direction push -RemoteHost l-user-1

.EXAMPLE
  # 拉取：从另一台电脑拉 local-data/ 到本机
  .\sync-local-data.ps1 -Direction pull -RemoteHost l-user-1

.EXAMPLE
  # 只看不传
  .\sync-local-data.ps1 -Direction push -WhatIf

.NOTES
  前置条件：
    1. 本机和远端都已登同一个 Tailscale 账号
    2. 本机已开 Tailscale SSH：`tailscale up --ssh`
    3. 远端接受 SSH（默认开，本机 push 时远端不需要先开）

  如果 ssh 命令一直连不上：
    - 本机：`tailscale status` 看 SSH 状态
    - 控制面板 https://login.tailscale.com/admin/machines 启用 SSH
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
  [ValidateSet('push', 'pull')]
  [string]$Direction = 'push',

  [string]$RemoteHost = 'l-user-1',

  [string]$RemoteRepoPath = 'D:\Github\ecom-ai-studio',

  [string]$RelativePath = 'local-data'
)

$ErrorActionPreference = 'Stop'

# 1. 解析本机仓库根
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LocalRepoRoot = (Resolve-Path "$ScriptDir\..").Path
$LocalDataPath = Join-Path $LocalRepoRoot $RelativePath

Write-Host "=== Tailscale 真实数据同步 ===" -ForegroundColor Cyan
Write-Host "本机仓库  : $LocalRepoRoot"
Write-Host "远端主机  : $RemoteHost"
Write-Host "方向      : $Direction"
Write-Host "同步子目录: $RelativePath"
Write-Host ""

# 2. 前置检查
function Test-Prerequisites {
  # 2.1 本机 Tailscale 在线
  $tsStatus = & tailscale status --json 2>$null | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "Tailscale 未运行或 tailscale 命令不可用"
  }

  # 2.2 本机 local-data 存在
  if ($Direction -eq 'push' -and -not (Test-Path $LocalDataPath)) {
    throw "本机 $LocalDataPath 不存在，无可推送内容"
  }

  # 2.3 Tailscale SSH 已开
  $sshStatus = ($tsStatus | ConvertFrom-Json).SSHStatus
  if ($sshStatus -ne 'running') {
    throw @"
Tailscale SSH 未开启（状态: $sshStatus）。
请在本机执行：tailscale up --ssh
或到 https://login.tailscale.com/admin/machines 启用 SSH。
"@
  }

  Write-Host "[OK] Tailscale 运行中，SSH 已开启" -ForegroundColor Green
}

# 3. 测试 SSH 连通性
function Test-RemoteSsh {
  Write-Host "[..] 测试 SSH 连通性到 $RemoteHost..." -ForegroundColor Yellow
  ssh -o BatchMode=yes -o ConnectTimeout=5 "$RemoteHost" "echo connected" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw @"
无法 SSH 到 $RemoteHost。
可能原因：
  1. 远端未登 Tailscale 账号
  2. 远端 SSH 未开（远端也要 `tailscale up --ssh`）
  3. 节点名拼错（用 `tailscale status` 看实际节点名）
"@
  }
  Write-Host "[OK] SSH 连通 $RemoteHost" -ForegroundColor Green
}

# 4. 执行同步（用 tar | ssh 流式管道）
function Invoke-Sync {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param()
  $RemoteDataPath = "$RemoteRepoPath\$RelativePath" -replace '\\', '/'

  if ($Direction -eq 'push') {
    $whatTarget = "${RemoteHost}:$RemoteDataPath"
    $whatSource = $LocalDataPath
  } else {
    $whatSource = "${RemoteHost}:$RemoteDataPath"
    $whatTarget = $LocalDataPath
  }

  if (-not $PSCmdlet.ShouldProcess($whatTarget, "tar 同步 $whatSource → $whatTarget")) {
    return  # -WhatIf 触发，直接返回
  }

  if ($Direction -eq 'push') {
    Write-Host "[..] push: $LocalDataPath  →  ${RemoteHost}:$RemoteDataPath" -ForegroundColor Yellow
    tar czf - -C $LocalRepoRoot $RelativePath |
      ssh $RemoteHost "tar xzf - -C '$RemoteRepoPath'"
    if ($LASTEXITCODE -ne 0) { throw "push 失败，退出码 $LASTEXITCODE" }
    Write-Host "[OK] push 完成" -ForegroundColor Green
  }
  else {
    Write-Host "[..] pull: ${RemoteHost}:$RemoteDataPath  →  $LocalDataPath" -ForegroundColor Yellow
    ssh $RemoteHost "tar czf - -C '$RemoteRepoPath' $RelativePath" |
      tar xzf - -C $LocalRepoRoot
    if ($LASTEXITCODE -ne 0) { throw "pull 失败，退出码 $LASTEXITCODE" }
    Write-Host "[OK] pull 完成" -ForegroundColor Green
  }
}

# 5. 校验
function Test-PostSync {
  if ($Direction -eq 'push') {
    $checkPath = "$RemoteRepoPath\$RelativePath" -replace '\\', '/'
    ssh $RemoteHost "Test-Path '$checkPath'" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "远端同步后路径不存在：$checkPath" }
    Write-Host "[OK] 远端 $checkPath 存在" -ForegroundColor Green
  } else {
    if (-not (Test-Path $LocalDataPath)) {
      throw "本机同步后路径不存在：$LocalDataPath"
    }
    Write-Host "[OK] 本机 $LocalDataPath 存在" -ForegroundColor Green
  }
}

try {
  Test-Prerequisites
  Test-RemoteSsh
  Invoke-Sync
  Test-PostSync
  Write-Host ""
  Write-Host "=== 完成 ===" -ForegroundColor Cyan
}
catch {
  Write-Host ""
  Write-Host "[FAIL] $_" -ForegroundColor Red
  exit 1
}
