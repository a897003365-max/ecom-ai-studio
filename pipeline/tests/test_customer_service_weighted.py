from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecom_pipeline.warehouse import (  # noqa: E402
    _build_jd_customer_service,
    _build_tmall_customer_service,
)


class CustomerServiceWeightedSatisfactionTests(unittest.TestCase):
    """客服满意率口径升级为「加权平均」的回归测试（2026-08-19 切换）。

    天猫口径：``Σ(客户满意率 × 有效接待人数) / Σ(有效接待人数)``，
    取代原来的算术平均。分母为 0 时返回 None（前端渲染为「—」）。

    京东口径：``Σ(好评量) / (Σ(好评量) + Σ(差评量))``，
    直接在 ``goodReviews / (goodReviews + badReviews)`` 形式聚合。
    """

    START = "2026-08-19"
    END = "2026-08-19"

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
                ("10-1淘宝客服绩效明细", "tmall_service_model"),
                ("10-2京东客服营销明细", "jd_workload_model"),
                ("10-3京东客服绩效数据", "jd_sales_model"),
                ("10-4客服员工日报统计", "jd_staff_model"),
            ],
        )
        # 天猫 10-1：建空表，test 自己灌数据
        self.connection.execute(
            """
            CREATE TABLE tmall_service_model (
              "日期" DATE,
              "旺旺昵称" VARCHAR,
              "旺旺分组" VARCHAR,
              "有效接待人数" DOUBLE,
              "当日询单人数" DOUBLE,
              "销售人数" DOUBLE,
              "净销售额" DOUBLE,
              "客单价" DOUBLE,
              "询单流失人数" DOUBLE,
              "首次响应时长（秒)" DOUBLE,
              "平均响应时长（秒)" DOUBLE,
              "淘宝答问比" DOUBLE,
              "客户满意率" DOUBLE,
              "销售额" DOUBLE,
              "询单最终付款转化率" DOUBLE,
              "_source_mtime_ns" BIGINT,
              "_source_path" VARCHAR
            )
            """
        )
        # 京东三张表骨架：建空表
        self.connection.execute(
            """
            CREATE TABLE jd_workload_model (
              "日期" DATE,
              "客服" VARCHAR,
              "接待量" DOUBLE,
              "首次平均响应时间" DOUBLE,
              "平均响应时间" DOUBLE,
              "30s应答率" DOUBLE,
              "_source_mtime_ns" BIGINT,
              "_source_path" VARCHAR
            )
            """
        )
        self.connection.execute(
            """
            CREATE TABLE jd_sales_model (
              "日期" DATE,
              "客服" VARCHAR,
              "促成下单商品金额" DOUBLE,
              "促成下单人数" DOUBLE,
              "售前接待人数" DOUBLE,
              "_source_mtime_ns" BIGINT,
              "_source_path" VARCHAR
            )
            """
        )
        self.connection.execute(
            """
            CREATE TABLE jd_staff_model (
              "日期" DATE,
              "UID" VARCHAR,
              "技能组" VARCHAR,
              "好评量" DOUBLE,
              "差评量" DOUBLE,
              "客服总消息数" DOUBLE,
              "客户总消息数" DOUBLE,
              "_source_mtime_ns" BIGINT,
              "_source_path" VARCHAR
            )
            """
        )

    def _insert_tmall(self, agent: str, satisfaction: float, received: int) -> None:
        self.connection.execute(
            "INSERT INTO tmall_service_model VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (date(2026, 8, 19), agent, "售前组", received, 0, 0, 0, 0, 0, 30, 60, 1.2, satisfaction, 0, 0, 1, "a.csv"),
        )

    def _insert_jd_staff(self, uid: str, good: int, bad: int) -> None:
        self.connection.execute(
            "INSERT INTO jd_staff_model VALUES (?,?,?,?,?,?,?,?,?)",
            (date(2026, 8, 19), uid, "售前组", good, bad, 30, 20, 1, "s.csv"),
        )

    def test_tmall_daily_satisfaction_is_effective_received_weighted(self) -> None:
        """天猫 daily = Σ(率 × 接待) / Σ(接待)。

        构造：客服A 接 10 单、满意率 0.80；客服B 接 1 单、满意率 1.00。
        加权 = (0.8×10 + 1.0×1) / 11 = 9/11 ≈ 0.8182。
        算术平均 = (0.8 + 1.0) / 2 = 0.9，**与加权不同**，证明口径切换生效。
        """
        self._insert_tmall("客服A", 0.80, 10)
        self._insert_tmall("客服B", 1.00, 1)
        result = _build_tmall_customer_service(self.connection, self.START, self.END)
        self.assertEqual(len(result["daily"]), 1)
        satisfaction = result["daily"][0]["satisfactionRate"]
        self.assertAlmostEqual(satisfaction, 9 / 11, places=4)
        # 显式断言 ≠ 算术平均：这是口径切换的"指纹"
        self.assertNotAlmostEqual(satisfaction, 0.9, places=2)

    def test_tmall_daily_returns_null_when_effective_received_is_zero(self) -> None:
        """天猫 daily 当所有客服有效接待=0 时，nullif 防空 → satisfactionRate 为 None（前端渲染「—」）。"""
        self._insert_tmall("客服C", 0.50, 0)
        result = _build_tmall_customer_service(self.connection, self.START, self.END)
        self.assertEqual(len(result["daily"]), 1)
        self.assertIsNone(result["daily"][0]["satisfactionRate"])

    def test_tmall_by_agent_passes_through_daily_values(self) -> None:
        """天猫 byAgent 按 (日期, 客服) 粒度透传 daily 率值，不在 SQL 里二次加权。

        按 plan 设计：避免后端"日级加权"和"客服级加权"用两套公式，
        把"按客服加权"统一交给前端 ``aggregateAgentRows(weightedAverage)``。
        """
        self._insert_tmall("客服A", 0.80, 10)
        self._insert_tmall("客服B", 1.00, 1)
        result = _build_tmall_customer_service(self.connection, self.START, self.END)
        by_agent = {row["agent"]: row["satisfactionRate"] for row in result["byAgent"]}
        self.assertAlmostEqual(by_agent["客服A"], 0.80, places=4)
        self.assertAlmostEqual(by_agent["客服B"], 1.00, places=4)

    def test_jd_daily_satisfaction_is_good_over_total_reviews(self) -> None:
        """京东 daily = Σ(好评) / (Σ(好评) + Σ(差评))。

        构造：同一天两个 UID，1+1=2 好评、1 差评 → 2/3 ≈ 0.6667。
        店铺维度（2026-08-26）后每日返回 自营 + 全部 两行，断言取自营行。
        """
        self._insert_jd_staff("jd_001", good=1, bad=1)
        self._insert_jd_staff("jd_002", good=1, bad=0)
        result = _build_jd_customer_service(self.connection, self.START, self.END)
        self.assertEqual(len(result["daily"]), 2)
        daily = {row["store"]: row for row in result["daily"]}
        self.assertAlmostEqual(daily["京东自营"]["satisfactionRate"], 2 / 3, places=4)
        # 全部 = 仅有自营时的 rollup，与自营口径一致
        self.assertAlmostEqual(daily["全部"]["satisfactionRate"], 2 / 3, places=4)

    def test_jd_daily_returns_null_when_no_reviews(self) -> None:
        """京东 daily 当好评+差评=0 时（10-4 周末缺数），nullif 防空 → satisfactionRate 为 None。"""
        self._insert_jd_staff("jd_003", good=0, bad=0)
        result = _build_jd_customer_service(self.connection, self.START, self.END)
        daily = {row["store"]: row for row in result["daily"]}
        self.assertIsNone(daily["京东自营"]["satisfactionRate"])
        self.assertIsNone(daily["全部"]["satisfactionRate"])

    def test_jd_by_agent_satisfaction_matches_per_agent_rate(self) -> None:
        """京东 byAgent 把"好评率"按 (日期, 客服) 透传；前端客服折叠时与 daily 一致。"""
        self._insert_jd_staff("jd_001", good=1, bad=1)
        self._insert_jd_staff("jd_002", good=1, bad=0)
        result = _build_jd_customer_service(self.connection, self.START, self.END)
        by_agent = {row["agent"]: row["satisfactionRate"] for row in result["byAgent"]}
        self.assertAlmostEqual(by_agent["jd_001"], 0.5, places=4)
        self.assertAlmostEqual(by_agent["jd_002"], 1.0, places=4)


if __name__ == "__main__":
    unittest.main()
