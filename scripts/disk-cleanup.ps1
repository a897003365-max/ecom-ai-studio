# C Drive Cleanup Script - Phased Execution
# Usage: powershell -ExecutionPolicy Bypass -File scripts\disk-cleanup.ps1 [-Phase 1|2|3|4] [-All] [-DryRun]
# Default: Phase 1 only (safe cleanup)

param(
    [int]$Phase = 1,
    [switch]$All,
    [switch]$DryRun
)

$ErrorActionPreference = "SilentlyContinue"
$logFile = "C:\Users\Administrator\disk-cleanup-$(Get-Date -Format 'yyyy-MM-dd-HHmmss').log"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] [$Level] $Message"
    Write-Host $line
    Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue
}

function Get-DirSize {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return 0 }
    $size = (Get-ChildItem -Path $Path -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
    if ($null -eq $size) { return 0 }
    return [math]::Round($size / 1GB, 2)
}

function Get-DiskFree {
    $disk = Get-WmiObject Win32_LogicalDisk -Filter "DeviceID='C:'"
    return [math]::Round($disk.FreeSpace / 1GB, 2)
}

function Clean-Directory {
    param(
        [string]$Path,
        [string]$Name
    )
    if (-not (Test-Path $Path)) {
        Write-Log "$Name : directory not found, skipping"
        return 0
    }
    $beforeSize = Get-DirSize $Path
    Write-Log "$Name : before $beforeSize GB"
    if ($DryRun) {
        Write-Log "$Name : [DRY-RUN] skipping deletion" "WARN"
        return $beforeSize
    }
    try {
        Get-ChildItem -Path $Path -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Log "$Name : error during cleanup - $_" "WARN"
    }
    $afterSize = Get-DirSize $Path
    $freed = [math]::Round($beforeSize - $afterSize, 2)
    Write-Log "$Name : after $afterSize GB, freed $freed GB"
    return $freed
}

# ============================================
# Init
# ============================================
Write-Log "========================================"
Write-Log "C Drive Cleanup Script Started"
if ($DryRun) { $modeStr = "DRY-RUN" } else { $modeStr = "LIVE" }
if ($All) { $phaseStr = "ALL" } else { $phaseStr = "$Phase" }
Write-Log "Mode: $modeStr"
Write-Log "Phase: $phaseStr"
Write-Log "========================================"

$freeBefore = Get-DiskFree
Write-Log "Free space before cleanup: $freeBefore GB"
Write-Log ""

$totalFreed = 0

# ============================================
# Phase 1: Safe Cleanup (Low Risk)
# ============================================
if ($All -or $Phase -eq 1) {
    Write-Log "========== Phase 1: Safe Cleanup =========="

    # 1. User Temp
    $tempPath = $env:TEMP
    $freed = Clean-Directory $tempPath "User Temp ($tempPath)"
    $totalFreed += $freed

    # 2. Windows Temp
    $freed = Clean-Directory "C:\Windows\Temp" "Windows Temp"
    $totalFreed += $freed

    # 3. Windows Update Cache
    $freed = Clean-Directory "C:\Windows\SoftwareDistribution\Download" "Windows Update Cache"
    $totalFreed += $freed

    # 4. Recycle Bin
    Write-Log "Recycle Bin: clearing..."
    if (-not $DryRun) {
        try {
            Clear-RecycleBin -Force -ErrorAction SilentlyContinue
            Write-Log "Recycle Bin: cleared"
        } catch {
            Write-Log "Recycle Bin: error - $_" "WARN"
        }
    } else {
        Write-Log "Recycle Bin: [DRY-RUN] skipping" "WARN"
    }

    # 5. Chrome Cache
    $chromeCachePath = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Cache"
    $chromeCodeCachePath = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Code Cache"
    $freed = Clean-Directory $chromeCachePath "Chrome Cache"
    $totalFreed += $freed
    $freed = Clean-Directory $chromeCodeCachePath "Chrome Code Cache"
    $totalFreed += $freed

    # 6. npm cache
    Write-Log "npm cache: cleaning..."
    if (-not $DryRun) {
        $npmCacheBefore = Get-DirSize "$env:LOCALAPPDATA\npm-cache"
        Write-Log "npm cache: before $npmCacheBefore GB"
        & npm cache clean --force 2>&1 | Out-Null
        $npmCacheAfter = Get-DirSize "$env:LOCALAPPDATA\npm-cache"
        $npmFreed = [math]::Round($npmCacheBefore - $npmCacheAfter, 2)
        Write-Log "npm cache: after $npmCacheAfter GB, freed $npmFreed GB"
        $totalFreed += $npmFreed
    } else {
        Write-Log "npm cache: [DRY-RUN] skipping" "WARN"
    }

    # 7. pip cache
    $pipCachePath = "$env:LOCALAPPDATA\pip\cache"
    $freed = Clean-Directory $pipCachePath "pip cache"
    $totalFreed += $freed

    # 8. Cline temp logs
    $clineTemp = "$env:LOCALAPPDATA\Temp\cline"
    $freed = Clean-Directory $clineTemp "Cline temp logs"
    $totalFreed += $freed

    # 9. Windows Prefetch
    $freed = Clean-Directory "C:\Windows\Prefetch" "Windows Prefetch"
    $totalFreed += $freed

    # 10. Windows Logs
    $freed = Clean-Directory "C:\Windows\Logs" "Windows Logs"
    $totalFreed += $freed

    Write-Log "Phase 1 complete: freed $totalFreed GB"
    Write-Log ""
}

