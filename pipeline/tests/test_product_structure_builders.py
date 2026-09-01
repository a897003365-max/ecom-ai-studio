"""Phase 1 测试：商品管理新增四模块的空结构 schema 与模块隔离。

Phase 2+ 才填充实现，此处只保证边界与契约稳定：4 个 empty 返回固定字段，
build_product_structure_modules 返回 4 个模块，单模块异常不阻塞其余模块。
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import duckdb
import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecom_pipeline.product_structure_builders import (  # noqa: E402
    build_customization_structure,
    build_price_structure,
    build_product_structure_modules,
    build_size_structure,
    build_spu_sales_trend,
    empty_customization_structure,
    empty_price_structure,
    empty_size_structure,
    empty_spu_sales_trend,
)


class EmptyStructureSchemaTests(unittest.TestCase):
    def test_empty_price_structure_has_fixed_schema(self) -> None:
        result = empty_price_structure()
        self.assertEqual(result["formula"], "商家实收 / 销售数量")
        self.assertEqual(result["buckets"], [])
        self.assertEqual(result["validOrderLines"], 0)
        self.assertEqual(result["excludedOrderLines"], 0)
        self.assertEqual(result["totalReceivedAmount"], 0)
        for key in ("channelMatrix", "mattressCategoryMatrix", "topProductMatrix"):
            self.assertEqual(result[key], {"columns": [], "rows": []})
        self.assertEqual(result["quality"]["status"], "unavailable")
        self.assertIsInstance(result["quality"]["warnings"], list)

    def test_empty_size_structure_has_fixed_schema(self) -> None:
        result = empty_size_structure()
        self.assertEqual(result["sizes"], [])
        self.assertEqual(result["unknownSize"]["size"], "未填写尺寸")
        self.assertEqual(result["unknownSize"]["source"], "unknown")
        self.assertEqual(result["recognizedOrderLines"], 0)
        self.assertEqual(result["totalOrderLines"], 0)
        for key in ("mattressCategoryMatrix", "topProductMatrix"):
            self.assertEqual(result[key], {"columns": [], "rows": []})
        self.assertEqual(result["quality"]["status"], "unavailable")

    def test_empty_spu_sales_trend_has_fixed_schema(self) -> None:
        result = empty_spu_sales_trend()
        self.assertEqual(result["dailySpuTrend"], [])
        self.assertEqual(result["categoryDailyTrend"], [])
        self.assertEqual(result["availableSpus"], [])
        self.assertEqual(result["defaultSpus"], [])
        self.assertEqual(result["summaries"], [])
        self.assertEqual(result["spuChannelMatrix"], {"columns": [], "rows": []})
        self.assertEqual(result["quality"]["status"], "unavailable")

    def test_empty_customization_structure_has_fixed_schema(self) -> None:
        result = empty_customization_structure()
        self.assertEqual(result["comparison"], [])
        self.assertEqual(result["tags"], [])
        self.assertEqual(result["topProducts"], [])
        self.assertEqual(result["categoryStructure"], [])
        self.assertEqual(result["spuSummary"], [])
        self.assertIn("卖家备注", result["derivationNote"])
        self.assertEqual(result["quality"]["status"], "unavailable")


class BuildModulesTests(unittest.TestCase):
    def test_build_modules_returns_four_fields(self) -> None:
        result = build_product_structure_modules(connection=None, view="_jt", base_view="base", pm_view=None, pm_columns=set(), q18_view=None, q18_columns=set())
        self.assertEqual(
            set(result.keys()),
            {"priceStructure", "sizeStructure", "spuSalesTrend", "customizationStructure"},
        )
        self.assertEqual(result["priceStructure"]["quality"]["status"], "unavailable")

    def test_build_modules_isolates_failure(self) -> None:
        """单 builder 抛异常时，该模块返回 unavailable 空结构，其余模块不受影响。"""
        from ecom_pipeline import product_structure_builders as module

        original = module.build_price_structure

        def _raise(*_args):
            raise RuntimeError("boom")

        module.build_price_structure = _raise  # type: ignore[assignment]
        try:
            result = build_product_structure_modules(connection=None, view="_jt", base_view="base", pm_view=None, pm_columns=set(), q18_view=None, q18_columns=set())
        finally:
            module.build_price_structure = original  # type: ignore[assignment]

        self.assertEqual(result["priceStructure"]["quality"]["status"], "unavailable")
        self.assertIn("RuntimeError", result["priceStructure"]["quality"]["warnings"][0])
        # 其余模块仍正常返回空结构
        self.assertEqual(result["sizeStructure"]["quality"]["status"], "unavailable")
        self.assertEqual(result["spuSalesTrend"]["quality"]["status"], "unavailable")


class PriceStructureTests(unittest.TestCase):
    """Phase 2 价格结构：边界、无效行、占比、多件单价、TOP15 排序。"""

    def _make_connection(self, frame: pl.DataFrame, pm_frame: pl.DataFrame | None = None):
        con = duckdb.connect()
        con.register("jt_rows", frame.to_arrow())
        con.execute("CREATE VIEW jt_view AS SELECT * FROM jt_rows")
        pm_view: str | None = None
        if pm_frame is not None:
            con.register("pm_rows", pm_frame.to_arrow())
            con.execute('CREATE VIEW pm_view AS SELECT * FROM pm_rows')
            pm_view = '"pm_view"'
        return con, pm_view

    def test_price_excludes_non_positive_and_bucket_boundaries(self) -> None:
        frame = pl.DataFrame(
            {
                "商品编码": ["B1000", "B1001", "B1500", "B1501", "B4001", "Z0", "ZNEG", "ZNUL", "ZQ0", "ZQNUL"],
                "商家实收": [1000.0, 1001.0, 1500.0, 1501.0, 4001.0, 0.0, -100.0, None, 100.0, 100.0],
                "销售数量": [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, None],
                "渠道平台": ["天猫"] * 10,
            }
        )
        con, _ = self._make_connection(frame)
        try:
            result = build_price_structure(con, "jt_view", "jt_view", None, set(), None, set())
            self.assertEqual(result["validOrderLines"], 5)
            self.assertEqual(result["excludedOrderLines"], 5)
            self.assertEqual(result["quality"]["status"], "ready")
            self.assertEqual(len(result["buckets"]), 7)
            by_label = {b["label"]: b for b in result["buckets"]}
            self.assertEqual(by_label["1000以下"]["orderLines"], 1)
            self.assertEqual(by_label["1001–1500"]["orderLines"], 2)
            self.assertEqual(by_label["1501–2000"]["orderLines"], 1)
            self.assertEqual(by_label["4000以上"]["orderLines"], 1)
            self.assertEqual(by_label["2501–3000"]["orderLines"], 0)
        finally:
            con.close()

    def test_price_shares_sum_to_one(self) -> None:
        frame = pl.DataFrame(
            {
                "商品编码": ["A", "B", "C", "D", "E", "F", "G"],
                "商家实收": [500.0, 1200.0, 1800.0, 2200.0, 2800.0, 3500.0, 5000.0],
                "销售数量": [1.0] * 7,
                "渠道平台": ["天猫"] * 7,
            }
        )
        con, _ = self._make_connection(frame)
        try:
            result = build_price_structure(con, "jt_view", "jt_view", None, set(), None, set())
            self.assertAlmostEqual(sum(b["orderLineShare"] for b in result["buckets"]), 1.0, places=6)
            self.assertAlmostEqual(sum(b["receivedAmountShare"] for b in result["buckets"]), 1.0, places=6)
            self.assertEqual(result["excludedOrderLines"], 0)
        finally:
            con.close()

    def test_price_multi_quantity_unit_price(self) -> None:
        # recv=3000, qty=2 -> 单件 1500 -> 1001–1500
        frame = pl.DataFrame(
            {
                "商品编码": ["M"],
                "商家实收": [3000.0],
                "销售数量": [2.0],
                "渠道平台": ["天猫"],
            }
        )
        con, _ = self._make_connection(frame)
        try:
            result = build_price_structure(con, "jt_view", "jt_view", None, set(), None, set())
            by_label = {b["label"]: b for b in result["buckets"]}
            self.assertEqual(by_label["1001–1500"]["orderLines"], 1)
            self.assertEqual(result["validOrderLines"], 1)
        finally:
            con.close()

    def test_price_channel_matrix_shares(self) -> None:
        frame = pl.DataFrame(
            {
                "商品编码": ["A", "B", "C", "D"],
                "商家实收": [500.0, 5000.0, 1200.0, 1800.0],
                "销售数量": [1.0] * 4,
                "渠道平台": ["天猫", "天猫", "京东", "京东"],
            }
        )
        con, _ = self._make_connection(frame)
        try:
            result = build_price_structure(con, "jt_view", "jt_view", None, set(), None, set())
            m = result["channelMatrix"]
            row_by_key = {r["rowKey"]: r for r in m["rows"]}
            self.assertEqual(row_by_key["天猫"]["orderLines"], 2)
            self.assertAlmostEqual(row_by_key["天猫"]["shares"]["1000以下"], 0.5, places=6)
            self.assertAlmostEqual(row_by_key["天猫"]["shares"]["4000以上"], 0.5, places=6)
            for r in m["rows"]:
                self.assertAlmostEqual(sum(r["shares"].values()), 1.0, places=6)
        finally:
            con.close()

    def test_price_top15_ordered_by_received_desc(self) -> None:
        frame = pl.DataFrame(
            {
                "商品编码": ["A1", "A2", "B1", "B2", "C1"],
                "商家实收": [1000.0, 1000.0, 2000.0, 2000.0, 500.0],
                "销售数量": [1.0] * 5,
                "渠道平台": ["天猫"] * 5,
            }
        )
        pm = pl.DataFrame(
            {
                "商品编码": ["A1", "A2", "B1", "B2", "C1"],
                "产品名称": ["PA", "PA", "PB", "PB", "PC"],
                "床垫类别": ["弹簧", "弹簧", "黄麻", "黄麻", "弹簧"],
            }
        )
        con, pm_view = self._make_connection(frame, pm)
        try:
            result = build_price_structure(con, "jt_view", "jt_view", pm_view, {"产品名称", "床垫类别"}, None, set())
            m = result["topProductMatrix"]
            keys = [r["rowKey"] for r in m["rows"]]
            self.assertEqual(keys, ["PB", "PA", "PC"])  # 4000 > 2000 > 500
            self.assertLessEqual(len(m["rows"]), 15)
        finally:
            con.close()

    def test_price_zero_quantity_excluded_from_amount_share(self) -> None:
        """销量为 0 的正实收行是无效行，其金额不得进入金额占比分母。"""
        frame = pl.DataFrame(
            {
                "商品编码": ["A", "B"],
                "商家实收": [1000.0, 2000.0],
                "销售数量": [1.0, 0.0],
                "渠道平台": ["天猫", "天猫"],
            }
        )
        con, _ = self._make_connection(frame)
        try:
            result = build_price_structure(con, "jt_view", "jt_view", None, set(), None, set())
            self.assertEqual(result["validOrderLines"], 1)
            self.assertEqual(result["excludedOrderLines"], 1)
            by_label = {b["label"]: b for b in result["buckets"]}
            self.assertEqual(by_label["1000以下"]["receivedAmount"], 1000.0)
            self.assertAlmostEqual(by_label["1000以下"]["receivedAmountShare"], 1.0, places=6)
            self.assertAlmostEqual(sum(b["receivedAmountShare"] for b in result["buckets"]), 1.0, places=6)
        finally:
            con.close()


class SizeStructureTests(unittest.TestCase):
    """Phase 3 尺寸结构：优先级、标准化、unknown、占比分母。"""

    def _make_connection(self, frame: pl.DataFrame, pm_frame: pl.DataFrame | None = None, q18_frame: pl.DataFrame | None = None):
        con = duckdb.connect()
        con.register("jt_rows", frame.to_arrow())
        con.execute("CREATE VIEW jt_view AS SELECT * FROM jt_rows")
        pm_view: str | None = None
        pm_cols: set[str] = set()
        if pm_frame is not None:
            con.register("pm_rows", pm_frame.to_arrow())
            con.execute('CREATE VIEW pm_view AS SELECT * FROM pm_rows')
            pm_view = '"pm_view"'
            pm_cols = set(pm_frame.columns)
        q18_view: str | None = None
        q18_cols: set[str] = set()
        if q18_frame is not None:
            con.register("q18_rows", q18_frame.to_arrow())
            con.execute('CREATE VIEW q18_view AS SELECT * FROM q18_rows')
            q18_view = '"q18_view"'
            q18_cols = set(q18_frame.columns)
        return con, pm_view, pm_cols, q18_view, q18_cols

    def test_size_prioritizes_q18_over_color_spec(self) -> None:
        frame = pl.DataFrame(
            {
                "商品编码": ["A"],
                "商家实收": [1000.0],
                "销售数量": [1.0],
                "颜色规格": ["1800MM*2000MM"],
            }
        )
        q18 = pl.DataFrame({"商家规编（后台）": ["A"], "尺寸": ["1500mm*2000mm"]})
        con, pm_view, pm_cols, q18_view, q18_cols = self._make_connection(frame, q18_frame=q18)
        try:
            result = build_size_structure(con, "jt_view", "jt_view", pm_view, pm_cols, q18_view, q18_cols)
            self.assertEqual(len(result["sizes"]), 1)
            self.assertEqual(result["sizes"][0]["size"], "1500×2000mm")
            self.assertEqual(result["sizes"][0]["source"], "q18")
        finally:
            con.close()

    def test_size_normalizes_cm_to_mm_and_orders_width_length(self) -> None:
        frame = pl.DataFrame(
            {
                "商品编码": ["A"],
                "商家实收": [1000.0],
                "销售数量": [1.0],
                "颜色规格": ["200*180CM"],  # cm + 倒序，应标准化为 1800×2000mm
            }
        )
        con, pm_view, pm_cols, q18_view, q18_cols = self._make_connection(frame)
        try:
            result = build_size_structure(con, "jt_view", "jt_view", pm_view, pm_cols, q18_view, q18_cols)
            self.assertEqual(result["sizes"][0]["size"], "1800×2000mm")
            self.assertEqual(result["sizes"][0]["source"], "colorSpec")
        finally:
            con.close()

    def test_size_unknown_when_no_spec(self) -> None:
        frame = pl.DataFrame(
            {
                "商品编码": ["A"],
                "商家实收": [1000.0],
                "销售数量": [1.0],
                "颜色规格": [None],
            }
        )
        con, pm_view, pm_cols, q18_view, q18_cols = self._make_connection(frame)
        try:
            result = build_size_structure(con, "jt_view", "jt_view", pm_view, pm_cols, q18_view, q18_cols)
            self.assertEqual(result["unknownSize"]["orderLines"], 1)
            self.assertEqual(len(result["sizes"]), 0)
            self.assertEqual(result["quality"]["status"], "degraded")
        finally:
            con.close()

    def test_size_share_denominator_includes_unknown(self) -> None:
        frame = pl.DataFrame(
            {
                "商品编码": ["A", "B", "C"],
                "商家实收": [1000.0, 1000.0, 1000.0],
                "销售数量": [1.0, 1.0, 1.0],
                "颜色规格": ["1800MM*2000MM", "1500MM*2000MM", None],
            }
        )
        con, pm_view, pm_cols, q18_view, q18_cols = self._make_connection(frame)
        try:
            result = build_size_structure(con, "jt_view", "jt_view", pm_view, pm_cols, q18_view, q18_cols)
            self.assertEqual(result["totalOrderLines"], 3)
            self.assertEqual(result["unknownSize"]["orderLines"], 1)
            total_share = sum(s["orderLineShare"] for s in result["sizes"]) + result["unknownSize"]["orderLineShare"]
            self.assertAlmostEqual(total_share, 1.0, places=6)
            # 销量占比与订单行占比同口径：分母含未填写尺寸，加总为 1
            total_units_share = sum(s["salesUnitsShare"] for s in result["sizes"]) + result["unknownSize"]["salesUnitsShare"]
            self.assertAlmostEqual(total_units_share, 1.0, places=6)
        finally:
            con.close()

    def test_size_q18_coverage_reported(self) -> None:
        frame = pl.DataFrame(
            {
                "商品编码": ["A", "B"],
                "商家实收": [1000.0, 1000.0],
                "销售数量": [1.0, 1.0],
                "颜色规格": ["1800MM*2000MM", "1500MM*2000MM"],
            }
        )
        q18 = pl.DataFrame({"商家规编（后台）": ["A"], "尺寸": ["1800mm*2000mm"]})
        con, pm_view, pm_cols, q18_view, q18_cols = self._make_connection(frame, q18_frame=q18)
        try:
            result = build_size_structure(con, "jt_view", "jt_view", pm_view, pm_cols, q18_view, q18_cols)
            cov = result["quality"]["coverage"]
            self.assertEqual(cov["totalOrderLines"], 2)
            self.assertEqual(cov["matchedOrderLines"], 1)  # 仅 A 命中 q18
            self.assertAlmostEqual(cov["orderLineRatio"], 0.5, places=6)
        finally:
            con.close()


class SpuSalesTrendTests(unittest.TestCase):
    """Phase 4 SPU 销量趋势：q18 映射、未识别归集、TOP15、矩阵销量。"""

    def _make_connection(self, frame: pl.DataFrame, q18_frame: pl.DataFrame | None = None):
        con = duckdb.connect()
        con.register("jt_rows", frame.to_arrow())
        con.execute("CREATE VIEW jt_view AS SELECT * FROM jt_rows")
        q18_view: str | None = None
        q18_cols: set[str] = set()
        if q18_frame is not None:
            con.register("q18_rows", q18_frame.to_arrow())
            con.execute('CREATE VIEW q18_view AS SELECT * FROM q18_rows')
            q18_view = '"q18_view"'
            q18_cols = set(q18_frame.columns)
        return con, q18_view, q18_cols

    def test_spu_uses_q18_spu(self) -> None:
        frame = pl.DataFrame(
            {
                "商品编码": ["A", "B"],
                "商家实收": [1000.0, 2000.0],
                "销售数量": [1.0, 2.0],
                "订单日期": ["2026-07-01", "2026-07-01"],
                "渠道平台": ["天猫", "京东"],
            }
        )
        q18 = pl.DataFrame({"商家规编（后台）": ["A", "B"], "SPU产品商编": ["SPU1", "SPU2"]})
        con, q18_view, q18_cols = self._make_connection(frame, q18_frame=q18)
        try:
            result = build_spu_sales_trend(con, "jt_view", "jt_view", None, set(), q18_view, q18_cols)
            spu_set = {s["spu"] for s in result["summaries"]}
            self.assertIn("SPU1", spu_set)
            self.assertIn("SPU2", spu_set)
            self.assertNotIn("未识别 SPU", spu_set)
            self.assertEqual(result["quality"]["status"], "ready")
        finally:
            con.close()

    def test_spu_unknown_when_no_q18(self) -> None:
        frame = pl.DataFrame(
            {
                "商品编码": ["A"],
                "商家实收": [1000.0],
                "销售数量": [1.0],
                "订单日期": ["2026-07-01"],
                "渠道平台": ["天猫"],
            }
        )
        con, q18_view, q18_cols = self._make_connection(frame)
        try:
            result = build_spu_sales_trend(con, "jt_view", "jt_view", None, set(), q18_view, q18_cols)
            self.assertEqual(result["summaries"][0]["spu"], "未识别 SPU")
            self.assertEqual(result["quality"]["status"], "degraded")
        finally:
            con.close()

    def test_spu_top15_default_ordered_by_received(self) -> None:
        codes = [f"A{i}" for i in range(16)]
        spus = [f"SPU{i}" for i in range(16)]
        frame = pl.DataFrame(
            {
                "商品编码": codes,
                "商家实收": [float(i + 1) * 100 for i in range(16)],
                "销售数量": [1.0] * 16,
                "订单日期": ["2026-07-01"] * 16,
                "渠道平台": ["天猫"] * 16,
            }
        )
        q18 = pl.DataFrame({"商家规编（后台）": codes, "SPU产品商编": spus})
        con, q18_view, q18_cols = self._make_connection(frame, q18_frame=q18)
        try:
            result = build_spu_sales_trend(con, "jt_view", "jt_view", None, set(), q18_view, q18_cols)
            self.assertEqual(len(result["defaultSpus"]), 15)
            self.assertEqual(result["defaultSpus"][0], "SPU15")  # receivedAmount 最大
        finally:
            con.close()

    def test_spu_channel_matrix_uses_sales_units(self) -> None:
        frame = pl.DataFrame(
            {
                "商品编码": ["A", "A"],
                "商家实收": [1000.0, 1000.0],
                "销售数量": [2.0, 3.0],
                "订单日期": ["2026-07-01", "2026-07-01"],
                "渠道平台": ["天猫", "京东"],
            }
        )
        q18 = pl.DataFrame({"商家规编（后台）": ["A"], "SPU产品商编": ["SPU1"]})
        con, q18_view, q18_cols = self._make_connection(frame, q18_frame=q18)
        try:
            result = build_spu_sales_trend(con, "jt_view", "jt_view", None, set(), q18_view, q18_cols)
            row = result["spuChannelMatrix"]["rows"][0]
            self.assertEqual(row["rowKey"], "SPU1")
            self.assertEqual(row["values"]["天猫"], 2.0)
            self.assertEqual(row["values"]["京东"], 3.0)
            self.assertEqual(row["total"], 5.0)
        finally:
            con.close()


class CustomizationStructureTests(unittest.TestCase):
    """定制结构：基于「是否定制」字段（对齐 PBI 商家备注打标），4 类标签互斥（折叠 > 横折 > 竖折 > 其他定制）。"""

    def _make_connection(self, frame: pl.DataFrame, pm_frame: pl.DataFrame | None = None, q18_frame: pl.DataFrame | None = None):
        con = duckdb.connect()
        con.register("jt_rows", frame.to_arrow())
        con.execute("CREATE VIEW jt_view AS SELECT * FROM jt_rows")
        pm_view: str | None = None
        pm_cols: set[str] = set()
        if pm_frame is not None:
            con.register("pm_rows", pm_frame.to_arrow())
            con.execute('CREATE VIEW pm_view AS SELECT * FROM pm_rows')
            pm_view = '"pm_view"'
            pm_cols = set(pm_frame.columns)
        q18_view: str | None = None
        q18_cols: set[str] = set()
        if q18_frame is not None:
            con.register("q18_rows", q18_frame.to_arrow())
            con.execute('CREATE VIEW q18_view AS SELECT * FROM q18_rows')
            q18_view = '"q18_view"'
            q18_cols = set(q18_frame.columns)
        return con, pm_view, pm_cols, q18_view, q18_cols

    def test_custom_regular_not_tagged(self) -> None:
        frame = pl.DataFrame(
            {
                "商品编码": ["A"],
                "商家实收": [1000.0],
                "销售数量": [1.0],
                "订单日期": ["2026-07-01"],
                "发货日期": ["2026-07-03"],
                "颜色规格": ["标准款-20cm=针织面料,1800MM*2000MM"],
                "是否定制": [False],
                "定制备注标签": [None],
            }
        )
        con, pm_view, pm_cols, q18_view, q18_cols = self._make_connection(frame)
        try:
            result = build_customization_structure(con, "jt_view", "jt_view", pm_view, pm_cols, q18_view, q18_cols)
            regular = next(c for c in result["comparison"] if c["orderType"] == "常规")
            self.assertEqual(regular["orderLines"], 1)
            custom = next(c for c in result["comparison"] if c["orderType"] == "定制")
            self.assertEqual(custom["orderLines"], 0)
            self.assertEqual(sum(t["orderLines"] for t in result["tags"]), 0)
            self.assertEqual(result["quality"]["status"], "degraded")
        finally:
            con.close()

    def test_custom_other_tag_from_remark(self) -> None:
        frame = pl.DataFrame(
            {
                "商品编码": ["A"],
                "商家实收": [1000.0],
                "销售数量": [1.0],
                "订单日期": ["2026-07-01"],
                "发货日期": [None],
                "颜色规格": ["定制款-20cm"],
                "是否定制": [True],
                "定制备注标签": ["其他定制"],
            }
        )
        con, pm_view, pm_cols, q18_view, q18_cols = self._make_connection(frame)
        try:
            result = build_customization_structure(con, "jt_view", "jt_view", pm_view, pm_cols, q18_view, q18_cols)
            other = next(t for t in result["tags"] if t["tag"] == "其他定制")
            self.assertEqual(other["orderLines"], 1)
            custom = next(c for c in result["comparison"] if c["orderType"] == "定制")
            self.assertEqual(custom["orderLines"], 1)
        finally:
            con.close()

    def test_custom_tag_reads_custom_remark_tag_column(self) -> None:
        # 优先级（折叠 > 横折 > 竖折 > 其他定制）在 transforms.py 推导；本测试验证
        # build_customization_structure 直接读取「定制备注标签」列做分类。
        frame = pl.DataFrame(
            {
                "商品编码": ["A"],
                "商家实收": [1000.0],
                "销售数量": [1.0],
                "订单日期": ["2026-07-01"],
                "发货日期": [None],
                "颜色规格": ["标准款"],
                "是否定制": [True],
                "定制备注标签": ["定制折叠"],
            }
        )
        con, pm_view, pm_cols, q18_view, q18_cols = self._make_connection(frame)
        try:
            result = build_customization_structure(con, "jt_view", "jt_view", pm_view, pm_cols, q18_view, q18_cols)
            fold = next(t for t in result["tags"] if t["tag"] == "定制折叠")
            self.assertEqual(fold["orderLines"], 1)
            others = sum(t["orderLines"] for t in result["tags"] if t["tag"] != "定制折叠")
            self.assertEqual(others, 0)
        finally:
            con.close()

    def test_custom_non_custom_excluded_from_tags(self) -> None:
        frame = pl.DataFrame(
            {
                "商品编码": ["A"],
                "商家实收": [1000.0],
                "销售数量": [1.0],
                "订单日期": ["2026-07-01"],
                "发货日期": [None],
                "颜色规格": ["标准款"],
                "是否定制": [False],
                "定制备注标签": [None],
            }
        )
        con, pm_view, pm_cols, q18_view, q18_cols = self._make_connection(frame)
        try:
            result = build_customization_structure(con, "jt_view", "jt_view", pm_view, pm_cols, q18_view, q18_cols)
            self.assertEqual(len(result["tags"]), 0)
        finally:
            con.close()

    def test_custom_spu_summary_sales_and_rate(self) -> None:
        frame = pl.DataFrame(
            {
                "商品编码": ["A", "A", "B", "B"],
                "商家实收": [1000.0, 1000.0, 2000.0, 2000.0],
                "销售数量": [2.0, 3.0, 5.0, 1.0],
                "订单日期": ["2026-07-01", "2026-07-01", "2026-07-01", "2026-07-01"],
                "发货日期": [None, None, None, None],
                "颜色规格": ["定制尺寸1500", "标准款", "定制厚度20cm", "标准款"],
                "是否定制": [True, False, True, False],
                "定制备注标签": ["其他定制", None, "其他定制", None],
            }
        )
        q18 = pl.DataFrame(
            {
                "商家规编（后台）": ["A", "B"],
                "SPU产品商编": ["SPU-A", "SPU-B"],
                "产品名称": ["产品A", "产品B"],
            }
        )
        con, pm_view, pm_cols, q18_view, q18_cols = self._make_connection(frame, q18_frame=q18)
        try:
            result = build_customization_structure(con, "jt_view", "jt_view", pm_view, pm_cols, q18_view, q18_cols)
            by_spu = {r["spu"]: r for r in result["spuSummary"]}
            self.assertEqual(by_spu["SPU-A"]["productName"], "产品A")
            self.assertEqual(by_spu["SPU-A"]["salesUnits"], 5.0)  # 2 + 3
            self.assertEqual(by_spu["SPU-A"]["customSalesUnits"], 2.0)  # 第1行 是否定制=True（销量2）
            self.assertAlmostEqual(by_spu["SPU-A"]["customRate"], 2.0 / 5.0, places=6)
            self.assertEqual(by_spu["SPU-B"]["salesUnits"], 6.0)  # 5 + 1
            self.assertEqual(by_spu["SPU-B"]["customSalesUnits"], 5.0)  # 第3行 是否定制=True（销量5）
            self.assertAlmostEqual(by_spu["SPU-B"]["customRate"], 5.0 / 6.0, places=6)
        finally:
            con.close()

    def test_custom_spu_summary_without_q18_falls_back_to_unknown(self) -> None:
        frame = pl.DataFrame(
            {
                "商品编码": ["A"],
                "商家实收": [1000.0],
                "销售数量": [2.0],
                "订单日期": ["2026-07-01"],
                "发货日期": [None],
                "颜色规格": ["标准款"],
                "是否定制": [False],
                "定制备注标签": [None],
            }
        )
        con, pm_view, pm_cols, q18_view, q18_cols = self._make_connection(frame)
        try:
            result = build_customization_structure(con, "jt_view", "jt_view", pm_view, pm_cols, q18_view, q18_cols)
            self.assertEqual(len(result["spuSummary"]), 1)
            self.assertEqual(result["spuSummary"][0]["spu"], "未识别 SPU")
            self.assertEqual(result["spuSummary"][0]["salesUnits"], 2.0)
            self.assertEqual(result["spuSummary"][0]["customSalesUnits"], 0.0)
            self.assertEqual(result["spuSummary"][0]["customRate"], 0)
        finally:
            con.close()


if __name__ == "__main__":
    unittest.main()