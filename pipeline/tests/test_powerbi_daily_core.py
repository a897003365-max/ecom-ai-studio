from __future__ import annotations

import sys
import unittest
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecom_pipeline.warehouse import _build_powerbi_pages  # noqa: E402


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
                ("00-月表汇总", "summary_model"),
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
        self.connection.execute(
            """
            CREATE TABLE summary_model (
              "日期" DATE,
              "店铺" VARCHAR,
              "渠道" VARCHAR,
              "店铺排名" VARCHAR
            )
            """
        )
        self.connection.executemany(
            "INSERT INTO summary_model VALUES (?, ?, ?, ?)",
            [
                ("2026-07-01", "麻大师旗舰店", "淘系", "2"),
                ("2026-07-01", "麻大师旗舰店", "淘宝", "3"),
                ("2026-07-01", "其他店铺", "淘系", "1"),
            ],
        )

    def tearDown(self) -> None:
        self.connection.close()

    def test_daily_core_matches_pbix_sources_and_dax_formulas(self) -> None:
        pages = _build_powerbi_pages(self.connection)

        self.assertIn("dailyCore", pages)
        self.assertEqual(len(pages["dailyCore"]), 1)
        row = pages["dailyCore"][0]
        self.assertEqual(str(row["date"]), "2026-07-01")
        self.assertEqual(row["year"], "2026")
        self.assertEqual(row["month"], "07月")
        self.assertEqual(row["day"], "01")
        self.assertEqual(row["productVisitors"], 150)
        self.assertEqual(row["addToCart"], 15)
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


if __name__ == "__main__":
    unittest.main()
