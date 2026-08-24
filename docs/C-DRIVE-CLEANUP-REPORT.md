# C Drive Cleanup Report

> Date: 2026-08-03
> Executed by: disk-cleanup.ps1 (4 phases)

## Summary

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Total Capacity | 200 GB | 200 GB | - |
| Used Space | 153.68 GB | 121.41 GB | -32.28 GB |
| Free Space | 46.32 GB | 78.60 GB | +32.28 GB |
| Free % | 23.2% | 39.3% | +16.1% |

## Phase Results

### Phase 1: Safe Cleanup (Low Risk)

| Item | Freed |
|------|-------|
| User Temp | 11.25 GB |
| Windows Temp | 0.56 GB |
| Windows Update Cache | 0.89 GB |
| Recycle Bin | ~0.17 GB |
| Chrome Cache | 0.27 GB |
| Chrome Code Cache | 0.36 GB |
| npm cache | 0.88 GB |
| pip cache | 0.04 GB |
| Windows Logs | 0.07 GB |
| **Phase 1 Total** | **14.34 GB** |

### Phase 2: App Cache Cleanup (Medium Risk)

| Item | Freed |
|------|-------|
| WPS/Kingsoft backup cache | 8.34 GB |
| ShadowBot cache | 0.44 GB |
| BaiduNetdisk cache | 0.43 GB |
| VS Code cache | 0.01 GB |
| **Phase 2 Total** | **9.22 GB** |

Note: Feishu, Tencent, DingTalk cache directories were not found at expected paths.

### Phase 3: AI/Dev Tool Cache (Medium Risk)

| Item | Freed |
|------|-------|
| Huggingface model cache | 4.84 GB |
| Playwright browsers | 0.68 GB |
| Codex Runtimes | 1.00 GB |
| Codex cache | 0.01 GB |
| PaddleX cache | 0.20 GB |
| **Phase 3 Total** | **6.78 GB** |

### Phase 4: System Optimization (Higher Risk)

| Item | Freed |
|------|-------|
| DISM WinSxS cleanup | 0.03 GB |
| Package Cache | 1.84 GB |
| Windows Installer | 0 GB (manual cleanup recommended) |
| **Phase 4 Total** | **1.94 GB** |

## Grand Total

| Phase | Freed |
|-------|-------|
| Phase 1: Safe Cleanup | 14.34 GB |
| Phase 2: App Cache | 9.22 GB |
| Phase 3: AI/Dev Tools | 6.78 GB |
| Phase 4: System Optimization | 1.94 GB |
| **Total** | **32.28 GB** |

## Preventive Measures Configured

### Cache Directory Migration to D Drive

| Cache | Old Location (C:) | New Location (D:) |
|-------|-------------------|-------------------|
| npm | `%LOCALAPPDATA%\npm-cache` | `D:\npm-cache` |
| Huggingface | `%USERPROFILE%\.cache\huggingface` | `D:\huggingface` (HF_HOME) |
| pip | `%LOCALAPPDATA%\pip\cache` | `D:\pip-cache` (PIP_CACHE_DIR) |

### Weekly Maintenance Task

- **Task Name**: `C-Drive-Weekly-Cleanup`
- **Schedule**: Every Sunday at 3:00 AM
- **Script**: `scripts/disk-cleanup-maintenance.ps1`
- **Scope**: Safe cleanup only (Temp, Windows Temp, Update Cache, Recycle Bin, Chrome Cache, npm cache, pip cache, Windows Logs)
- **Log**: `C:\Users\Administrator\disk-cleanup-maintenance.log`

## Remaining Cleanup Opportunities (Manual)

### Phase 5: Data Migration (User Decision Required)

| Item | Current Size | Action |
|------|-------------|--------|
| Documents | ~3.46 GB | Review and move large files to D drive |
| Power BI Desktop Store App | ~6.74 GB | Consider moving data to D drive |
| WPS Cloud Files | ~1.09 GB | Review and move to D drive |
| Downloads | ~0.73 GB | Review and delete/move old files |
| .codex | ~1.60 GB | Review if still needed |
| .vscode extensions | ~1.56 GB | Review and remove unused extensions |
| .workbuddy | ~1.01 GB | Review if still needed |
| .claude | ~0.68 GB | Review if still needed |

### Windows Installer Orphaned Patches

- **Current Size**: 1.16 GB
- **Tool**: Use [PatchCleaner](https://www.homedev.com.au/free/patchcleaner) to safely remove orphaned MSI/MSP files
- **Estimated Recovery**: ~0.5-0.8 GB

### Spyder-6 (ProgramData)

- **Current Size**: 3.99 GB
- **Action**: If Spyder is not used, uninstall to recover space
- **Estimated Recovery**: ~3.99 GB

## Scripts Created

| Script | Purpose |
|--------|---------|
| `scripts/disk-cleanup.ps1` | Main cleanup script (4 phases, supports -Phase and -All flags) |
| `scripts/disk-cleanup-maintenance.ps1` | Weekly maintenance script (safe cleanup only) |

## Usage

### Run full cleanup (all phases)
```powershell
powershell -ExecutionPolicy Bypass -File scripts\disk-cleanup.ps1 -All
```

### Run specific phase
```powershell
powershell -ExecutionPolicy Bypass -File scripts\disk-cleanup.ps1 -Phase 1
```

### Dry run (preview without deleting)
```powershell
powershell -ExecutionPolicy Bypass -File scripts\disk-cleanup.ps1 -Phase 1 -DryRun
```

### Check scheduled task status
```powershell
Get-ScheduledTask -TaskName 'C-Drive-Weekly-Cleanup'
```

### Check maintenance log
```powershell
Get-Content C:\Users\Administrator\disk-cleanup-maintenance.log -Tail 50