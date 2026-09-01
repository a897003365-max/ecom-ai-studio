param(
  [string]$TaskName = "EcomAIStudio-DevServer"
)

$ErrorActionPreference = "Stop"

# 开机（登录时）自启动本地 dev server：node server/index.mjs，API + UI 同端口 5173，集成 Vite HMR。
# 参照 register-warehouse-schedule.ps1 的无人值守 + 失败自动重启模式，触发时机改为用户登录。

$projectRoot = Split-Path -Parent $PSScriptRoot
$serverEntry = Join-Path $projectRoot "server\index.mjs"
$nodePath = (Get-Command node -ErrorAction Stop).Source
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument ('"{0}"' -f $serverEntry) `
  -WorkingDirectory $projectRoot

# 登录时启动
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId

# 常驻服务：无执行时长上限（0），失败自动重启，掉电不停。
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

# S4U：后台会话运行，不绑定交互式控制台窗口，关闭终端/资源管理器窗口不会终止服务
# （与 EcomAIStudio-DingTalk-Sync 一致）。Interactive 会随窗口/会话关闭被杀。
$principal = New-ScheduledTaskPrincipal `
  -UserId $userId `
  -LogonType S4U `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Ecom AI Studio local dev server (Node + Vite, API and UI on port 5173); starts at user logon and restarts transient failures." `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
[PSCustomObject]@{
  TaskName = $task.TaskName
  State = $task.State
  Trigger = "AtLogOn"
  Server = $serverEntry
  UserId = $userId
  LogonType = $task.Principal.LogonType
  Node = $nodePath
}
