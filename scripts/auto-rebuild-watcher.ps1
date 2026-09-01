#Requires -Version 5.1
<#
.SYNOPSIS
  监听真源码 src/server 变化，自动 npm run build + 重启 5174 私域生产服务。

  配合 Tailscale drive：其他 agent 通过共享镜像改源码（junction 实时回写真源码），
  本监听器在真源码目录检测到变更 -> debounce -> npm run build -> 杀 5174 node，
  由 scripts/start-tailscale-server.ps1 的看门狗 5 秒拉起新 dist。

  实现：同步 Poll + FileSystemWatcher.WaitForChanged（同一线程、无 runspace
  跨线程变量捕获问题），每次事件后先排空事件风暴时段再进入 debounce 静默计时。

.USAGE
  # 前台跑（Ctrl+C 停）：
  .\scripts\auto-rebuild-watcher.ps1
  # 后台常驻（隐藏窗口，进程保活）：
  Start-Process powershell -ArgumentList '-ExecutionPolicy','Bypass','-File',(
    'E:\Github\ecom-ai-studio\scripts\auto-rebuild-watcher.ps1') -WindowStyle Hidden
  # 加/停计划任务（登录自启保活）：
  schtasks /Create /TN auto-rebuild-watcher /TR "powershell -ExecutionPolicy Bypass -File E:\Github\ecom-ai-studio\scripts\auto-rebuild-watcher.ps1" /SC ONLOGON /RL HIGHEST /F

  构建失败不会杀服务（旧 dist 继续服务），记日志等下次变更重试。
#>
param(
  [int]$DebounceMs = 2000,
  [int]$Port = 5174
)

$ErrorActionPreference = "Continue"
$ProjectDir = Split-Path -Parent $PSScriptRoot
$LogDir    = Join-Path $ProjectDir "logs"
$LogFile   = Join-Path $LogDir "auto-rebuild.log"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log($msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Invoke-Rebuild {
  Set-Location $ProjectDir
  Write-Log "[构建] npm run build ..."
  & npm run build 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) {
    Write-Log "[跳过重启] 构建失败(exit $LASTEXITCODE)，保留旧 dist 继续服务"
    return
  }
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
      Write-Log "[重启] 终止 5174 监听进程 PID $($conn.OwningProcess)，等待看门狗拉起..."
      Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    } else {
      Write-Log "[重启] 未在 5174 找到监听进程（服务未运行？），跳过"
    }
  } catch {
    Write-Log "[警告] 定位/终止 5174 进程失败: $_"
  }
  Write-Log "[完成] 已触发，看门狗（~5s）将用新 dist 拉起"
}

# 监听根：build 读取的源码（agent 经镜像 junction 写到的就是这两处）
$WatchRoots = @((Join-Path $ProjectDir "src"), (Join-Path $ProjectDir "server"))

Write-Log "== auto-rebuild-watcher 启动 =="
Write-Log ("监听: {0}; debounce {1}ms; port {2}" -f ($WatchRoots -join ", "), $DebounceMs, $Port)

$watchers = @()
foreach ($root in $WatchRoots) {
  if (-not (Test-Path $root)) { Write-Log "[警告] 监听根不存在: $root"; continue }
  $fsw = New-Object System.IO.FileSystemWatcher
  $fsw.Path = $root
  $fsw.IncludeSubdirectories = $true
  $fsw.NotifyFilter = [System.IO.NotifyFilters]'LastWrite,FileName,Size,DirectoryName'
  $fsw.EnableRaisingEvents = $true
  $watchers += $fsw
  Write-Log ("  watching {0}" -f $root)
}
if ($watchers.Count -eq 0) { Write-Log "[错误] 无可用监听根，退出"; exit 1 }

# 同步轮询：一趟 250ms 内检查所有 watcher；命中先排空事件风暴，再进入 debounce
$idleSince = Get-Date
$changed   = $false

while ($true) {
  foreach ($fsw in $watchers) {
    $res = $fsw.WaitForChanged('All', 250)      # 最多阻塞 250ms；超时 TimedOut=true
    if ($res.TimedOut) { continue }
    $changed = $true
    # 排空紧随其后的批量事件（保存=多条写入/重命名），让静默计时从最后一条算起
    $flush = $fsw.WaitForChanged('All', 50)
    while (-not $flush.TimedOut) { $flush = $fsw.WaitForChanged('All', 50) }
    $idleSince = Get-Date
    break
  }
  if ($changed -and ((Get-Date) - $idleSince).TotalMilliseconds -ge $DebounceMs) {
    $changed = $false
    Invoke-Rebuild
  }
  Start-Sleep -Milliseconds 100
}