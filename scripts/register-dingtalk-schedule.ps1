param(
  [string]$TaskName = "EcomAIStudio-DingTalk-Sync",
  [string[]]$Times = @("09:30", "12:30", "16:30", "21:30")
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $PSScriptRoot "sync-dingtalk.mjs"
$nodePath = (Get-Command node -ErrorAction Stop).Source

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
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Description "Ecom AI Studio DingTalk read-only sync to local sanitized snapshots, four times daily." `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
[PSCustomObject]@{
  TaskName = $task.TaskName
  State = $task.State
  TriggerCount = @($task.Triggers).Count
  Times = ($Times -join ",")
  Script = $scriptPath
}
