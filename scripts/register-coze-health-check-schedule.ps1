# 注册「Coze API 每日连通性检查」Windows 计划任务。
# 与 EcomAIStudio-DingTalk-Sync 一致：S4U 登录、网络可用条件、失败自动重启、单实例。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-coze-health-check-schedule.ps1 [-Time "08:30"]
param(
  [string]$TaskName = "EcomAIStudio-CozeHealthCheck",
  [string]$Time = "08:30"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $PSScriptRoot "check-coze-api.mjs"
$nodePath = (Get-Command node -ErrorAction Stop).Source
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument ('"{0}"' -f $scriptPath) `
  -WorkingDirectory $projectRoot

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 10) `
  -RunOnlyIfNetworkAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

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
  -Description "Ecom AI Studio daily Coze API connectivity check; only sends a Feishu webhook alert when the API is unreachable or the token is invalid." `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
[PSCustomObject]@{
  TaskName = $task.TaskName
  State = $task.State
  Time = $Time
  Script = $scriptPath
  UserId = $userId
  LogonType = $task.Principal.LogonType
  RestartCount = $task.Settings.RestartCount
  RunOnlyIfNetworkAvailable = $task.Settings.RunOnlyIfNetworkAvailable
  NextRun = (Get-ScheduledTaskInfo -TaskName $TaskName).NextRunTime
}