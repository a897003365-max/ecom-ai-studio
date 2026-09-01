param(
  [string]$TaskName = "EcomAIStudio-Tailscale-Server"
)

$ErrorActionPreference = "Stop"

# 开机(登录时)自启动 Tailscale 私域生产服务器。
# 经 start-tailscale-server.ps1 设置 HOST/PORT 环境变量并跑 node --production;
# 参照 register-devserver-schedule.ps1 的 S4U 无人值守 + 失败自动重启模式。

$projectRoot = Split-Path -Parent $PSScriptRoot
$launcher    = Join-Path $projectRoot "scripts\start-tailscale-server.ps1"
$pwshPath    = (Get-Command powershell.exe -ErrorAction Stop).Source
$userId      = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
  -Execute $pwshPath `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $launcher) `
  -WorkingDirectory $projectRoot

# 登录时启动
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId

# 常驻服务:无执行时长上限(0),失败自动重启,掉电不停。
# 注意:启动器内部还有崩溃自愈循环,此处是兜底(powershell 进程本身异常退出时)。
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

# S4U:后台会话运行,不绑定交互式控制台窗口,关终端/资源管理器不会终止服务。
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
  -Description "Ecom AI Studio Tailscale private production server (http://100.113.194.123:5174); starts at logon, restarts transient failures." `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
[PSCustomObject]@{
  TaskName  = $task.TaskName
  State     = $task.State
  Trigger   = "AtLogOn"
  Launcher  = $launcher
  UserId    = $userId
  LogonType = $task.Principal.LogonType
}
