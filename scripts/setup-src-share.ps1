#Requires -Version 5.1
<#
.SYNOPSIS
  创建「只含源码」的 Taildrive 共享镜像目录 E:\ecom-ai-studio-share。

  原因：Tailscale drive 共享的是整个目录路径、没有文件过滤。为兑现「只共享源码
  （不含 .env / node_modules / local-data / 业务数据）」，这里把真源码做成一个
  纯源码镜像：
    - 子目录  -> junction (mklink /J)，指向真源码子目录；增/改/删实时双向同步
    - 根配置  -> 硬链接 (mklink /H)，接在镜像根部
  镜像本身不包含 .env、node_modules、dist、local-data、*.png、agent_data 等。

.USAGE
  .\scripts\setup-src-share.ps1                     # 默认 E:\ecom-ai-studio-share
  .\scripts\setup-src-share.ps1 -MirrorPath E:\x    # 自定义镜像路径
#>
param(
  [string]$MirrorPath = "E:\ecom-ai-studio-share"
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot

# 共享的子目录（junction 目标必须真实存在）
$ShareSubdirs = @("src", "server", "migration", "scripts", "docs", "pipeline")
# 根级配置/文档（硬链接进镜像）
$ShareFiles = @(
  "package.json", "package-lock.json", "tsconfig.json",
  "vite.config.ts", "tailwind.config.cjs", "postcss.config.cjs",
  "index.html", "AGENTS.md", "README.md", "DESIGN.md"
)

function Write-Step($msg) { Write-Host "[setup] $msg" -ForegroundColor Cyan }

Write-Step "镜像路径: $MirrorPath"

# --- 清空旧镜像（若已存在） ---
if (Test-Path $MirrorPath) {
  Write-Step "清空旧镜像 $MirrorPath ..."
  if (Test-Path $MirrorPath) {
    # 删除 junction/子项：用 Remove-Item -Force -Recurse 对 junction 只删链接本身
    Get-ChildItem -Path $MirrorPath -Force | ForEach-Object {
      Remove-Item -Path $_.FullName -Force -Recurse -ErrorAction SilentlyContinue
    }
  }
} else {
  New-Item -ItemType Directory -Force -Path $MirrorPath | Out-Null
}

# --- 子目录 junction ---
$failed = @()
foreach ($d in $ShareSubdirs) {
  $src  = Join-Path $ProjectDir $d
  $link = Join-Path $MirrorPath $d
  if (-not (Test-Path $src)) { Write-Warning "缺少源码目录 $d，跳过"; continue }
  if (-not (Test-Path $link)) {
    cmd /c mklink /J "`"$link`"" "`"$src`"" | Out-Null
  }
  if (Test-Path $link) { Write-Step "  junction  $d  ->  $src" } else { $failed += $d }
}

# --- 根配置硬链接 ---
foreach ($f in $ShareFiles) {
  $src  = Join-Path $ProjectDir $f
  $link = Join-Path $MirrorPath $f
  if (-not (Test-Path $src)) { Write-Warning "缺少根文件 $f，跳过"; continue }
  if (-not (Test-Path $link)) {
    cmd /c mklink /H "`"$link`"" "`"$src`"" | Out-Null
  }
  if (Test-Path $link) { Write-Step "  link     $f" } else { $failed += $f }
}

# --- 验证 & 汇总 ---
Write-Step "镜像内容："
Get-ChildItem $MirrorPath -Force | Select-Object Name, Mode | Format-Table -AutoSize

if ($failed.Count -gt 0) {
  Write-Host "[setup] 以下条目创建失败: $($failed -join ', ')" -ForegroundColor Red
  exit 1
}

Write-Step "完成。现在可（开好 drive:share 后）：
  tailscale drive share ecom_aistudio $MirrorPath
监听代码变更自动生效： .\scripts\auto-rebuild-watcher.ps1"