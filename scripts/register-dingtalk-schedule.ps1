param(
  [string]$TaskName = "EcomAIStudio-DingTalk-Sync",
  [string[]]$Times
)

$ErrorActionPreference = "Stop"

# Read DINGTALK_SYNC_TIMES from the registry by default so the scheduled task
# stays in sync with dingtalk-api.mjs scheduleTimes() (the single source of truth).
if (-not $Times) {
  $envValue = $null
  try {
    $envValue = (Get-ItemProperty -Path 'HKCU:\Environment' -Name DINGTALK_SYNC_TIMES -ErrorAction Stop).DINGTALK_SYNC_TIMES
  } catch {
    $envValue = $null
  }
  if ($envValue) {
    $Times = $envValue -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  } else {
    $Times = @("10:30", "13:00", "17:30")
  }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $PSScriptRoot "sync-dingtalk.mjs"
$nodePath = (Get-Command node -ErrorAction Stop).Source
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument ('"{0}"' -f $scriptPath) `
  -WorkingDirectory $projectRoot

$triggers = foreach ($time in $Times) {
  New-ScheduledTaskTrigger -Daily -At $time
}

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
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
  -Trigger $triggers `
  -Principal $principal `
  -Settings $settings `
  -Description "Ecom AI Studio DingTalk read-only sync to local sanitized snapshots, three times daily; runs without interactive login and restarts transient failures." `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
[PSCustomObject]@{
  TaskName = $task.TaskName
  State = $task.State
  TriggerCount = @($task.Triggers).Count
  Times = ($Times -join ",")
  Script = $scriptPath
  UserId = $userId
  LogonType = $task.Principal.LogonType
  RestartCount = $task.Settings.RestartCount
  RestartInterval = $task.Settings.RestartInterval
  RunOnlyIfNetworkAvailable = $task.Settings.RunOnlyIfNetworkAvailable
}