# ============================================
# Phase 2: App Cache Cleanup (Medium Risk)
# ============================================
if ($All -or $Phase -eq 2) {
    Write-Log "========== Phase 2: App Cache Cleanup =========="
    Write-Log "Note: close related apps first"

    # WPS/Kingsoft cache
    $wpsCachePaths = @(
        "$env:APPDATA\kingsoft\office6\backup",
        "$env:APPDATA\kingsoft\office6\autosave",
        "$env:LOCALAPPDATA\Kingsoft\WPS\backup"
    )
    foreach ($p in $wpsCachePaths) {
        $freed = Clean-Directory $p "WPS cache ($p)"
        $totalFreed += $freed
    }

    # Feishu/Lark cache
    $larkCachePaths = @(
        "$env:APPDATA\LarkShell\cache",
        "$env:APPDATA\LarkShell\cef_cache",
        "$env:LOCALAPPDATA\Feishu\cache"
    )
    foreach ($p in $larkCachePaths) {
        $freed = Clean-Directory $p "Feishu cache ($p)"
        $totalFreed += $freed
    }

    # WeChat/QQ cache
    $tencentCachePaths = @(
        "$env:APPDATA\Tencent\WeChat\Files",
        "$env:APPDATA\Tencent\QQ\cache"
    )
    foreach ($p in $tencentCachePaths) {
        $freed = Clean-Directory $p "Tencent cache ($p)"
        $totalFreed += $freed
    }

    # DingTalk cache and update packages
    $dingtalkPaths = @(
        "$env:LOCALAPPDATA\Temp\DingTalkUpdate_*",
        "$env:APPDATA\DingTalk\cache"
    )
    foreach ($p in $dingtalkPaths) {
        $freed = Clean-Directory $p "DingTalk cache ($p)"
        $totalFreed += $freed
    }

    # ShadowBot cache
    $freed = Clean-Directory "$env:LOCALAPPDATA\ShadowBot\cache" "ShadowBot cache"
    $totalFreed += $freed

    # BaiduNetdisk cache
    $freed = Clean-Directory "$env:APPDATA\BaiduNetdisk\cache" "BaiduNetdisk cache"
    $totalFreed += $freed

    # VS Code cache
    $vscodeCachePaths = @(
        "$env:APPDATA\Code\Cache",
        "$env:APPDATA\Code\CachedData",
        "$env:APPDATA\Code\Code Cache",
        "$env:APPDATA\Code\GPUCache"
    )
    foreach ($p in $vscodeCachePaths) {
        $freed = Clean-Directory $p "VS Code cache ($p)"
        $totalFreed += $freed
    }

    # WorkBuddy update package
    $freed = Clean-Directory "$env:LOCALAPPDATA\Temp\workbuddy-update-x64" "WorkBuddy update"
    $totalFreed += $freed

    Write-Log "Phase 2 complete: total freed $totalFreed GB"
    Write-Log ""
}

