from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import duckdb
import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecom_pipeline.config import WarehousePaths  # noqa: E402
from ecom_pipeline.warehouse import (  # noqa: E402
    _build_powerbi_pages,
    _load_pbix_store_rank_daily,
    _store_rank_sort_key,
)


class PowerBiDailyCoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = duckdb.connect(":memory:")
        self.connection.execute(
            """
            CREATE TABLE warehouse_query_catalog (
              query_name VARCHAR,
              model_view VARCHAR
            )
            """
        )
        self.connection.executemany(
            "INSERT INTO warehouse_query_catalog VALUES (?, ?)",
            [
                ("04-旗舰店基础数据", "base_model"),
                ("05-旗舰店ID对照表", "catalog_model"),
                ("07-旗舰店商品销售数据", "product_model"),
                ("08-旗舰店推广花费", "promotion_model"),
            ],
        )
        self.connection.execute(
            """
            CREATE TABLE base_model (
              "统计日期" DATE,
              "店铺名称" VARCHAR,
              "访客数" DOUBLE,
              "商品访客数" DOUBLE,
              "加购人数" DOUBLE,
              "支付买家数" DOUBLE,
              "支付金额" DOUBLE,
              "成功退款金额" DOUBLE,
              "全站推广花费" DOUBLE,
              "关键词推广花费" DOUBLE,
              "精准人群推广花费" DOUBLE,
              "淘宝客佣金" DOUBLE,
              "新访客数" DOUBLE,
              "老访客数" DOUBLE,
              "平均停留时长" DOUBLE,
              "跳失率" DOUBLE,
              "_source_mtime_ns" BIGINT,
              "_source_path" VARCHAR
            )
            """
        )
        self.connection.execute(
            """
            INSERT INTO base_model VALUES (
              DATE '2026-07-01', '麻大师旗舰店',
              999, 999, 999, 999, 999, 999,
              10, 20, 30, 40, 100, 50, 12, 0.4,
              1, 'base.csv'
            )
            """
        )
        self.connection.execute(
            """
            CREATE TABLE product_model (
              "日期" DATE,
              "商品ID" VARCHAR,
              "商品名称" VARCHAR,
              "商品访客数" DOUBLE,
              "加购人数" DOUBLE,
              "支付买家数" DOUBLE,
              "支付金额" DOUBLE,
              "退款金额" DOUBLE,
              "商品支付件数" DOUBLE,
              "_source_mtime_ns" BIGINT,
              "_source_path" VARCHAR
            )
            """
        )
        self.connection.executemany(
            "INSERT INTO product_model VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                ("2026-07-01", "p1", "标准款", 100, 10, 4, 20_000, 2_000, 6, 1, "product.csv"),
                ("2026-07-01", "p2", "补差价专拍", 50, 5, 1, 1_000, 100, 9, 1, "product.csv"),
            ],
        )
        self.connection.execute(
            """
            CREATE TABLE promotion_model (
              "日期" DATE,
              "场景ID" VARCHAR,
              "场景名字" VARCHAR,
              "计划ID" VARCHAR,
              "商品ID" VARCHAR,
              "主体名称" VARCHAR,
              "展现量" DOUBLE,
              "点击量" DOUBLE,
              "花费（未含达人）" DOUBLE,
              "花费" DOUBLE,
              "总成交金额" DOUBLE,
              "总购物车数" DOUBLE,
              "直接购物车数" DOUBLE,
              "旺旺咨询量" DOUBLE,
              "_source_sheet" VARCHAR,
              "_source_mtime_ns" BIGINT,
              "_source_path" VARCHAR
            )
            """
        )
        self.connection.executemany(
            "INSERT INTO promotion_model VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                ("2026-07-01", "s1", "全站", "plan1", "p1", "p1", 1000, 100, 300, None, 900, 5, 3, 2, "sheet1", 1, "promotion.csv"),
                ("2026-07-01", "s2", "关键词", "plan2", "p2", "p2", 500, 50, 200, None, 600, 5, 2, 1, "sheet2", 1, "promotion.csv"),
            ],
        )
        self.connection.execute(
            """
            CREATE TABLE catalog_model (
              "商品ID" VARCHAR,
              "商品名称" VARCHAR,
              "商家编码" VARCHAR,
              "商品图片" VARCHAR,
              "30日销量" DOUBLE,
              "累计销量" DOUBLE
            )
            """
        )
        self.connection.executemany(
            "INSERT INTO catalog_model VALUES (?, ?, ?, ?, ?, ?)",
            [
                ("p1", "标准款", "P1", None, 10, 100),
                ("p2", "补差价专拍", "P2", None, 5, 50),
            ],
        )
    def tearDown(self) -> None:
        self.connection.close()

    def test_store_rank_uses_pbix_numeric_min_order(self) -> None:
        self.assertLess(_store_rank_sort_key("2"), _store_rank_sort_key("10"))

    def test_store_rank_loader_reads_pbix_store_rank_not_search_rank(self) -> None:
        frame = pl.DataFrame(
            {
                "日期": [date(2026, 7, 1), date(2026, 7, 1)],
                "店铺": ["麻大师旗舰店", "麻大师旗舰店"],
                "渠道": ["淘系", "淘宝"],
                "店铺排名": [10, 5],
                "搜索排名数": [2, 26],
            }
        )
        spec = SimpleNamespace(name="00-月表汇总", source_paths=["unused"])
        paths = WarehousePaths.discover()
        with (
            patch("ecom_pipeline.warehouse.load_catalog", return_value=(None, [spec])),
            patch("ecom_pipeline.warehouse.discover_files", return_value=[Path("source.xlsx")]),
            patch("ecom_pipeline.warehouse.read_source_file", return_value=object()),
            patch("ecom_pipeline.warehouse.transform_source_file", return_value=frame),
        ):
            ranks = _load_pbix_store_rank_daily(paths)

        self.assertEqual(ranks, {"2026-07-01": "5"})

    def test_daily_core_matches_pbix_sources_and_dax_formulas(self) -> None:
        pages = _build_powerbi_pages(self.connection, {"2026-07-01": "2"})

        self.assertIn("dailyCore", pages)
        self.assertEqual(len(pages["dailyCore"]), 1)
        row = pages["dailyCore"][0]
        self.assertEqual(str(row["date"]), "2026-07-01")
        self.assertEqual(row["year"], "2026")
        self.assertEqual(row["month"], "07月")
        self.assertEqual(row["day"], "01")
        self.assertEqual(row["productVisitors"], 150)
        self.assertEqual(row["addToCart"], 15)
        self.assertEqual(row["payBuyers"], 5)
        self.assertEqual(row["promotionCarts"], 10)
        self.assertAlmostEqual(row["addToCartRate"], 0.1)
        self.assertAlmostEqual(row["addToCartCost"], 50)
        self.assertEqual(row["payAmount"], 21_000)
        self.assertEqual(row["paidUnits"], 6)
        self.assertAlmostEqual(row["conversionRate"], 5 / 150)
        self.assertEqual(row["refundAmount"], 2_100)
        self.assertAlmostEqual(row["refundRate"], 0.1)
        self.assertEqual(row["spend"], 500)
        self.assertAlmostEqual(row["subsidizedAmount"], 16_065)
        self.assertAlmostEqual(row["subsidizedFeeRate"], 500 / 16_065)
        self.assertEqual(row["storeRank"], "2")

    def test_explicit_period_overrides_window_and_reports_coverage(self) -> None:
        # 按需重算：显式区间必须原样生效（不向滚动窗口钳制），coverage 回报各来源表覆盖
        pages = _build_powerbi_pages(
            self.connection,
            {},
            period_start="2026-06-01",
            period_end="2026-07-01",
            include_customer_service=False,
        )

        self.assertEqual(str(pages["period"]["start"]), "2026-06-01")
        self.assertEqual(str(pages["period"]["end"]), "2026-07-01")
        # 区间 31 天，数据只有 07-01 一天：missingDays = 30
        coverage = pages["coverage"]
        self.assertEqual(coverage["range"], {"start": "2026-06-01", "end": "2026-07-01"})
        self.assertEqual(coverage["base"]["days"], 1)
        self.assertEqual(coverage["base"]["missingDays"], 30)
        self.assertEqual(coverage["base"]["min"], "2026-07-01")
        self.assertEqual(coverage["base"]["max"], "2026-07-01")
        # 07/08 表同日有数据；客服按需跳过（天猫明细工作区不渲染客服，客服 tab 读快照）
        self.assertEqual(coverage["product"]["days"], 1)
        self.assertEqual(coverage["promotion"]["days"], 1)
        self.assertIsNone(pages["customerService"])
        # 行仍按显式区间聚合：overallDaily 只含 07-01 一行
        self.assertEqual([str(row["date"]) for row in pages["overallDaily"]], ["2026-07-01"])

    def test_explicit_period_with_dates_only_accepts_strings(self) -> None:
        # 只给 end 时向前推同样的滚动窗口（60 天）
        pages = _build_powerbi_pages(self.connection, {}, period_start=None, period_end="2026-07-01")
        self.assertEqual(str(pages["period"]["start"]), "2026-05-03")
        self.assertEqual(str(pages["period"]["end"]), "2026-07-01")

    def test_explicit_period_rejects_inverted_range(self) -> None:
        with self.assertRaises(ValueError):
            _build_powerbi_pages(self.connection, {}, period_start="2026-07-02", period_end="2026-07-01")

    def test_thin_export_snapshot_loses_to_wide_snapshot(self) -> None:
        # 新版 12 列瘦导出（无访客/加购/退款列）与 38 列宽表同日同商品并存时，
        # 即使瘦导出下载更晚，也必须让位给宽表快照。
        self.connection.executemany(
            "INSERT INTO product_model VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                ("2026-07-02", "p1", "标准款", None, None, 4, 20_000, None, 6, 2, "thin.xlsx"),
                ("2026-07-02", "p1", "标准款", 100, 10, 4, 20_000, 2_000, 6, 1, "wide.xlsx"),
            ],
        )
        pages = _build_powerbi_pages(self.connection, {})
        row = next(item for item in pages["dailyCore"] if str(item["date"]) == "2026-07-02")
        self.assertEqual(row["productVisitors"], 100)
        self.assertEqual(row["addToCart"], 10)
        self.assertEqual(row["refundAmount"], 2_000)
        self.assertEqual(row["paidUnits"], 6)
        product_row = next(
            item for item in pages["productDaily"] if str(item["date"]) == "2026-07-02"
        )
        self.assertEqual(product_row["visitors"], 100)
        self.assertEqual(product_row["refund"], 2_000)


if __name__ == "__main__":
    unittest.main()
