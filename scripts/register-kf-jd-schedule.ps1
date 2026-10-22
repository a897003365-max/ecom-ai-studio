param(
  [string]$TaskName = "EcomAIStudio-KfJdWorkload",
  [string]$Time = "09:50"
)

$ErrorActionPreference = "Stop"

# Daily 09:50 schedule: check JD self-operated store (madashi) customer-service
# workload data on kf.jd.com for a T-1 gap; if the latest day is missing locally,
# download it immediately. Same S4U pattern as register-jushuitan-export-schedule.ps1.
#
# PRECONDITION: the logged-in Chrome for the JD-self-operated account must be
# running with CDP port 9224:
#   chrome.exe --remote-debugging-port=9224 --user-data-dir=E:\影刀平替项目\.chrome-automation-jdzy
# The sync script falls back to launching it, but an interactive desktop session
# is required for the login session to be available.
#
# NOTE: keep this file pure ASCII. PowerShell 5.1 reads .ps1 as ANSI/GBK.

$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $projectRoot "scripts\kf-jd-workload-sync.mjs"
$nodePath = (Get-Command node -ErrorAction Stop).Source
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$logPath = Join-Path $env:SystemRoot "Temp\ecom-kf-jd-task.log"
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
# reach the UNC project share AND the same-session Chrome CDP (127.0.0.1:9224).
# S4U runs without user-dir access to the network share, so Interactive is used.
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
  -Description "Ecom AI Studio 09:50 daily: check kf.jd.com (JD self-operated) customer-service workload for T-1 gap and backfill download. Health: local-data/runtime/kf-jd-workload-health.json" `
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