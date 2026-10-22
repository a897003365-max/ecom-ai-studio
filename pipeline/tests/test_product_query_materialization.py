from __future__ import annotations

from datetime import date
from pathlib import Path
import sys
import tempfile
import unittest

import duckdb
import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ecom_pipeline.warehouse import _build_product_management_pages


class ProductQueryMaterializationTests(unittest.TestCase):
    def test_read_only_connection_preserves_previous_shipping_and_id_scope(self):
        orders = pl.DataFrame({
            '商品编码': ['SKU-A'] * 3,
            '商品简称': ['产品 A'] * 3,
            '产品分类': ['床垫'] * 3,
            '品牌': ['麻大师'] * 3,
            '订单日期': [date(2026, 6, 30), date(2026, 7, 1), date(2026, 7, 5)],
            '付款日期': [date(2026, 6, 30), date(2026, 7, 1), date(2026, 7, 5)],
            '发货日期': [date(2026, 7, 3), date(2026, 7, 2), None],
            '线上订单号': ['A', 'B', 'C'],
            '销售数量': [7.0, 2.0, 3.0],
            '销售金额': [700.0, 200.0, 300.0],
            '商家实收': [630.0, 180.0, 270.0],
            '买家实付': [700.0, 200.0, 300.0],
            '退货金额': [0.0, 10.0, 0.0],
            '退货数量': [0.0] * 3,
            '平台补贴金额': [0.0] * 3,
            '订单状态明细': ['已发货', '已发货', '待发货'],
            '订单状态': ['已发货', '已发货', '待发货'],
            '店铺': ['店铺甲'] * 3,
            '店铺简称': ['店铺甲'] * 3,
            '渠道平台': ['天猫'] * 3,
            '发货仓': ['华东仓'] * 3,
            '达人名称': [None] * 3,
            '颜色规格': ['1500*2000'] * 3,
            '是否定制': [False, True, False],
            '定制备注标签': [None, '其他定制', None],
        })
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / 'warehouse.duckdb'
            with duckdb.connect(str(database)) as connection:
                connection.register('orders', orders.to_arrow())
                connection.execute('CREATE TABLE jt AS SELECT * FROM orders')
                connection.execute('''CREATE TABLE pm_source AS SELECT * FROM (VALUES
                    ('SKU-A', 'ID-A', '产品 A', 10.0, '弹簧床垫'),
                    ('SKU-A', 'ID-B', '产品 A', 10.0, '弹簧床垫')
                ) t("商品编码", "商品ID", "产品名称", "成本", "床垫类别")''')
                connection.execute('CREATE VIEW pm AS SELECT * FROM pm_source WHERE "商品ID" = \'ID-A\'')
                connection.execute('''CREATE TABLE q18 AS SELECT 'SKU-A' AS "商家规编（后台）",
                    'SPU-A' AS "SPU产品商编", '产品 A' AS "产品名称",
                    '1500*2000' AS "尺寸", '弹簧床垫' AS "床垫类别"''')
                connection.execute('CREATE TABLE warehouse_query_catalog (query_name VARCHAR, source_view VARCHAR, model_view VARCHAR)')
                connection.executemany('INSERT INTO warehouse_query_catalog VALUES (?, ?, ?)', [
                    ('15-聚水潭商品数据', 'jt', 'jt'),
                    ('product-master', 'pm_source', 'pm'),
                    ('辅4-床垫编码', 'q18', 'q18'),
                ])
            original_bytes = database.read_bytes()
            with duckdb.connect(str(database), read_only=True) as connection:
                payload = _build_product_management_pages(connection, start='2026-07-01', end='2026-07-03', product_ids=['ID-B'])
                self.assertEqual(payload['kpis']['totalSalesUnits'], 2)
                self.assertEqual(payload['monthlyComparison']['current']['salesUnits'], 2)
                self.assertEqual(payload['monthlyComparison']['previous']['salesUnits'], 7)
                self.assertEqual(payload['kpis']['customRate'], 1)
                self.assertEqual(sum(row['total'] for row in payload['dailyShipWarehouseMatrix']['rows']), 9)
                for name in ('priceStructure', 'sizeStructure', 'spuSalesTrend', 'customizationStructure'):
                    self.assertNotEqual(payload[name]['quality']['status'], 'unavailable', name)
                empty = _build_product_management_pages(connection, start='2026-07-01', end='2026-07-03', exclude_product_ids=['ID-B'])
                self.assertEqual(empty['kpis']['orderLines'], 0)
                self.assertEqual(empty['productChannelMatrix'], {'columns': [], 'rows': []})
                self.assertEqual(empty['dailyShipWarehouseMatrix'], {'columns': [], 'rows': []})
                later = _build_product_management_pages(connection, start='2026-07-05', end='2026-07-05')
                self.assertEqual(later['kpis']['totalSalesUnits'], 3)
                self.assertEqual(later['kpis']['pendingUnits'], 3)
                self.assertEqual(connection.execute('SELECT count(*) FROM jt').fetchone()[0], 3)
            self.assertEqual(database.read_bytes(), original_bytes)


if __name__ == '__main__':
    unittest.main()
