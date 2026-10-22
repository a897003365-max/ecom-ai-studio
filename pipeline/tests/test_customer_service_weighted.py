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
        # 天猫 10-1：建空表，test 自己灌数据；列含新结构(2026-06-29 起)原子字段
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
              "满意" DOUBLE,
              "很满意" DOUBLE,
              "收到评价数" DOUBLE,
              "询单人数" DOUBLE,
              "询单最终付款人数" DOUBLE,
              "客服消息条数" DOUBLE,
              "买家消息条数" DOUBLE,
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

    def _insert_tmall(
        self,
        agent: str,
        satisfaction: float,
        received: int,
        net_sales: float = 0,
        gross_sales: float = 0,
        day: date = date(2026, 8, 19),
    ) -> None:
        """旧结构行：新结构原子列全为 NULL，走「平台预制」回退口径。"""
        self.connection.execute(
            'INSERT INTO tmall_service_model ("日期","旺旺昵称","旺旺分组","有效接待人数","当日询单人数",'
            '"销售人数","净销售额","客单价","询单流失人数","首次响应时长（秒)","平均响应时长（秒)","淘宝答问比",'
            '"客户满意率","销售额","询单最终付款转化率","_source_mtime_ns","_source_path") '
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (day, agent, "售前组", received, 0, 0, net_sales, 0, 0, 30, 60, 1.2, satisfaction, gross_sales, 0, 1, "a.csv"),
        )

    def _insert_tmall_new(
        self,
        agent: str,
        day: date,
        final_pay: int,
        consult: int,
        satisfied: int = 0,
        very_satisfied: int = 0,
        evaluation: int = 0,
        agent_msg: int = 0,
        buyer_msg: int = 0,
        loss: int = 0,
    ) -> None:
        """新结构(2026-06-29 起)行：原子分子分母齐全，满足「严格按列名」口径。"""
        self.connection.execute(
            'INSERT INTO tmall_service_model ("日期","旺旺昵称","旺旺分组","有效接待人数","当日询单人数",'
            '"净销售额","询单流失人数","销售人数","询单人数","询单最终付款人数","满意","很满意",'
            '"收到评价数","客服消息条数","买家消息条数","_source_mtime_ns","_source_path") '
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (day, agent, "售前组", 10, consult, 10000, loss, 0, consult, final_pay, satisfied, very_satisfied, evaluation, agent_msg, buyer_msg, 1, "b.csv"),
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

    def test_tmall_by_agent_sales_uses_net_and_ties_to_daily(self) -> None:
        """天猫 byAgent 销售额走「净销售额」，且与 daily.netSales 同源可对账。

        页面上 KPI 卡「净销售额」读 daily.netSales、明细表读 byAgent，
        两者必须是同一口径 —— 否则同一页出现净额/毛额两个「销售额合计」
        （2026-09-09 现场：卡片 73.1 万 vs 表格 109.4 万，差额即成功退款）。

        构造：毛额刻意大于净额，若误取「销售额」则断言失败。
        """
        self._insert_tmall("客服A", 0.80, 10, net_sales=60000, gross_sales=90000)
        self._insert_tmall("客服B", 1.00, 1, net_sales=13000, gross_sales=19000)
        result = _build_tmall_customer_service(self.connection, self.START, self.END)
        by_agent = {row["agent"]: row for row in result["byAgent"]}
        # 取净额（6.0 / 1.3 万），不是毛额（9.0 / 1.9 万）
        self.assertAlmostEqual(by_agent["客服A"]["netSalesWan"], 6.0, places=4)
        self.assertAlmostEqual(by_agent["客服B"]["netSalesWan"], 1.3, places=4)
        # 毛额字段不得回归
        self.assertNotIn("salesAmountWan", by_agent["客服A"])
        # 页面不变量：表格合计 == KPI 卡合计
        table_total = sum(row["netSalesWan"] for row in result["byAgent"])
        kpi_total = sum(row["netSales"] for row in result["daily"]) / 10000
        self.assertAlmostEqual(table_total, kpi_total, places=4)
        self.assertAlmostEqual(table_total, 7.3, places=4)

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


# ── 新结构（2026-06-29 起）严格口径：按列名 SUM(分子)/SUM(分母) ──

    def test_tmall_new_strict_inquiry_conv_uses_final_pay_over_consult(self) -> None:
        """公式①严格口径：询单最终付款转化率 = SUM(询单最终付款人数)/SUM(询单人数)。"""
        self._insert_tmall_new("客服A", date(2026, 9, 1), final_pay=10, consult=35)
        self._insert_tmall_new("客服B", date(2026, 9, 1), final_pay=6, consult=17)
        result = _build_tmall_customer_service(self.connection, "2026-09-01", "2026-09-01")
        daily = result["daily"][0]
        self.assertAlmostEqual(daily["inquiryConversionRate"], (10 + 6) / (35 + 17), places=4)
        self.assertEqual(daily["metricsCaliber"], "strict")
        self.assertEqual(daily["finalPayCusNum"], 16)
        self.assertEqual(daily["consultNum"], 52)
        by_agent = {row["agent"]: row for row in result["byAgent"]}
        self.assertAlmostEqual(by_agent["客服A"]["inquiryConvRate"], 10 / 35, places=4)
        self.assertEqual(by_agent["客服A"]["metricsCaliber"], "strict")

    def test_tmall_new_strict_satisfaction_formula(self) -> None:
        """公式②严格口径：客户满意率 = (满意+很满意)/收到评价数。"""
        self._insert_tmall_new("客服A", date(2026, 9, 1), final_pay=5, consult=20, satisfied=0, very_satisfied=1, evaluation=1)
        self._insert_tmall_new("客服B", date(2026, 9, 1), final_pay=5, consult=20, satisfied=1, very_satisfied=3, evaluation=5)
        result = _build_tmall_customer_service(self.connection, "2026-09-01", "2026-09-01")
        self.assertAlmostEqual(result["daily"][0]["satisfactionRate"], (1 + 1 + 3) / (1 + 5), places=4)

    def test_tmall_new_strict_answer_ratio_formula(self) -> None:
        """公式③严格口径：答问比 = SUM(客服消息条数)/SUM(买家消息条数)。"""
        self._insert_tmall_new("客服A", date(2026, 9, 1), final_pay=5, consult=20, agent_msg=1116, buyer_msg=353)
        self._insert_tmall_new("客服B", date(2026, 9, 1), final_pay=5, consult=20, agent_msg=923, buyer_msg=268)
        result = _build_tmall_customer_service(self.connection, "2026-09-01", "2026-09-01")
        self.assertAlmostEqual(result["daily"][0]["answerRatio"], (1116 + 923) / (353 + 268), places=4)
        by_agent = {row["agent"]: row for row in result["byAgent"]}
        self.assertAlmostEqual(by_agent["客服A"]["answerRatio"], 1116 / 353, places=4)

    def test_tmall_mixed_period_splits_caliber_per_date(self) -> None:
        """05-29 前旧结构/precomputed 与 09-01 新结构/strict 同日并存时按日期分叉标记。"""
        self._insert_tmall("客服A", satisfaction=1.0, received=10)
        self._insert_tmall_new("客服B", date(2026, 9, 1), final_pay=5, consult=20)
        result = _build_tmall_customer_service(self.connection, "2026-08-19", "2026-09-01")
        daily = {str(row["date"]): row for row in result["daily"]}
        self.assertEqual(daily["2026-08-19"]["metricsCaliber"], "precomputed")
        self.assertEqual(daily["2026-09-01"]["metricsCaliber"], "strict")

    def test_tmall_new_by_agent_exposes_atom_fields(self) -> None:
        """byAgent 暴露原子字段与口径标记，供前端区间 SUM/SUM 与「预置口径」角标。"""
        self._insert_tmall_new("客服A", date(2026, 9, 1), final_pay=10, consult=35, satisfied=0, very_satisfied=1, evaluation=1, agent_msg=1116, buyer_msg=353)
        result = _build_tmall_customer_service(self.connection, "2026-09-01", "2026-09-01")
        row = result["byAgent"][0]
        self.assertEqual(row["finalPayCusNum"], 10)
        self.assertEqual(row["consultNum"], 35)
        self.assertEqual(row["satisfiedNum"], 0)
        self.assertEqual(row["verySatisfiedNum"], 1)
        self.assertEqual(row["evaluationNum"], 1)
        self.assertEqual(row["agentMsgNum"], 1116)
        self.assertEqual(row["buyerMsgNum"], 353)
        self.assertEqual(row["metricsCaliber"], "strict")

    def test_tmall_missing_new_columns_falls_back_to_precomputed(self) -> None:
        """过渡安全：model 视图尚无新结构列时，整体回落预制口径并标记 precomputed（不崩、不改旧数值）。"""
        # 用一个不含新原子列的表模拟「新文件未入仓」的旧 model 视图
        self.connection.execute("DROP TABLE IF EXISTS tmall_old_model")
        self.connection.execute(
            'CREATE TABLE tmall_old_model AS '
            'SELECT * EXCLUDE ("满意","很满意","收到评价数","询单人数","询单最终付款人数","客服消息条数","买家消息条数") '
            'FROM tmall_service_model WHERE 1=0'
        )
        self.connection.execute(
            'INSERT INTO tmall_old_model VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (date(2026, 8, 19), "客服A", "售前组", 10, 5, 3, 60000, 2000, 0, 30, 60, 1.2, 0.8, 90000, 0.3, 1, "a.csv"),
        )
        self.connection.execute("UPDATE warehouse_query_catalog SET model_view = 'tmall_old_model' WHERE query_name = '10-1淘宝客服绩效明细'")
        result = _build_tmall_customer_service(self.connection, "2026-08-19", "2026-08-19")
        daily = result["daily"][0]
        self.assertEqual(daily["metricsCaliber"], "precomputed")
        # 旧口径：转化率 = 1 − 流失/查询单 = 1 − 0/5 = 1.0
        self.assertAlmostEqual(daily["inquiryConversionRate"], 1.0, places=4)
        self.assertIsNone(daily["finalPayCusNum"])  # 原子字段回退为空值占位(None → 前端渲染「—」)
        self.assertEqual(result["byAgent"][0]["metricsCaliber"], "precomputed")


if __name__ == "__main__":
    unittest.main()
