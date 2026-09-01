from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import duckdb
import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecom_pipeline.catalog import QuerySpec  # noqa: E402
from ecom_pipeline.config import WarehousePaths  # noqa: E402
from ecom_pipeline.warehouse import _create_source_views  # noqa: E402


class ProductMasterModelTests(unittest.TestCase):
    def test_model_keeps_a_single_latest_row_per_product_code(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            warehouse_root = root / "warehouse"
            paths = WarehousePaths(
                project_root=root,
                manifest=root / "manifest.json",
                warehouse_root=warehouse_root,
                staging_root=warehouse_root / "staging",
                marts_root=warehouse_root / "marts",
                state_file=warehouse_root / "state.json",
                database=warehouse_root / "ecom.duckdb",
                snapshot=warehouse_root / "analytics-snapshot.json",
            )
            spec = QuerySpec(
                index=1,
                name="product-master",
                m_file="product-master.pq",
                source_kind="excel_file",
                source_paths=(),
                sheet_name=None,
                promote_headers=True,
                schema=(),
                operations=(),
            )
            partition_dir = paths.staging_root / spec.key
            partition_dir.mkdir(parents=True)
            pl.DataFrame(
                {
                    "商品编码": ["SKU-1", "SKU-2"],
                    "床垫类别": ["旧类别", "家纺"],
                    "成本": [100.0, 50.0],
                    "尺寸": ["旧尺寸", "标准"],
                    "_source_path": ["older.xlsx", "older.xlsx"],
                    "_source_mtime_ns": [10, 10],
                }
            ).write_parquet(partition_dir / "older.parquet")
            pl.DataFrame(
                {
                    "商品编码": ["SKU-1"],
                    "床垫类别": ["新类别"],
                    "成本": [120.0],
                    "尺寸": ["新尺寸"],
                    "_source_path": ["newer.xlsx"],
                    "_source_mtime_ns": [20],
                }
            ).write_parquet(partition_dir / "newer.parquet")

            connection = duckdb.connect()
            try:
                _create_source_views(
                    connection,
                    paths,
                    [spec],
                    {"product-master": {"files": 2, "rows": 3, "columns": 6, "status": "success"}},
                )
                model = f'"model_{spec.key}"'
                self.assertEqual(connection.execute(f"SELECT count(*) FROM {model}").fetchone()[0], 2)
                self.assertEqual(
                    connection.execute(
                        f'SELECT "床垫类别", "成本", "尺寸" FROM {model} WHERE "商品编码" = \'SKU-1\''
                    ).fetchone(),
                    ("新类别", 120.0, "新尺寸"),
                )
                self.assertEqual(
                    connection.execute(
                        f"SELECT count(*) FROM (VALUES ('SKU-1'), ('SKU-2')) AS orders(product_code) "
                        f"LEFT JOIN {model} master ON orders.product_code = master.\"商品编码\""
                    ).fetchone()[0],
                    2,
                )
            finally:
                connection.close()

    def test_jushuitan_model_deduplicates_snapshots_without_collapsing_order_lines(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            warehouse_root = root / "warehouse"
            paths = WarehousePaths(
                project_root=root,
                manifest=root / "manifest.json",
                warehouse_root=warehouse_root,
                staging_root=warehouse_root / "staging",
                marts_root=warehouse_root / "marts",
                state_file=warehouse_root / "state.json",
                database=warehouse_root / "ecom.duckdb",
                snapshot=warehouse_root / "analytics-snapshot.json",
            )
            spec = QuerySpec(
                index=1,
                name="15-聚水潭商品数据",
                m_file="",
                source_kind="folder",
                source_paths=(),
                sheet_name=None,
                promote_headers=True,
                schema=(),
                operations=(),
            )
            partition_dir = paths.staging_root / spec.key
            partition_dir.mkdir(parents=True)
            first_snapshot = pl.DataFrame(
                {
                    "内部订单号": ["ORDER-1", "ORDER-2"],
                    "商品编码": ["SKU-1", "SKU-1"],
                    "销售数量": [1.0, 1.0],
                    "订单状态明细": ["待发货", "待发货"],
                    "_source_path": ["older.xlsx", "older.xlsx"],
                    "_source_mtime_ns": [10, 10],
                }
            )
            first_snapshot.write_parquet(partition_dir / "older.parquet")
            first_snapshot.head(1).with_columns(
                pl.lit("newer.xlsx").alias("_source_path"),
                pl.lit(20).alias("_source_mtime_ns"),
            ).write_parquet(partition_dir / "newer.parquet")

            connection = duckdb.connect()
            try:
                _create_source_views(
                    connection,
                    paths,
                    [spec],
                    {"15-聚水潭商品数据": {"files": 2, "rows": 3, "columns": 6, "status": "success"}},
                )
                model = f'"model_{spec.key}"'
                self.assertEqual(connection.execute(f"SELECT count(*) FROM {model}").fetchone()[0], 2)
                self.assertEqual(
                    connection.execute(f"SELECT count(DISTINCT \"内部订单号\") FROM {model}").fetchone()[0],
                    2,
                )
                columns = [row[0] for row in connection.execute(f"DESCRIBE {model}").fetchall()]
                self.assertNotIn("_source_path", columns)
                self.assertNotIn("_source_mtime_ns", columns)
            finally:
                connection.close()


if __name__ == "__main__":
    unittest.main()
