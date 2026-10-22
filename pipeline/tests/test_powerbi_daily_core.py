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
                ("mds-天猫商品日明细", "mds_product_model"),
                ("mds-天猫场景日明细", "mds_scene_model"),
                ("mds-天猫商品推广日明细", "mds_item_promo_model"),
                ("mds-天猫店铺日汇总", "mds_shop_model"),
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
        # mds 补缺视图：列结构与 mds_source 的 canonical 中文输出一致；默认为空（不补缺），
        # 各测试按需插入行
        self.connection.execute(
            """
            CREATE TABLE mds_product_model (
              "日期" DATE,
              "商品ID" VARCHAR,
              "商品名称" VARCHAR,
              "商品访客数" DOUBLE,
              "加购人数" DOUBLE,
              "支付买家数" DOUBLE,
              "支付金额" DOUBLE,
              "退款金额" DOUBLE,
              "商品支付件数" DOUBLE
            )
            """
        )
        self.connection.execute(
            """
            CREATE TABLE mds_scene_model (
              "日期" DATE,
              "场景名字" VARCHAR,
              "展现量" DOUBLE,
              "点击量" DOUBLE,
              "花费" DOUBLE,
              "总成交金额" DOUBLE,
              "总购物车数" DOUBLE,
              "直接购物车数" DOUBLE,
              "旺旺咨询量" DOUBLE
            )
            """
        )
        self.connection.execute(
            """
            CREATE TABLE mds_item_promo_model (
              "日期" DATE,
              "商品ID" VARCHAR,
              "主体名称" VARCHAR,
              "场景名字" VARCHAR,
              "展现量" DOUBLE,
              "点击量" DOUBLE,
              "花费" DOUBLE,
              "总成交金额" DOUBLE,
              "总购物车数" DOUBLE,
              "旺旺咨询量" DOUBLE
            )
            """
        )
        self.connection.execute(
            """
            CREATE TABLE mds_shop_model (
              "日期" DATE,
              "浏览量" DOUBLE,
              "店铺客户数" DOUBLE,
              "GMV" DOUBLE,
              "成功退款金额" DOUBLE,
              "加购人数" DOUBLE,
              "关键词推广" DOUBLE,
              "精准人群推广" DOUBLE,
              "全站推广" DOUBLE,
              "淘客" DOUBLE,
              "内容场景" DOUBLE,
              "店铺排名" BIGINT,
              "商品访客数" DOUBLE,
              "支付买家数" DOUBLE,
              "新访客数" DOUBLE,
              "老访客数" DOUBLE,
              "平均停留时长" DOUBLE,
              "跳失率" DOUBLE
            )
            """
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

    def test_mds_gap_fill_adds_missing_dates_and_file_chain_wins_on_overlap(self) -> None:
        # 文件链只有 07-01；mds 兼有 07-01（重叠，恒以文件链为准）与 07-02（补缺）。
        # mds 窗口端点参与后 period_end 顺延到 07-02，补缺日不会被 60 天窗口截掉。
        self.connection.executemany(
            "INSERT INTO mds_product_model VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                ("2026-07-01", "p1", "标准款", 999, 99, 9, 9_999, 9, 99),
                ("2026-07-02", "p1", "标准款", 300, 30, 3, 3_000, 300, 30),
                ("2026-07-02", "p9", "未上榜商品", 9_999, 90, 9, 900, 90, 9),
                # 去年同期（窗口 2026-05-04~07-02 往前 365 天）补缺：文件链无 2025 年数据
                ("2025-07-01", "p1", "标准款", 1, 1, 1, 7_000, 700, 1),
            ],
        )
        self.connection.executemany(
            "INSERT INTO mds_scene_model VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                ("2026-07-01", "全站", 1, 1, 1, 1, 1, 1, 1),
                ("2026-07-02", "关键词推广", 2_000, 200, 400, 1_200, 8, 5, 3),
            ],
        )
        self.connection.executemany(
            "INSERT INTO mds_item_promo_model VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                ("2026-07-01", "p1", "标准款", "全站", 1, 1, 1, 1, 1, 1),
                ("2026-07-02", "p1", "标准款", "关键词推广", 1_000, 100, 50, 500, 10, 4),
                ("2026-07-02", "p9", "未上榜商品", "关键词推广", 9_999, 999, 999, 999, 99, 9),
            ],
        )
        # 04 基础数据补缺：07-01 重叠（忽略）、07-02 补缺；14 字段与 04 canonical 一一对应
        self.connection.executemany(
            "INSERT INTO mds_shop_model VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                ("2026-07-01", 888_888, 888_888, 888_888, 888_888, 888_888, 1, 1, 1, 1, 1, 99, 888_888, 888_888, 888_888, 888_888, 88, 0.99),
                ("2026-07-02", 5_000, 4_000, 60_000, 6_000, 300, 1_000, 2_000, 3_000, 400, 500, 7, 3_500, 120, 2_400, 1_600, 9.5, 0.45),
            ],
        )
        pages = _build_powerbi_pages(self.connection, {})

        self.assertEqual(str(pages["period"]["end"]), "2026-07-02")
        product_rows = {(str(row["date"]), row["productId"]): row for row in pages["productDaily"]}
        self.assertEqual(product_rows[("2026-07-01", "p1")]["visitors"], 100)  # 文件链值，非 mds 999
        self.assertEqual(product_rows[("2026-07-02", "p1")]["visitors"], 300)  # mds 补缺
        self.assertEqual(product_rows[("2026-07-02", "p1")]["payAmount"], 3_000)
        # 未进文件链访客前 60 的商品不随补缺混入，展示商品集合稳定
        self.assertNotIn("p9", {row["productId"] for row in pages["productDaily"]})
        scene_rows = {(str(row["date"]), row["scene"]): row for row in pages["promotionSceneDaily"]}
        self.assertEqual(scene_rows[("2026-07-01", "全站")]["spend"], 300)  # 文件链值，mds 重叠行被忽略
        self.assertEqual(scene_rows[("2026-07-02", "关键词推广")]["spend"], 400)  # mds「花费」列（无 花费（未含达人））
        self.assertEqual(scene_rows[("2026-07-02", "关键词推广")]["consultations"], 3)
        # dailyCore 同步补缺：07-02 不再是「推广有数、商品全 0」的半空行；
        # dailyCore 为全店汇总（不受 ranked top-60 限制），故含 p9
        daily_core_rows = {str(row["date"]): row for row in pages["dailyCore"]}
        self.assertEqual(daily_core_rows["2026-07-01"]["productVisitors"], 150)  # 文件链 100+50，mds 重叠忽略
        self.assertEqual(daily_core_rows["2026-07-02"]["productVisitors"], 300 + 9_999)
        self.assertEqual(daily_core_rows["2026-07-02"]["payAmount"], 3_000 + 900)
        self.assertEqual(daily_core_rows["2026-07-02"]["spend"], 400)
        self.assertEqual(daily_core_rows["2026-07-02"]["promotionCarts"], 8)
        # 商品×场景补缺：item 表无直接购物车数，回填日 directCarts 恒为 0（已知口径缺口）
        item_rows = {
            (str(row["date"]), row["productId"], row["scene"]): row
            for row in pages["promotionProductDaily"]
        }
        self.assertEqual(item_rows[("2026-07-01", "p1", "全站")]["spend"], 300)  # 文件链值
        self.assertEqual(item_rows[("2026-07-01", "p1", "全站")]["directCarts"], 3)
        filled = item_rows[("2026-07-02", "p1", "关键词推广")]
        self.assertEqual(filled["spend"], 50)
        self.assertEqual(filled["revenue"], 500)
        self.assertEqual(filled["carts"], 10)
        self.assertEqual(filled["consultations"], 4)
        self.assertEqual(filled["directCarts"], 0)
        # ranked 由文件链花费决定，p9 不随补缺混入
        self.assertNotIn("p9", {row["productId"] for row in pages["promotionProductDaily"]})
        # 去年同期补缺：文件链无 2025 数据，p1 同比基数来自 mds
        prior_rows = {row["productId"]: row for row in pages["productDailyPriorYear"]}
        self.assertEqual(prior_rows["p1"]["payAmount"], 7_000)
        self.assertEqual(prior_rows["p1"]["refund"], 700)
        # 04 基础数据补缺：重叠日恒以文件链为准，缺口日 14 字段全量补齐
        overall_rows = {str(row["date"]): row for row in pages["overallDaily"]}
        self.assertEqual(overall_rows["2026-07-01"]["visitors"], 999)  # 文件链值，非 mds 888888
        filled04 = overall_rows["2026-07-02"]
        self.assertEqual(filled04["visitors"], 4_000)
        self.assertEqual(filled04["productVisitors"], 3_500)
        self.assertEqual(filled04["payBuyers"], 120)
        self.assertEqual(filled04["payAmount"], 60_000)
        self.assertEqual(filled04["refund"], 6_000)
        self.assertEqual(filled04["fullSiteSpend"], 3_000)
        self.assertEqual(filled04["keywordSpend"], 1_000)
        self.assertEqual(filled04["audienceSpend"], 2_000)
        self.assertEqual(filled04["taokeSpend"], 400)
        self.assertEqual(filled04["newVisitors"], 2_400)
        self.assertEqual(filled04["returningVisitors"], 1_600)
        self.assertAlmostEqual(filled04["avgStaySeconds"], 9.5)
        self.assertAlmostEqual(filled04["bounceRate"], 0.45)
        # coverage 并集：07-01（文件链）+ 07-02（mds 补缺）均为已覆盖
        self.assertEqual(pages["coverage"]["base"]["days"], 2)
        self.assertEqual(pages["coverage"]["product"]["days"], 2)
        self.assertEqual(pages["coverage"]["promotion"]["days"], 2)

    def test_mds_gap_fill_disabled_when_views_unregistered(self) -> None:
        # mds 未登记进 catalog 时退回纯文件链口径，行为与接入前一致
        self.connection.execute(
            "DELETE FROM warehouse_query_catalog WHERE query_name LIKE 'mds-%'"
        )
        pages = _build_powerbi_pages(self.connection, {})
        self.assertEqual(sorted({str(row["date"]) for row in pages["productDaily"]}), ["2026-07-01"])
        self.assertEqual(pages["coverage"]["product"]["days"], 1)

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
