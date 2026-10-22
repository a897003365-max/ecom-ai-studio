#Requires -Version 5.1
<#
.SYNOPSIS
  监听真源码 src/server 变化，自动 npm run build + 重启 5174 私域生产服务。

  配合 Tailscale drive：其他 agent 通过共享镜像改源码（junction/symlink 实时回写真源码），
  本监听器在真源码目录检测到变更 -> debounce -> npm run build -> 杀 5174 node，
  由 scripts/start-tailscale-server.ps1 的看门狗 5 秒拉起新 dist。

  实现：Register-ObjectEvent 把 FileSystemWatcher 事件（Changed/Created/Deleted/
  Renamed/Error）排入 PowerShell 引擎队列，主循环单线程排空并重置静默计时，
  满 debounce 才构建一次。

  历史教训：
  - 同步 WaitForChanged 轮询在两次调用之间有监听盲区，单次快速写入
    （WebDAV PUT 落盘即完成）会整个漏掉（2026-09-06 21:48/21:55/21:59
    三次 PUT 均未触发的根因）。
  - add_Changed 脚本块 handler 由线程池线程执行，在 S4U 非交互会话下
    事件触发即进程退出（exit 5，2026-09-06 22:37），不可用。

  命名互斥锁保证单实例：重复启动（手动 + 计划任务并存）直接退出，
  避免多实例并发构建、重复杀服务（2026-08-28 曾出现一次构建重复 4 遍）。

.USAGE
  # 前台跑（Ctrl+C 停）：
  .\scripts\auto-rebuild-watcher.ps1
  # 注册/启动计划任务（开机自启、无需登录；任务名 EcomAIStudio-AutoRebuild-Watcher）：
  schtasks /Create /TN EcomAIStudio-AutoRebuild-Watcher /TR "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File E:\Github\ecom-ai-studio\scripts\auto-rebuild-watcher.ps1" /SC ONSTART /RU Administrator /NP /RL HIGHEST /F
  schtasks /Run /TN EcomAIStudio-AutoRebuild-Watcher

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

# 单实例：命名互斥锁，进程退出句柄即释放；已有实例时直接退出
$createdNew = $false
$script:instanceMutex = New-Object System.Threading.Mutex($true, "Global\EcomAIStudio-AutoRebuild-Watcher", ([ref]$createdNew))
if (-not $createdNew) {
  Write-Log "[退出] 已有 watcher 实例在运行，本实例退出"
  exit 0
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

# 监听根：build 读取的源码（agent 经镜像 symlink 写到的就是这两处）
$WatchRoots = @((Join-Path $ProjectDir "src"), (Join-Path $ProjectDir "server"))

Write-Log "== auto-rebuild-watcher 启动 =="
Write-Log ("监听: {0}; debounce {1}ms; port {2}" -f ($WatchRoots -join ", "), $DebounceMs, $Port)

$watchers = @()
$i = 0
foreach ($root in $WatchRoots) {
  if (-not (Test-Path $root)) { Write-Log "[警告] 监听根不存在: $root"; continue }
  $fsw = New-Object System.IO.FileSystemWatcher
  $fsw.Path = $root
  $fsw.IncludeSubdirectories = $true
  $fsw.NotifyFilter = [System.IO.NotifyFilters]'LastWrite,FileName,Size,DirectoryName'
  $fsw.InternalBufferSize = 65536
  foreach ($evName in @('Changed','Created','Deleted','Renamed','Error')) {
    Register-ObjectEvent -InputObject $fsw -EventName $evName -SourceIdentifier ("fsw{0}.{1}" -f $i, $evName) | Out-Null
  }
  $fsw.EnableRaisingEvents = $true
  $watchers += $fsw
  Write-Log ("  watching {0}" -f $root)
  $i++
}
if ($watchers.Count -eq 0) { Write-Log "[错误] 无可用监听根，退出"; exit 1 }

# 引擎队列单线程排空：无监听盲区，事件风暴期持续重置静默计时
$pending   = $false
$lastEvent = Get-Date
while ($true) {
  $queued = @(Get-Event -ErrorAction SilentlyContinue)
  if ($queued.Count -gt 0) {
    $queued | Remove-Event -ErrorAction SilentlyContinue
    $lastEvent = Get-Date
    $pending   = $true
  }
  if ($pending -and ((Get-Date) - $lastEvent).TotalMilliseconds -ge $DebounceMs) {
    $pending = $false
    Invoke-Rebuild
  }
  Start-Sleep -Milliseconds 200
}
