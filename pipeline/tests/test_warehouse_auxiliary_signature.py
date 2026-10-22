from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecom_pipeline.catalog import QuerySpec  # noqa: E402
from ecom_pipeline.config import WarehousePaths  # noqa: E402
from ecom_pipeline.warehouse import SyncOptions, _file_signature, _sync_query  # noqa: E402


def _query_spec(name: str) -> QuerySpec:
    return QuerySpec(
        index=26,
        name=name,
        m_file="",
        source_kind="folder",
        source_paths=(),
        sheet_name=None,
        promote_headers=True,
        schema=(),
        operations=(),
    )


class WarehouseAuxiliarySignatureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / "15-聚水潭商品数据" / "销售主题分析_明细订单商品.xlsx"
        self.source.parent.mkdir(parents=True)
        self.source.write_bytes(b"source")
        self.offline = self.root / "02-商品明细库存表" / "线下" / "2026-10-20.xlsx"
        self.offline.parent.mkdir(parents=True)
        self.offline.write_bytes(b"offline")
        self.erp = self.root / "商品信息文件" / "ERP店铺对照表.xlsx"
        self.erp.parent.mkdir(parents=True)
        self.erp.write_bytes(b"erp")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _touch(self, path: Path, offset_ns: int = 10_000_000_000) -> None:
        stat = path.stat()
        os.utime(path, ns=(stat.st_atime_ns + offset_ns, stat.st_mtime_ns + offset_ns))

    def test_signature_is_stable_when_auxiliary_files_do_not_change(self) -> None:
        spec = _query_spec("15-聚水潭商品数据")
        self.assertEqual(_file_signature(self.source, spec), _file_signature(self.source, spec))

    def test_offline_table_change_invalidates_signature(self) -> None:
        spec = _query_spec("15-聚水潭商品数据")
        before = _file_signature(self.source, spec)
        self._touch(self.offline)
        self.assertNotEqual(before, _file_signature(self.source, spec))

    def test_erp_mapping_change_invalidates_signature(self) -> None:
        spec = _query_spec("15-聚水潭商品数据")
        before = _file_signature(self.source, spec)
        self._touch(self.erp)
        self.assertNotEqual(before, _file_signature(self.source, spec))

    def test_other_queries_ignore_jushuitan_auxiliary_files(self) -> None:
        spec = _query_spec("07-旗舰店商品销售数据")
        before = _file_signature(self.source, spec)
        self._touch(self.offline)
        self._touch(self.erp)
        self.assertEqual(before, _file_signature(self.source, spec))

    def test_temp_and_unsupported_files_are_ignored(self) -> None:
        spec = _query_spec("15-聚水潭商品数据")
        before = _file_signature(self.source, spec)
        (self.offline.parent / "~$2026-10-20.xlsx").write_bytes(b"lock")
        (self.offline.parent / "notes.txt").write_text("ignored")
        self.assertEqual(before, _file_signature(self.source, spec))

    def test_missing_auxiliary_directory_falls_back_to_source_signature(self) -> None:
        spec = _query_spec("15-聚水潭商品数据")
        before = _file_signature(self.source, spec)
        self.assertIn(":a", before)
        self.offline.unlink()
        (self.root / "02-商品明细库存表" / "线下").rmdir()
        self.erp.unlink()
        after = _file_signature(self.source, spec)
        self.assertNotIn(":a", after)
        self.assertNotEqual(before, after)


class WarehouseAuxiliaryRebuildTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / "15-聚水潭商品数据" / "销售主题分析_明细订单商品.xlsx"
        self.source.parent.mkdir(parents=True)
        self.source.write_bytes(b"source")
        self.offline = self.root / "02-商品明细库存表" / "线下" / "2026-10-20.xlsx"
        self.offline.parent.mkdir(parents=True)
        self.offline.write_bytes(b"offline")
        self.erp = self.root / "商品信息文件" / "ERP店铺对照表.xlsx"
        self.erp.parent.mkdir(parents=True)
        self.erp.write_bytes(b"erp")
        warehouse_root = self.root / "warehouse"
        self.paths = WarehousePaths(
            project_root=self.root,
            manifest=self.root / "manifest.json",
            warehouse_root=warehouse_root,
            staging_root=warehouse_root / "staging",
            marts_root=warehouse_root / "marts",
            state_file=warehouse_root / "state.json",
            database=warehouse_root / "ecom.duckdb",
            snapshot=warehouse_root / "analytics-snapshot.json",
        )
        self.paths.ensure()
        self.spec = QuerySpec(
            index=26,
            name="15-聚水潭商品数据",
            m_file="",
            source_kind="folder",
            source_paths=(self.source.parent,),
            sheet_name=None,
            promote_headers=True,
            schema=(),
            operations=(),
        )
        self.state = {"version": 1, "files": {}}

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _run_sync(self) -> dict:
        frame = pl.DataFrame({"value": [1]})
        with patch("ecom_pipeline.warehouse.read_source_file", return_value=frame), patch(
            "ecom_pipeline.warehouse.transform_source_file", return_value=frame
        ):
            return _sync_query(self.paths, self.spec, self.state, SyncOptions(), None)

    def test_unchanged_auxiliary_reuses_partition(self) -> None:
        first = self._run_sync()
        self.assertEqual((first["processed"], first["reused"]), (1, 0))
        second = self._run_sync()
        self.assertEqual((second["processed"], second["reused"]), (0, 1))

    def test_auxiliary_change_rebuilds_partition(self) -> None:
        self._run_sync()
        stat = self.offline.stat()
        os.utime(self.offline, ns=(stat.st_atime_ns + 10_000_000_000, stat.st_mtime_ns + 10_000_000_000))
        rebuilt = self._run_sync()
        self.assertEqual((rebuilt["processed"], rebuilt["reused"]), (1, 0))


if __name__ == "__main__":
    unittest.main()