# ============================================
# Phase 3: AI/Dev Tool Cache (Medium Risk)
# ============================================
if ($All -or $Phase -eq 3) {
    Write-Log "========== Phase 3: AI/Dev Tool Cache Cleanup =========="

    # Huggingface model cache
    $freed = Clean-Directory "$env:USERPROFILE\.cache\huggingface" "Huggingface model cache"
    $totalFreed += $freed

    # ms-playwright browsers
    $freed = Clean-Directory "$env:LOCALAPPDATA\ms-playwright" "Playwright browsers"
    $totalFreed += $freed

    # codex-runtimes
    $freed = Clean-Directory "$env:USERPROFILE\.cache\codex-runtimes" "Codex Runtimes"
    $totalFreed += $freed

    # .codex cache
    $freed = Clean-Directory "$env:USERPROFILE\.codex\cache" "Codex cache"
    $totalFreed += $freed

    # .claude cache
    $freed = Clean-Directory "$env:USERPROFILE\.claude\cache" "Claude cache"
    $totalFreed += $freed

    # .workbuddy cache
    $freed = Clean-Directory "$env:USERPROFILE\.workbuddy\cache" "WorkBuddy cache"
    $totalFreed += $freed

    # .paddlex cache
    $freed = Clean-Directory "$env:USERPROFILE\.paddlex" "PaddleX cache"
    $totalFreed += $freed

    Write-Log "Phase 3 complete: total freed $totalFreed GB"
    Write-Log ""
}

# ============================================
# Phase 4: System Optimization (Higher Risk)
# ============================================
if ($All -or $Phase -eq 4) {
    Write-Log "========== Phase 4: System Optimization =========="

    # DISM component store cleanup
    Write-Log "DISM component store cleanup: running..."
    if (-not $DryRun) {
        $dismBefore = Get-DirSize "C:\Windows\WinSxS"
        Write-Log "WinSxS before: $dismBefore GB"
        & Dism.exe /Online /Cleanup-Image /StartComponentCleanup /ResetBase 2>&1 | ForEach-Object { Write-Log "DISM: $_" }
        $dismAfter = Get-DirSize "C:\Windows\WinSxS"
        $dismFreed = [math]::Round($dismBefore - $dismAfter, 2)
        Write-Log "WinSxS after: $dismAfter GB, freed $dismFreed GB"
        $totalFreed += $dismFreed
    } else {
        Write-Log "DISM: [DRY-RUN] skipping" "WARN"
    }

    # Windows Installer orphaned patches
    Write-Log "Windows Installer: checking orphaned patches..."
    if (-not $DryRun) {
        $installerPath = "C:\Windows\Installer"
        $instBefore = Get-DirSize $installerPath
        Write-Log "Windows Installer before: $instBefore GB"
        Write-Log "Windows Installer: use PatchCleaner tool for manual cleanup"
    } else {
        Write-Log "Windows Installer: [DRY-RUN] skipping" "WARN"
    }

    # Package Cache
    $freed = Clean-Directory "C:\ProgramData\Package Cache" "Package Cache"
    $totalFreed += $freed

    Write-Log "Phase 4 complete: total freed $totalFreed GB"
    Write-Log ""
}

# ============================================
# Summary
# ============================================
$freeAfter = Get-DiskFree
$freeDelta = [math]::Round($freeAfter - $freeBefore, 2)

Write-Log "========================================"
Write-Log "Cleanup Complete!"
Write-Log "========================================"
Write-Log "Free space before: $freeBefore GB"
Write-Log "Free space after: $freeAfter GB"
Write-Log "Actually freed: $freeDelta GB"
Write-Log "Script total freed: $totalFreed GB"
Write-Log "Log file: $logFile"
Write-Log "========================================"

# JSON summary
if ($All) { $phaseVal = "all" } else { $phaseVal = "$Phase" }
$summary = @{
    beforeGB = $freeBefore
    afterGB = $freeAfter
    freedGB = $freeDelta
    scriptFreedGB = $totalFreed
    logFile = $logFile
    timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    phase = $phaseVal
    dryRun = $DryRun.IsPresent
}
Write-Host ""
Write-Host "=== JSON SUMMARY ==="
Write-Host ($summary | ConvertTo-Json -Compress)