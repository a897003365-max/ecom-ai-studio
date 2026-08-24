param(
  [string]$TaskName = "EcomAIStudio-Jushuitan-Export",
  [string]$Time = "09:45"
)

$ErrorActionPreference = "Stop"

# 9:45 daily schedule: export the Jushuitan product query to the local daily-data folder.
# Same pattern as register-warehouse-schedule.ps1 / register-dingtalk-schedule.ps1:
#   S4U task, no interactive login required; auto-retries transient failures.
# Shares the warehouse-sync.lock, so it never collides with the 11:00 / 18:00 full sync.
# NOTE: keep this file pure ASCII. PowerShell 5.1 reads .ps1 as ANSI/GBK; UTF-8
# multi-byte characters can swallow the trailing newline and break tokenization.

$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $projectRoot "scripts\sync-jushuitan-export.mjs"
$nodePath = (Get-Command node -ErrorAction Stop).Source
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument ('"{0}"' -f $scriptPath) `
  -WorkingDirectory $projectRoot

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

# Single run well under 5 min (incremental sync <5s + export ~35s in practice).
# 15-min execution limit is a safety cap, not a deadline.
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
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
  -Description "Ecom AI Studio 9:45 daily export of the 15-Jushuitan-Product query to the local daily-data Excel (48 cols incl. Python derived). Atomic overwrite: sync-fail-no-write, crash-keeps-old-file. Health: local-data/runtime/jushuitan-export-health.json" `
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
  RestartInterval = $task.Settings.RestartInterval
}
