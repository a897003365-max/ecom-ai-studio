from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

import duckdb
import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecom_pipeline.catalog import QuerySpec  # noqa: E402
from ecom_pipeline.transforms import transform_source_file  # noqa: E402
from ecom_pipeline.warehouse import _build_product_management_pages  # noqa: E402


def _query_spec(name: str) -> QuerySpec:
    return QuerySpec(
        index=1,
        name=name,
        m_file="",
        source_kind="folder",
        source_paths=(),
        sheet_name=None,
        promote_headers=True,
        schema=(),
        operations=(),
    )


class ProductIdentityAndChannelTransformTests(unittest.TestCase):
    def test_product_master_keeps_authoritative_product_name(self) -> None:
        transformed = transform_source_file(
            pl.DataFrame(
                {
                    "商家规编（后台）": ["SKU-A"],
                    "SKUid": ["JD-ITEM"],
                    "产品名称": ["云栖青床垫"],
                    "床垫类别": ["弹簧床垫"],
                    "成本": [500.0],
                    "尺寸": ["180*200"],
                }
            ),
            _query_spec("product-master"),
            Path(__file__),
        )

        self.assertEqual(transformed["商品编码"].to_list(), ["SKU-A"])
        self.assertEqual(transformed["商品ID"].to_list(), ["JD-ITEM"])
        self.assertEqual(transformed["产品名称"].to_list(), ["云栖青床垫"])

    def test_jushuitan_derives_pbix_channel_platform_from_site(self) -> None:
        sites = ["头条放心购", "京东厂家直送", "京东商城", "淘宝天猫", "淘宝天猫", "京东商城"]
        with patch(
            "ecom_pipeline.transforms._offline_suborder_ids",
            return_value=frozenset({"OFFLINE-ORDER"}),
        ):
            transformed = transform_source_file(
                pl.DataFrame(
                    {
                        "内部订单号": [f"O-{index}" for index in range(len(sites))],
                        "订单类型": ["普通订单"] * len(sites),
                        "买家实付": [100.0] * len(sites),
                        "线上商品名": ["云栖青床垫"] * len(sites),
                        "商品编码": [f"SKU-{index}" for index in range(len(sites))],
                        "商品简称": ["豆7"] * len(sites),
                        "店铺": ["测试店铺"] * len(sites),
                        "商店站点": sites,
                        "线上子订单编号": ["", "", "", "", "", "OFFLINE-ORDER"],
                        "买家留言": [""] * len(sites),
                        "卖家备注": ["", "", "", "", "线下补单 M0", ""],
                        "售后分类": [None] * len(sites),
                        "发货日期": ["2026/7/2 12:00:00"] * len(sites),
                        "确认收货日期": [None] * len(sites),
                        "小旗": [None] * len(sites),
                        "订单状态": ["已发货"] * len(sites),
                        "付款日期": ["2026/7/1 10:00:00"] * len(sites),
                        "订单日期": ["2026/7/1 10:00:00"] * len(sites),
                        "销售数量": [1.0] * len(sites),
                        "实发数量": [1.0] * len(sites),
                        "实发金额": [100.0] * len(sites),
                        "销售金额": [100.0] * len(sites),
                        "商家实收": [90.0] * len(sites),
                    }
                ),
                _query_spec("15-聚水潭商品数据"),
                Path(__file__),
            )

        self.assertEqual(
            transformed["渠道平台"].to_list(),
            ["抖音", "京东自营", "京东POP", "淘宝天猫", "新零售", "新零售"],
        )

    def test_jushuitan_derives_pbix_store_short_name_for_daren_and_new_retail(self) -> None:
        stores = [
            "麻大师旗舰店-龚敢-猫3",
            "麻大师官方旗舰店-龚敢-抖1",
            "麻大师官方旗舰店-龚敢-抖1",
            "麻大师旗舰店-龚敢-猫3",
        ]
        with patch(
            "ecom_pipeline.transforms._store_short_name_mapping",
            return_value={
                "麻大师旗舰店-龚敢-猫3": "天猫旗舰店",
                "麻大师官方旗舰店-龚敢-抖1": "麻大师官方旗舰店",
            },
        ):
            transformed = transform_source_file(
                pl.DataFrame(
                    {
                        "内部订单号": [f"S-{index}" for index in range(len(stores))],
                        "订单类型": ["普通订单"] * len(stores),
                        "买家实付": [100.0] * len(stores),
                        "线上商品名": ["云栖青床垫"] * len(stores),
                        "商品编码": [f"SKU-{index}" for index in range(len(stores))],
                        "店铺": stores,
                        "商店站点": ["淘宝天猫", "头条放心购", "头条放心购", "淘宝天猫"],
                        "达人名称": [None, "麻大师床垫官方直播间", "与辉同行", None],
                        "线上子订单编号": ["", "", "", ""],
                        "卖家备注": ["", "", "", "线下补单 M0"],
                        "买家留言": [""] * len(stores),
                        "售后分类": [None] * len(stores),
                        "发货日期": ["2026/7/2 12:00:00"] * len(stores),
                        "确认收货日期": [None] * len(stores),
                        "小旗": [None] * len(stores),
                        "订单状态": ["已发货"] * len(stores),
                        "付款日期": ["2026/7/1 10:00:00"] * len(stores),
                        "订单日期": ["2026/7/1 10:00:00"] * len(stores),
                        "销售数量": [1.0] * len(stores),
                    }
                ),
                _query_spec("15-聚水潭商品数据"),
                Path(__file__),
            )

        self.assertEqual(transformed["店铺简称"].to_list(), ["天猫旗舰店", "抖2", "与辉同行", "新零售"])
        self.assertEqual(
            transformed["店铺简称（结算店铺）"].to_list(),
            ["天猫旗舰店", "抖2", "与辉同行", "天猫旗舰店"],
        )
        self.assertEqual(transformed["渠道平台"].to_list(), ["淘宝天猫", "抖音", "抖音", "新零售"])


