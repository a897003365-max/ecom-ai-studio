from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path

import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecom_pipeline.catalog import ColumnSpec, QuerySpec, load_catalog  # noqa: E402
from ecom_pipeline.config import WarehousePaths  # noqa: E402
from ecom_pipeline.source_policy import (  # noqa: E402
    DINGTALK_COVERED_QUERIES,
    POWERBI_UNIQUE_DOMAINS,
    select_sync_specs,
)
from ecom_pipeline.transforms import _parse_filename_date, canonical_column, transform_source_file  # noqa: E402


class TransformTests(unittest.TestCase):
    def test_filename_date_variants(self) -> None:
        self.assertEqual(_parse_filename_date("report_2026-07-10_1.xls"), date(2026, 7, 10))
        self.assertEqual(
            _parse_filename_date("Waiter_Fri Apr 03 00_00_00 CST 2026_data.xls"),
            date(2026, 4, 3),
        )

    def test_column_canonicalization(self) -> None:
        self.assertEqual(canonical_column("总推广费#(lf)(含品销宝）"), canonical_column("总推广费\n（含品销宝）"))

    def test_excel_serial_date(self) -> None:
        spec = QuerySpec(
            index=1,
            name="日期测试",
            m_file="test.pq",
            source_kind="excel_file",
            source_paths=(),
            sheet_name=None,
            promote_headers=True,
            schema=(ColumnSpec("日期", "type date"),),
            operations=(),
        )
        source = Path(__file__)
        frame = pl.DataFrame({"日期": [45627], "Source.Name": ["test.xlsx"]})
        transformed = transform_source_file(frame, spec, source)
        self.assertEqual(transformed["日期"].to_list(), [date(2024, 12, 1)])


class CatalogTests(unittest.TestCase):
    def test_exported_manifest_has_all_m_queries(self) -> None:
        paths = WarehousePaths.discover()
        manifest, queries = load_catalog(paths.manifest)
        self.assertEqual(manifest["queryCount"], 25)
        self.assertEqual(len(queries), 25)
        self.assertTrue(all(query.source_paths for query in queries))

    def test_default_sync_excludes_queries_already_owned_by_dingtalk(self) -> None:
        paths = WarehousePaths.discover()
        _, queries = load_catalog(paths.manifest)

        selected, excluded = select_sync_specs(queries)

        self.assertEqual(
            set(DINGTALK_COVERED_QUERIES),
            {"00-月表汇总", "03-1-各渠道目标金额"},
        )
        self.assertEqual({item.name for item in excluded}, set(DINGTALK_COVERED_QUERIES))
        self.assertFalse(set(DINGTALK_COVERED_QUERIES) & {item.name for item in selected})
        self.assertEqual(len(selected), 23)

    def test_explicit_sync_cannot_reintroduce_dingtalk_owned_queries(self) -> None:
        paths = WarehousePaths.discover()
        _, queries = load_catalog(paths.manifest)

        selected, excluded = select_sync_specs(
            queries,
            frozenset({"00-月表汇总", "04-旗舰店基础数据"}),
        )

        self.assertEqual([item.name for item in selected], ["04-旗舰店基础数据"])
        self.assertEqual([item.name for item in excluded], ["00-月表汇总"])

    def test_unique_domains_cover_every_retained_query(self) -> None:
        paths = WarehousePaths.discover()
        _, queries = load_catalog(paths.manifest)
        selected, _ = select_sync_specs(queries)
        domain_queries = {
            query_name
            for domain in POWERBI_UNIQUE_DOMAINS
            for query_name in domain["queries"]
        }

        self.assertEqual({item.name for item in selected}, domain_queries)


if __name__ == "__main__":
    unittest.main()
