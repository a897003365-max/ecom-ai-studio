from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path

import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecom_pipeline.readers import QuarantinedSourceError  # noqa: E402
from ecom_pipeline.transforms import _apply_jd_reception_confidence  # noqa: E402


def _pop_frame(rows: list[tuple[str, float]]) -> pl.DataFrame:
    """构造最小京东POP日报帧：必需五列齐全。"""
    return pl.DataFrame(
        {
            "客服": [row[0] for row in rows],
            "接待量": [row[1] for row in rows],
            "售前接待人数": [row[1] for row in rows],
            "促成下单人数": [0.0 for _ in rows],
            "促成下单商品金额": [0.0 for _ in rows],
        }
    )


class JdReceptionConfidenceTests(unittest.TestCase):
    """接待数据文件夹的置信度分级写入（2026-08-26 起）。

    高置信（京东pop日报：日期可解析 + 必需列齐全 + 有有效行 + 接待量可数值化）
    → 补 日期 + 店铺=京东POP 入仓；低置信 → QuarantinedSourceError 隔离；
    京麦旧周报 → 兼容保留（原样通过、不赋日期）。
    """

    def test_high_confidence_pop_file_gets_date_and_store(self) -> None:
        frame = _pop_frame([("麻大师旗舰-小王", 100.0), ("麻大师-麻绵绵", 50.0)])
        result = _apply_jd_reception_confidence(frame, Path("京东pop2026-08-25.xlsx"))
        self.assertEqual(result["日期"].unique().to_list(), [date(2026, 8, 25)])
        self.assertEqual(result["店铺"].unique().to_list(), ["京东POP"])
        self.assertEqual(result.height, 2)

    def test_pop_file_with_unparseable_date_is_quarantined(self) -> None:
        frame = _pop_frame([("麻大师旗舰-小王", 100.0)])
        with self.assertRaises(QuarantinedSourceError) as ctx:
            _apply_jd_reception_confidence(frame, Path("京东pop日报.xlsx"))
        self.assertIn("文件名日期不可解析", ctx.exception.reason)

    def test_pop_file_missing_required_column_is_quarantined(self) -> None:
        frame = _pop_frame([("麻大师旗舰-小王", 100.0)]).drop("促成下单商品金额")
        with self.assertRaises(QuarantinedSourceError) as ctx:
            _apply_jd_reception_confidence(frame, Path("京东pop2026-08-25.xlsx"))
        self.assertIn("促成下单商品金额", ctx.exception.reason)

    def test_pop_file_with_only_summary_rows_is_quarantined(self) -> None:
        """客服列全为 null/空（纯汇总表）→ 过滤后无有效行 → 隔离。"""
        frame = pl.DataFrame(
            {
                "客服": [None, ""],
                "接待量": [562.0, 562.0],
                "售前接待人数": [294.0, 294.0],
                "促成下单人数": [74.0, 74.0],
                "促成下单商品金额": [102801.4, 102801.4],
            }
        )
        with self.assertRaises(QuarantinedSourceError) as ctx:
            _apply_jd_reception_confidence(frame, Path("京东pop2026-08-25.xlsx"))
        self.assertIn("无有效客服行", ctx.exception.reason)

    def test_unknown_naming_is_quarantined(self) -> None:
        frame = _pop_frame([("麻大师旗舰-小王", 100.0)])
        with self.assertRaises(QuarantinedSourceError) as ctx:
            _apply_jd_reception_confidence(frame, Path("随便什么名字.xlsx"))
        self.assertIn("未识别的文件命名模式", ctx.exception.reason)

    def test_legacy_jingmai_weekly_passes_through_without_date(self) -> None:
        """京麦周报兼容保留：原样返回、不赋日期（看板日期过滤自然排除）。"""
        frame = pl.DataFrame({"客服": ["麻大师自营-小李"], "接待量": [332.0]})
        result = _apply_jd_reception_confidence(frame, Path("WaiterDimWorkload4Jingmai_20260824.xlsx"))
        self.assertNotIn("日期", result.columns)
        self.assertNotIn("店铺", result.columns)
        self.assertEqual(result.height, 1)


if __name__ == "__main__":
    unittest.main()
