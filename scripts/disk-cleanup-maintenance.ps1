# C Drive Maintenance Script - for scheduled execution
# This script performs safe cleanup only (equivalent to Phase 1)
# Schedule: run weekly via Windows Task Scheduler
# Usage: powershell -ExecutionPolicy Bypass -File scripts\disk-cleanup-maintenance.ps1

$ErrorActionPreference = "SilentlyContinue"
$logFile = "C:\Users\Administrator\disk-cleanup-maintenance.log"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] $Message"
    Write-Output $line
    Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue
}

function Get-DiskFree {
    $disk = Get-WmiObject Win32_LogicalDisk -Filter "DeviceID='C:'"
    return [math]::Round($disk.FreeSpace / 1GB, 2)
}

function Get-DirSize {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return 0 }
    $size = (Get-ChildItem -Path $Path -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
    if ($null -eq $size) { return 0 }
    return [math]::Round($size / 1GB, 2)
}

function Clean-Dir {
    param([string]$Path, [string]$Name)
    if (-not (Test-Path $Path)) { return 0 }
    $before = Get-DirSize $Path
    Get-ChildItem -Path $Path -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    $after = Get-DirSize $Path
    $freed = [math]::Round($before - $after, 2)
    Write-Log "  $Name : freed $freed GB"
    return $freed
}

# ============================================
# Main
# ============================================
Write-Log "=== Weekly Maintenance Started ==="
$freeBefore = Get-DiskFree
Write-Log "Free space before: $freeBefore GB"

$totalFreed = 0

# 1. User Temp
$totalFreed += Clean-Dir $env:TEMP "User Temp"

# 2. Windows Temp
$totalFreed += Clean-Dir "C:\Windows\Temp" "Windows Temp"

# 3. Windows Update Cache
$totalFreed += Clean-Dir "C:\Windows\SoftwareDistribution\Download" "Windows Update Cache"

# 4. Recycle Bin
try {
    Clear-RecycleBin -Force -ErrorAction SilentlyContinue
    Write-Log "  Recycle Bin: cleared"
} catch {
    Write-Log "  Recycle Bin: error"
}

# 5. Chrome Cache
$totalFreed += Clean-Dir "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Cache" "Chrome Cache"
$totalFreed += Clean-Dir "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Code Cache" "Chrome Code Cache"

# 6. npm cache
$npmBefore = Get-DirSize "$env:LOCALAPPDATA\npm-cache"
& npm cache clean --force 2>&1 | Out-Null
$npmAfter = Get-DirSize "$env:LOCALAPPDATA\npm-cache"
$npmFreed = [math]::Round($npmBefore - $npmAfter, 2)
Write-Log "  npm cache: freed $npmFreed GB"
$totalFreed += $npmFreed

# 7. pip cache
$totalFreed += Clean-Dir "$env:LOCALAPPDATA\pip\cache" "pip cache"

# 8. Windows Logs
$totalFreed += Clean-Dir "C:\Windows\Logs" "Windows Logs"

$freeAfter = Get-DiskFree
$freeDelta = [math]::Round($freeAfter - $freeBefore, 2)

Write-Log "Total freed: $totalFreed GB"
Write-Log "Free space after: $freeAfter GB"
Write-Log "Actually freed: $freeDelta GB"
Write-Log "=== Maintenance Complete ==="
Write-Log ""