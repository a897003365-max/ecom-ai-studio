param(
  [string]$TaskName = "EcomAIStudio-KfPopDaily",
  [string]$Time = "09:50"
)

$ErrorActionPreference = "Stop"

# Daily 09:50 schedule: JD POP store customer-service T-1 full chain:
# query waiterDim per-agent data from kf.jd.com (via shop.jd.com POP session),
# archive raw JSON, generate JD-pop<date>.xlsx into the 88.28 warehouse source
# folder (\\192.168.88.28\...\10-2京东客服绩效明细\接待数据\), and let the existing
# EcomAIStudio-Warehouse-Sync task (11:00/18:00) ingest it. The monitor does NOT
# trigger the warehouse sync itself (avoids a second scheduler on one pipeline).
#
# PRECONDITION: the logged-in Chrome for the JD POP account must be running
# with CDP port 9222:
#   chrome.exe --remote-debugging-port=9222 --user-data-dir=E:\影刀平替项目\.chrome-automation-jdpop
# The sync script falls back to launching it, but an interactive desktop session
# is required for the login session to be available.
#
# NOTE: keep this file pure ASCII. PowerShell 5.1 reads .ps1 as ANSI/GBK.

$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $projectRoot "scripts\kf-pop-daily-sync.mjs"
$nodePath = (Get-Command node -ErrorAction Stop).Source
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$logPath = Join-Path $env:SystemRoot "Temp\ecom-kf-pop-task.log"
$action = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument ('/c ""{0}" "{1}" --monitor > "{2}" 2>&1"' -f $nodePath, $scriptPath, $logPath) `
  -WorkingDirectory $env:SystemRoot

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

# One-shot daily request that completes in seconds; 15-min cap is a safety net.
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

# Interactive (consistent with the always-on desktop session): the task must
# reach the UNC project share, write to the UNC warehouse source folder, AND
# the same-session Chrome CDP (127.0.0.1:9222). S4U runs without user-dir
# access to the network share, so Interactive is used.
$principal = New-ScheduledTaskPrincipal `
  -UserId $userId `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Ecom AI Studio 09:50 daily: JD POP customer-service T-1 chain (waiterDim query -> JD-pop xlsx into 88.28 warehouse source folder -> 11:00 warehouse sync ingests). Health: local-data/runtime/kf-pop-daily-health.json" `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
[PSCustomObject]@{
  TaskName = $task.TaskName
  State = $task.State
  Time = $Time
  Script = $scriptPath
  UserId = $userId
  LogonType = $task.Principal.LogonType
} | Format-List
