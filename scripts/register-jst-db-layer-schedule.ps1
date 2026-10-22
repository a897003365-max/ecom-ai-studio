param(
  [string]$TaskName = "EcomAIStudio-JstDbLayer"
)

$ErrorActionPreference = "Stop"

# Daily 08:30 (after mds jst_order_item_daily finishes its ~08:03 import):
# rebuild public.jst_order_item_web (48 cols) and public.jst_order_item_export (39 cols)
# in mds-postgres-1 from the database source (no 327MB Excel parsing).
# NOTE: keep this file pure ASCII. PowerShell 5.1 reads .ps1 as ANSI/GBK; UTF-8
# multi-byte characters can swallow the trailing newline and break tokenization.

$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $projectRoot "pipeline\sync.py"
$pythonPath = (Get-Command python -ErrorAction Stop).Source
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
  -Execute $pythonPath `
  -Argument ('"{0}" build-jst-db --refresh-aux' -f $scriptPath) `
  -WorkingDirectory $projectRoot

$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At "08:30")
)

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 10) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

$principal = New-ScheduledTaskPrincipal `
  -UserId $userId `
  -LogonType S4U `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Principal $principal `
  -Settings $settings `
  -Description "Daily 08:30 rebuild of mds-postgres-1 jst.order_item_web/export from public.jst_order_item_daily. Health: local-data/runtime/jst-db-layer-health.json" `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
[PSCustomObject]@{
  TaskName = $task.TaskName
  State = $task.State
  Triggers = ($task.Triggers | ForEach-Object { $_.StartBoundary }) -join ", "
  Script = $scriptPath
  Python = $pythonPath
  UserId = $userId
  LogonType = $task.Principal.LogonType
  ExecutionTimeLimit = $task.Settings.ExecutionTimeLimit
  RestartCount = $task.Settings.RestartCount
  RestartInterval = $task.Settings.RestartInterval
}