class ProductIdentityAndChannelWarehouseTests(unittest.TestCase):
    def test_dashboard_uses_product_master_name_and_source_channel_platform(self) -> None:
        source = pl.DataFrame(
            {
                "订单状态明细": ["已发货", "已发货"],
                "订单日期": [date(2026, 7, 1)] * 2,
                "商品编码": ["SKU-A", "69-CODE"],
                "店铺商品编码": ["", "JD-ITEM"],
                "商品简称": ["豆7", "京东简称"],
                "产品分类": ["床垫"] * 2,
                "品牌": ["麻大师"] * 2,
                "销售数量": [2.0, 3.0],
                "实发数量": [2.0, 3.0],
                "实发金额": [200.0, 300.0],
                "销售金额": [200.0, 300.0],
                "退货数量": [0.0, 0.0],
                "退货金额": [0.0, 0.0],
                "商家实收": [180.0, 270.0],
                "买家实付": [200.0, 300.0],
                "平台补贴金额": [0.0, 0.0],
                "店铺": ["麻大师旗舰店-龚敢-猫3", "麻大师床垫京东自营旗舰店-龚敢-京5"],
                "店铺简称": ["天猫旗舰店", "京东自营"],
                "渠道平台": ["淘宝天猫", "京东自营"],
                "达人名称": [None, None],
                "发货仓": ["华东仓", "华东仓"],
                "订单状态": ["已发货", "已发货"],
            }
        )
        product_master = pl.DataFrame(
            {
                "商品编码": ["SKU-A", "JD-SKU"],
                "商品ID": [None, "JD-ITEM"],
                "产品名称": ["云栖青床垫", "京东云栖床垫"],
                "床垫类别": ["弹簧床垫", "弹簧床垫"],
                "成本": [50.0, 60.0],
            }
        )
        connection = duckdb.connect()
        try:
            connection.register("jt_rows", source.to_arrow())
            connection.register("pm_rows", product_master.to_arrow())
            connection.execute("CREATE VIEW jt_model AS SELECT * FROM jt_rows")
            connection.execute("CREATE VIEW pm_model AS SELECT * FROM pm_rows")
            connection.execute(
                "CREATE TABLE warehouse_query_catalog (query_name VARCHAR, source_view VARCHAR, model_view VARCHAR)"
            )
            connection.execute(
                "INSERT INTO warehouse_query_catalog VALUES "
                "('15-聚水潭商品数据', 'jt_model', 'jt_model'), "
                "('product-master', 'pm_model', 'pm_model')"
            )

            pages = _build_product_management_pages(connection)

            overview_names = {row["productCode"]: row["productName"] for row in pages["productOverview"]}
            return_names = {row["productName"] for row in pages["returnRanking"]}
            product_names = {row["productName"] for row in pages["productNameOverview"]}
            self.assertEqual(overview_names["SKU-A"], "云栖青床垫")
            self.assertEqual(overview_names["69-CODE"], "京东云栖床垫")
            self.assertIn("京东云栖床垫", return_names)
            self.assertEqual(product_names, {"云栖青床垫", "京东云栖床垫"})
            self.assertEqual({row["channel"] for row in pages["channelBreakdown"]}, {"淘宝天猫", "京东自营"})
            self.assertIn("淘宝天猫", pages["dailyChannelMatrix"]["columns"])
            self.assertEqual(
                {row["rowKey"] for row in pages["productChannelMatrix"]["rows"]},
                {"云栖青床垫", "京东云栖床垫"},
            )
            self.assertEqual(
                {row["rowKey"] for row in pages["productStatusMatrix"]["rows"]},
                {"云栖青床垫", "京东云栖床垫"},
            )
            self.assertEqual(set(pages["availableChannels"]), {"淘宝天猫", "京东自营"})
            self.assertEqual(set(pages["availableStoreShortNames"]), {"天猫旗舰店", "京东自营"})

            filtered = _build_product_management_pages(
                connection,
                channels=["京东自营"],
                store_short_names=["京东自营"],
            )
            self.assertEqual(filtered["kpis"]["totalSalesUnits"], 3.0)
            self.assertEqual(filtered["channelBreakdown"][0]["channel"], "京东自营")
        finally:
            connection.close()


if __name__ == "__main__":
    unittest.main()
