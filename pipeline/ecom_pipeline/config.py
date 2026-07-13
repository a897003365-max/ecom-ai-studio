from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class WarehousePaths:
    project_root: Path
    manifest: Path
    warehouse_root: Path
    staging_root: Path
    marts_root: Path
    state_file: Path
    database: Path
    snapshot: Path

    @classmethod
    def discover(cls) -> "WarehousePaths":
        project_root = Path(__file__).resolve().parents[2]
        warehouse_root = project_root / "local-data" / "warehouse"
        return cls(
            project_root=project_root,
            manifest=project_root / "migration" / "power-query-m" / "manifest.json",
            warehouse_root=warehouse_root,
            staging_root=warehouse_root / "staging",
            marts_root=warehouse_root / "marts",
            state_file=warehouse_root / "state.json",
            database=warehouse_root / "ecom.duckdb",
            snapshot=warehouse_root / "analytics-snapshot.json",
        )

    def ensure(self) -> None:
        for path in (self.warehouse_root, self.staging_root, self.marts_root):
            path.mkdir(parents=True, exist_ok=True)


def configured_data_root() -> Path:
    return Path(os.environ.get("ECOM_DATA_ROOT", r"D:\麻大师\日更数据"))
