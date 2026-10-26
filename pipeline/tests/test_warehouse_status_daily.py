from __future__ import annotations

from datetime import date
from pathlib import Path
import sys
import unittest

import duckdb
import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ecom_pipeline.warehouse import _build_product_management_pages


def sample_connection():
    # Payment and order dates deliberately disagree; include missing payments and warehouse.
    rows = [
        ("2026-06-20", "仓库甲", "已发货", 20., "天猫", "店甲", "A"),
        ("2026-06-27", "仓库甲", "已发货", 2., "天猫", "店甲", "A"),
        ("2026-06-30", "仓库甲", "待发货", 3., "天猫", "店甲", "A"),
        ("2026-07-01", "仓库甲", "已发货", 4., "天猫", "店甲", "A"),
        ("2026-07-01", "仓库乙", "已发货", 5., "京东", "店乙", "B"),
        ("2026-07-03", None, "待发货", 6., "天猫", "店甲", "A"),
        ("2026-07-03", "仓库甲", "已发货", 7., "京东", "店乙", "B"),
        (None, "仓库甲", "未付款", 8., "天猫", "店甲", "A"),
    ]
    n = len(rows)
    frame = pl.DataFrame({
        "付款日期": [date.fromisoformat(r[0]) if r[0] else None for r in rows],
        "订单日期": [date(2026, 6, 1)] * n,
        "发货仓": [r[1] for r in rows], "订单状态明细": [r[2] for r in rows],
        "订单状态": [r[2] for r in rows], "销售数量": [r[3] for r in rows],
        "渠道平台": [r[4] for r in rows], "店铺简称": [r[5] for r in rows],
        "店铺": [r[5] for r in rows], "商品编码": [r[6] for r in rows],
        "商品简称": [r[6] for r in rows], "产品分类": ["床垫"] * n,
        "品牌": ["麻大师"] * n, "销售金额": [100.] * n, "商家实收": [90.] * n,
        "买家实付": [100.] * n, "退货金额": [0.] * n, "退货数量": [0.] * n,
        "平台补贴金额": [0.] * n, "达人名称": [None] * n,
    })
    connection = duckdb.connect()
    connection.register("fixture", frame.to_arrow())
    connection.execute("CREATE TABLE jt AS SELECT * FROM fixture")
    connection.execute("CREATE TABLE warehouse_query_catalog (query_name VARCHAR, source_view VARCHAR, model_view VARCHAR)")
    connection.execute("INSERT INTO warehouse_query_catalog VALUES ('15-聚水潭商品数据', 'jt', 'jt')")
    return connection


class WarehouseStatusDailyTests(unittest.TestCase):
    def setUp(self):
        self.connection = sample_connection()

    def tearDown(self):
        self.connection.close()

    def pages(self, **kwargs):
        return _build_product_management_pages(self.connection, **kwargs)

    def test_seven_payment_days_and_parent_totals(self):
        pages = self.pages()
        details = pages["warehouseStatusDaily"]
        self.assertEqual((details["start"], details["end"]), ("2026-06-27", "2026-07-03"))
        self.assertEqual(len(details["rows"]), 21)
        a = [r for r in details["rows"] if r["warehouse"] == "仓库甲"]
        self.assertEqual([r["date"] for r in a], ["2026-07-03", "2026-07-02", "2026-07-01", "2026-06-30", "2026-06-29", "2026-06-28", "2026-06-27"])
        self.assertEqual([r["total"] for r in a], [7, 0, 4, 3, 0, 0, 2])
        self.assertEqual(next(r["total"] for r in pages["warehouseStatusMatrix"]["rows"] if r["rowKey"] == "仓库甲"), 44)
        self.assertEqual(sum(r["total"] for r in details["rows"]), 27)
        self.assertEqual(next(r for r in details["rows"] if r["warehouse"] == "(未设定)" and r["date"] == "2026-07-03")["total"], 6)

    def test_short_range_and_combined_filters_match_independent_sql(self):
        options = dict(start="2026-06-30", end="2026-07-01", statuses=["已发货"],
                       channels=["天猫"], store_short_names=["店甲"], product_codes=["A"], exclude_product_codes=["B"])
        pages = self.pages(**options)
        details = pages["warehouseStatusDaily"]
        self.assertEqual((details["start"], details["end"]), ("2026-06-30", "2026-07-01"))
        expected = self.connection.execute('''SELECT "发货仓", "付款日期", "订单状态明细", sum("销售数量")
            FROM jt WHERE "付款日期" BETWEEN DATE '2026-06-30' AND DATE '2026-07-01'
            AND "订单状态明细" = '已发货' AND "渠道平台" = '天猫' AND "店铺简称" = '店甲'
            AND "商品编码" = 'A' AND "商品编码" <> 'B' GROUP BY 1,2,3''').fetchall()
        nonzero = [(r["warehouse"], date.fromisoformat(r["date"]), s, n)
                   for r in details["rows"] for s, n in r["values"].items() if n]
        self.assertEqual(nonzero, expected)
        self.assertEqual(sum(r["total"] for r in details["rows"]), pages["warehouseStatusMatrix"]["rows"][0]["total"])

    def test_latest_day_does_not_shift_with_dimension_filter(self):
        details = self.pages(channels=["天猫"], statuses=["已发货"])["warehouseStatusDaily"]
        self.assertEqual(details["end"], "2026-07-03")
        self.assertEqual(details["rows"][0]["total"], 0)

    def test_uncovered_days_are_not_zero(self):
        details = self.pages(start="2026-07-01", end="2026-07-05")["warehouseStatusDaily"]
        self.assertIn("未覆盖", details["message"])
        self.assertTrue(all(r["total"] is None for r in details["rows"] if r["date"] > "2026-07-03"))
        self.assertTrue(all(r["total"] == 0 for r in details["rows"] if r["date"] == "2026-07-02"))

    def test_empty_selection_retains_range(self):
        details = self.pages(start="2026-07-01", end="2026-07-03", product_codes=["missing"])["warehouseStatusDaily"]
        self.assertEqual(details["rows"], [])
        self.assertEqual(details["end"], "2026-07-03")

    def test_missing_payment_column_never_substitutes_order_date(self):
        self.connection.execute('ALTER TABLE jt DROP COLUMN "付款日期"')
        details = self.pages()["warehouseStatusDaily"]
        self.assertEqual(details["rows"], [])
        self.assertIn("缺少付款日期", details["message"])

    def test_all_payment_dates_null(self):
        self.connection.execute('UPDATE jt SET "付款日期" = NULL')
        details = self.pages()["warehouseStatusDaily"]
        self.assertEqual(details["rows"], [])
        self.assertIn("暂无有效付款日期", details["message"])


if __name__ == "__main__":
    unittest.main()
