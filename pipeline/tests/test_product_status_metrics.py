from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path

import duckdb
import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecom_pipeline.warehouse import _build_product_management_pages  # noqa: E402


class ProductStatusMetricTests(unittest.TestCase):
    def test_status_matrices_keep_sales_quantity_and_product_management_uses_received_amount(self) -> None:
        """商品管理显示商家实收，不再向页面输出实发金额或实发量指标。"""

        frame = pl.DataFrame(
            {
                "订单状态明细": ["已发货", "待发货", "等通知"],
                "订单日期": [date(2026, 7, 1)] * 3,
                "商品编码": ["SKU-1", "SKU-2", "SKU-3"],
                "商品简称": ["已发商品", "待发商品", "等通知商品"],
                "产品分类": ["床垫"] * 3,
                "品牌": ["麻大师"] * 3,
                "销售数量": [2.0, 3.0, 4.0],
                "实发数量": [2.0, 0.0, 0.0],
                "实发金额": [200.0, 0.0, 0.0],
                "销售金额": [200.0, 300.0, 400.0],
                "退货数量": [0.0] * 3,
                "退货金额": [0.0] * 3,
                "商家实收": [180.0, 270.0, 360.0],
                "买家实付": [200.0, 300.0, 400.0],
                "平台补贴金额": [0.0] * 3,
                "店铺": ["麻大师天猫旗舰店"] * 3,
                "达人名称": [None] * 3,
                "发货仓": ["华东仓"] * 3,
                "订单状态": ["已发货", "待发货", "异常"],
            }
        )
        connection = duckdb.connect()
        try:
            connection.register("jt_rows", frame.to_arrow())
            connection.execute("CREATE VIEW jt_source AS SELECT * FROM jt_rows")
            connection.execute(
                "CREATE TABLE warehouse_query_catalog (query_name VARCHAR, source_view VARCHAR, model_view VARCHAR)"
            )
            connection.execute(
                "INSERT INTO warehouse_query_catalog VALUES ('15-聚水潭商品数据', 'jt_source', 'jt_source')"
            )

            pages = _build_product_management_pages(connection)

            self.assertEqual(pages["kpis"]["totalSalesUnits"], 9.0)
            self.assertEqual(pages["kpis"]["totalReceivedAmount"], 810.0)
            self.assertEqual(pages["kpis"]["collectionRate"], 0.9)
            self.assertNotIn("totalShippedAmount", pages["kpis"])
            self.assertNotIn("totalShippedUnits", pages["kpis"])
            self.assertNotIn("dailyWarehouseMatrix", pages)
            self.assertNotIn("shippedAmount", pages["monthlyComparison"]["current"])
            self.assertNotIn("shippedUnits", pages["monthlyComparison"]["current"])
            self.assertEqual(pages["productOverview"][0]["receivedAmount"], 360.0)
            self.assertNotIn("shippedUnits", pages["productOverview"][0])
            warehouse_row = pages["warehouseStatusMatrix"]["rows"][0]
            self.assertEqual(warehouse_row["values"]["已发货"], 2.0)
            self.assertEqual(warehouse_row["values"]["待发货"], 3.0)
            self.assertEqual(warehouse_row["values"]["等通知"], 4.0)
            daily_row = pages["dailyStatusMatrix"]["rows"][0]
            self.assertEqual(daily_row["values"]["待发货"], 3.0)
            self.assertEqual(daily_row["values"]["等通知"], 4.0)
        finally:
            connection.close()

    def test_product_fulfillment_uses_distinct_orders_and_shared_filters(self) -> None:
        """仓配履约按产品名称去重订单，并复用商品管理的全部切片器条件。"""

        frame = pl.DataFrame(
            {
                "线上订单号": ["ORDER-A", "ORDER-A", "ORDER-B", "ORDER-C", "ORDER-D"],
                "线上子订单编号": ["A-1", "A-2", "B-1", "C-1", "D-1"],
                "内部订单号": ["INNER-A", "INNER-A", "INNER-B", "INNER-C", "INNER-D"],
                "订单状态明细": ["已发货", "已发货", "已发货", "待发货", "已发货"],
                "订单状态": ["已发货", "已发货", "已发货", "待发货", "已发货"],
                "订单日期": [date(2026, 7, 1), date(2026, 7, 1), date(2026, 7, 1), date(2026, 7, 1), date(2026, 7, 2)],
                "发货日期": [date(2026, 7, 4), date(2026, 7, 4), date(2026, 7, 6), None, date(2026, 7, 12)],
                "商品编码": ["SKU-A", "SKU-A", "SKU-A", "SKU-B", "SKU-B"],
                "商品简称": ["产品 A", "产品 A", "产品 A", "产品 B", "产品 B"],
                "产品分类": ["床垫"] * 5,
                "品牌": ["麻大师"] * 5,
                "销售数量": [1.0] * 5,
                "销售金额": [100.0] * 5,
                "退货数量": [0.0] * 5,
                "退货金额": [0.0] * 5,
                "商家实收": [90.0] * 5,
                "买家实付": [100.0] * 5,
                "平台补贴金额": [0.0] * 5,
                "店铺": ["店铺甲", "店铺甲", "店铺甲", "店铺乙", "店铺甲"],
                "店铺简称": ["店铺甲", "店铺甲", "店铺甲", "店铺乙", "店铺甲"],
                "渠道平台": ["渠道甲", "渠道甲", "渠道甲", "渠道乙", "渠道甲"],
                "达人名称": [None] * 5,
                "发货仓": ["华东仓"] * 5,
            }
        )
        connection = duckdb.connect()
        try:
            connection.register("jt_rows", frame.to_arrow())
            connection.execute("CREATE VIEW jt_source AS SELECT * FROM jt_rows")
            connection.execute(
                "CREATE TABLE warehouse_query_catalog (query_name VARCHAR, source_view VARCHAR, model_view VARCHAR)"
            )
            connection.execute(
                "INSERT INTO warehouse_query_catalog VALUES ('15-聚水潭商品数据', 'jt_source', 'jt_source')"
            )

            pages = _build_product_management_pages(connection)
            rows = {row["productName"]: row for row in pages["fulfillmentByProduct"]}
            product_a = rows["产品 A"]
            self.assertEqual(product_a["orderCount"], 2)
            self.assertEqual(product_a["shippedOrderCount"], 2)
            self.assertAlmostEqual(product_a["avgShippingDays"], 4.0)
            self.assertAlmostEqual(product_a["day3Share"], 0.5)
            self.assertAlmostEqual(product_a["day5Share"], 0.5)
            self.assertAlmostEqual(product_a["day7Share"], 0.0)
            self.assertAlmostEqual(product_a["day10Share"], 0.0)
            self.assertAlmostEqual(product_a["within15DayShare"], 1.0)

            product_b = rows["产品 B"]
            self.assertEqual(product_b["orderCount"], 2)
            self.assertEqual(product_b["shippedOrderCount"], 1)
            self.assertAlmostEqual(product_b["avgShippingDays"], 10.0)
            self.assertAlmostEqual(product_b["day10Share"], 0.5)
            self.assertAlmostEqual(product_b["within15DayShare"], 0.5)

            filtered_pages = _build_product_management_pages(
                connection,
                start="2026-07-01",
                end="2026-07-01",
                statuses=["待发货"],
                channels=["渠道乙"],
                store_short_names=["店铺乙"],
            )
            self.assertEqual(len(filtered_pages["fulfillmentByProduct"]), 1)
            filtered = filtered_pages["fulfillmentByProduct"][0]
            self.assertEqual(filtered["productName"], "产品 B")
            self.assertEqual(filtered["orderCount"], 1)
            self.assertEqual(filtered["shippedOrderCount"], 0)
            self.assertIsNone(filtered["avgShippingDays"])
            self.assertAlmostEqual(filtered["within15DayShare"], 0.0)
        finally:
            connection.close()


if __name__ == "__main__":
    unittest.main()
