param(
  [switch]$Rebuild   # 改代码后手动重建: .\scripts\start-tailscale-server.ps1 -Rebuild
)

$ErrorActionPreference = "Continue"

# ================= 配置 =================
$ProjectDir  = Split-Path -Parent $PSScriptRoot
$TailnetIP   = "100.113.194.123"
$Port        = "5174"
$LogDir      = Join-Path $ProjectDir "logs"
$LogFile     = Join-Path $LogDir "tailscale-server.log"
$nodePath    = (Get-Command node -ErrorAction Stop).Source

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# 私域生产模式环境变量。
# 免登录: AUTH_ENFORCEMENT_ENABLED="0"; 要强制登录改为 "1"(每人建账号后登录)。
$env:HOST = $TailnetIP
$env:PORT = $Port
$env:AUTH_ENFORCEMENT_ENABLED = "0"

Set-Location $ProjectDir

function Write-Log($msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# 构建:显式 -Rebuild,或 dist/ 缺失时自动构建
if ($Rebuild -or -not (Test-Path (Join-Path $ProjectDir "dist\index.html"))) {
  Write-Log "[构建] npm run build ..."
  & npm run build | Out-Host
  if ($LASTEXITCODE -ne 0) { Write-Log "[错误] 构建失败,退出"; exit 1 }
}

Write-Log "启动 Tailscale 私域服务 http://${TailnetIP}:${Port} (production)"
Write-Log "日志: $LogFile   (改代码后运行 .\scripts\start-tailscale-server.ps1 -Rebuild 生效)"

# 常驻循环:进程崩溃/退出后 5 秒自动重启
while ($true) {
  Write-Log "--- node server/index.mjs --production 启动 ---"
  & $nodePath server/index.mjs --production 2>&1 | ForEach-Object { Write-Log $_ }
  Write-Log "--- 服务停止,5 秒后自动重启 ---"
  Start-Sleep -Seconds 5
}
