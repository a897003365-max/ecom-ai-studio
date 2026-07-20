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

    def test_jushuitan_matches_pbix_filters_and_status_priority(self) -> None:
        """The local product dataset must retain the PBIX M-query population and statuses."""

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
        source = Path(__file__)
        rows = [
            ("发货", "普通订单", 100, "麻大师床垫", "正常店", "", None, "2026/7/2 12:00:00", None, None, "已发货", "2026/7/1 10:00:00"),
            ("仅退款", "普通订单", 100, "麻大师床垫", "正常店", "", "仅退款", "2026/7/2 12:00:00", None, None, "已发货", "2026/7/1 10:00:00"),
            ("退货退款", "普通订单", 100, "麻大师床垫", "正常店", "", "普通退货", "2026/7/2 12:00:00", None, None, "已发货", "2026/7/1 10:00:00"),
            ("等通知", "普通订单", 100, "麻大师床垫", "正常店", "", None, None, None, "紫", "异常", "2026/7/1 10:00:00"),
            ("指定日", "普通订单", 100, "麻大师床垫", "正常店", "", None, None, None, "黄", "异常", "2026/7/1 10:00:00"),
            ("待发", "普通订单", 100, "麻大师床垫", "正常店", "", None, None, None, None, "发货中(打单拣货)", "2026/7/1 10:00:00"),
            ("未付款", "普通订单", 100, "麻大师床垫", "正常店", "", None, None, None, None, "待付款", None),
            ("促销零", "普通订单", 100, "0.01入会专拍链接", "正常店", "", None, None, None, None, "已发货", "2026/7/1 10:00:00"),
            ("非普通", "换货订单", 100, "麻大师床垫", "正常店", "", None, None, None, None, "已发货", "2026/7/1 10:00:00"),
            ("低实付", "普通订单", 49, "麻大师床垫", "正常店", "", None, None, None, None, "已发货", "2026/7/1 10:00:00"),
            ("排除店", "普通订单", 100, "麻大师床垫", "伊凯琳家具旗舰店-周飞-猫1", "", None, None, None, None, "已发货", "2026/7/1 10:00:00"),
            ("返修", "普通订单", 100, "麻大师床垫", "正常店", "请返修", None, None, None, None, "已发货", "2026/7/1 10:00:00"),
        ]
        frame = pl.DataFrame(
            {
                "内部订单号": [row[0] for row in rows],
                "订单类型": [row[1] for row in rows],
                "买家实付": [row[2] for row in rows],
                "线上商品名": [row[3] for row in rows],
                "店铺": [row[4] for row in rows],
                "买家留言": [row[5] for row in rows],
                "售后分类": [row[6] for row in rows],
                "发货日期": [row[7] for row in rows],
                "确认收货日期": [row[8] for row in rows],
                "小旗": [row[9] for row in rows],
                "订单状态": [row[10] for row in rows],
                "付款日期": [row[11] for row in rows],
                "订单日期": ["2026/7/1 10:00:00"] * len(rows),
                "商品编码": [f"SKU-{index}" for index in range(len(rows))],
                "商品简称": [row[3] for row in rows],
                "销售数量": [2] * len(rows),
                "实发数量": [2] * len(rows),
                "实发金额": [200] * len(rows),
                "销售金额": [200] * len(rows),
                "商家实收": [180] * len(rows),
            }
        )

        transformed = transform_source_file(frame, spec, source)

        self.assertEqual(transformed["内部订单号"].to_list(), [row[0] for row in rows[:7]])
        self.assertEqual(
            transformed["订单状态明细"].to_list(),
            ["已发货", "交易关闭（仅退款）", "交易关闭（退货退款）", "等通知", "指定日", "待发货", "未付款"],
        )
        self.assertEqual(
            transformed["订单状态汇总"].to_list(),
            ["已发", "未付款或交易关闭", "未付款或交易关闭", "待发", "待发", "待发", "未付款或交易关闭"],
        )
        self.assertEqual(transformed["销售数量"].to_list(), [2.0] * 7)
        self.assertTrue({"买家留言", "售后分类", "小旗"}.isdisjoint(transformed.columns))


class CatalogTests(unittest.TestCase):
    def test_exported_manifest_has_all_m_queries(self) -> None:
        paths = WarehousePaths.discover()
        manifest, queries = load_catalog(paths.manifest)
        # 25 个 PowerBI 推广报表 M 查询 + 1 个手写的聚水潭商品数据查询（来自另一个 pbix）
        self.assertEqual(manifest["queryCount"], 27)
        self.assertEqual(len(queries), 27)
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
        # 27 总查询 - 2 钉钉权威排除 = 25 个活跃查询
        self.assertEqual(len(selected), 25)

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

        # 每个 PowerBI unique domain 查询都必须被保留（未被钉钉排除）。
        self.assertTrue(domain_queries.issubset({item.name for item in selected}))
        # 保留查询不必全部属于 PowerBI domain：聚水潭商品数据来自另一个 pbix，
        # 喂给独立的 productManagement 快照段，不在 POWERBI_UNIQUE_DOMAINS 内。
        self.assertIn("15-聚水潭商品数据", {item.name for item in selected})
        self.assertNotIn("15-聚水潭商品数据", domain_queries)


if __name__ == "__main__":
    unittest.main()
