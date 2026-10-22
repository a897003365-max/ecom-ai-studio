from __future__ import annotations

import sys
import unittest
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from datetime import date  # noqa: E402

from ecom_pipeline.warehouse import (  # noqa: E402
    _build_customer_service,
    _build_douyin_customer_service,
)


class DouyinCustomerServiceTests(unittest.TestCase):
    """抖音每日客服(16-抖音每日客服)聚合口径回归测试(2026-09-10 新增)。

    口径:
    - 询单转化率 = SUM(支付人数) / SUM(询单人数)(重算,不用导出列);
    - 满意率 = Σ(全天满意率 × 有效评价数) / Σ(有效评价数),分母为 0 返回 None;
    - 净销售额 = SUM(退款后销售额)(已扣退款,单位元),byAgent 附 netSalesWan;
    - agentCount 只数在线时长>0 的客服(导出含全天未上线客服行)。
    """

    START = "2026-09-09"
    END = "2026-09-09"

    def setUp(self) -> None:
        self.connection = duckdb.connect(":memory:")
        self.connection.execute(
            "CREATE TABLE warehouse_query_catalog (query_name VARCHAR, model_view VARCHAR)"
        )
        self.connection.execute(
            "INSERT INTO warehouse_query_catalog VALUES ('16-抖音每日客服', 'douyin_service_model')"
        )
        self.connection.execute(
            """
            CREATE TABLE douyin_service_model (
              "日期" DATE,
              "客服昵称" VARCHAR,
              "在线时长秒" DOUBLE,
              "平响秒" DOUBLE,
              "首响秒" DOUBLE,
              "接待会话量" BIGINT,
              "退款后销售额" DOUBLE,
              "询单人数" BIGINT,
              "支付人数" BIGINT,
              "有效评价数" BIGINT,
              "全天满意率" DOUBLE,
              "_source_mtime_ns" BIGINT,
              "_source_path" VARCHAR
            )
            """
        )

    def tearDown(self) -> None:
        self.connection.close()

    def _insert(
        self,
        agent: str,
        *,
        online: float = 3600.0,
        avg_resp: float = 20.0,
        first_resp: float = 15.0,
        received: int = 10,
        net_sales: float = 1000.0,
        inquiry: int = 4,
        pay: int = 2,
        evals: int = 5,
        rate: float | None = 0.9,
        mtime: int = 1,
        day: str = "2026-09-09",
    ) -> None:
        self.connection.execute(
            "INSERT INTO douyin_service_model VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [day, agent, online, avg_resp, first_resp, received, net_sales, inquiry, pay, evals, rate, mtime, f"{day}.xlsx"],
        )

    def test_daily_weighted_satisfaction_and_conversion(self) -> None:
        """0.8×5 + 1.0×15 → 19/20=0.95(加权),显式区别于算术平均 0.9。"""
        self._insert("客服A", rate=0.8, evals=5, inquiry=10, pay=5)
        self._insert("客服B", rate=1.0, evals=15, inquiry=10, pay=1)
        result = _build_douyin_customer_service(self.connection, self.START, self.END)
        self.assertEqual(len(result["daily"]), 1)
        daily = result["daily"][0]
        self.assertAlmostEqual(daily["satisfactionRate"], 0.95, places=4)
        self.assertNotAlmostEqual(daily["satisfactionRate"], 0.9, places=2)
        self.assertAlmostEqual(daily["inquiryConvRate"], 6 / 20, places=4)
        self.assertEqual(daily["agentCount"], 2)
        self.assertEqual(daily["received"], 20)
        self.assertAlmostEqual(daily["netSales"], 2000.0, places=4)
        self.assertAlmostEqual(daily["onlineSeconds"], 7200.0, places=4)

    def test_daily_satisfaction_null_when_no_weight(self) -> None:
        """满意率全 NULL 或有效评价=0 时分母防空 → None(前端渲染「—」)。"""
        self._insert("客服C", rate=None, evals=0)
        result = _build_douyin_customer_service(self.connection, self.START, self.END)
        self.assertIsNone(result["daily"][0]["satisfactionRate"])

    def test_agent_count_excludes_offline_agents(self) -> None:
        self._insert("在线客服", online=3600.0)
        self._insert("离线客服", online=0.0)
        result = _build_douyin_customer_service(self.connection, self.START, self.END)
        self.assertEqual(result["daily"][0]["agentCount"], 1)

    def test_dedup_keeps_latest_snapshot(self) -> None:
        """同(日期,客服)两个快照行,取 _source_mtime_ns 最新者。"""
        self._insert("客服A", net_sales=1000.0, mtime=1)
        self._insert("客服A", net_sales=2000.0, mtime=2)
        result = _build_douyin_customer_service(self.connection, self.START, self.END)
        self.assertEqual(len(result["byAgent"]), 1)
        self.assertAlmostEqual(result["daily"][0]["netSales"], 2000.0, places=4)

    def test_by_agent_net_sales_ties_to_daily(self) -> None:
        """byAgent.netSales 与 daily.netSales 同源可对账;netSalesWan = 元/10000。"""
        self._insert("客服A", net_sales=32331.08)
        self._insert("客服B", net_sales=21284.40)
        result = _build_douyin_customer_service(self.connection, self.START, self.END)
        by_agent = {row["agent"]: row for row in result["byAgent"]}
        self.assertAlmostEqual(by_agent["客服A"]["netSalesWan"], 3.233108, places=4)
        table_total = sum(row["netSales"] for row in result["byAgent"])
        kpi_total = sum(row["netSales"] for row in result["daily"])
        self.assertAlmostEqual(table_total, kpi_total, places=4)
        # 明细字段齐全(前端明细表:在线时长/接待/询单/转化/满意)
        row = by_agent["客服A"]
        for key in ("received", "onlineSeconds", "inquiryCount", "payCount", "evalCount", "inquiryConvRate", "satisfactionRate", "firstResponse", "avgResponse"):
            self.assertIn(key, row)

    def test_period_widens_to_douyin_full_history(self) -> None:
        """快照 60 天窗口外的抖音历史(如 2026-01 补采)仍进 customerService.douyin,
        且 period.start 放宽到抖音数据最早日;天猫/京东视图缺失时为空结构不报错。"""
        self._insert("客服A", day="2026-01-15")
        self._insert("客服A", day="2026-09-09")
        # 窗口外右侧:飞鸽 T-1 数据领先全局 period_end 一天,不应被窗口截掉
        self._insert("客服B", day="2026-09-10")
        result = _build_customer_service(self.connection, date(2026, 7, 12), date(2026, 9, 9))
        self.assertEqual(result["period"], {"start": "2026-01-15", "end": "2026-09-10"})
        dates = [str(row["date"]) for row in result["douyin"]["daily"]]
        self.assertEqual(dates, ["2026-01-15", "2026-09-09", "2026-09-10"])
        self.assertEqual(result["tmall"], {"daily": [], "byAgent": [], "groups": []})

    def test_period_widens_to_tmall_full_history(self) -> None:
        """天猫/京东同样放宽:天猫最早 2025-10-05 数据进 tmall.daily,period.start 取各源最早。"""
        self.connection.execute(
            "INSERT INTO warehouse_query_catalog VALUES ('10-1淘宝客服绩效明细', 'tmall_service_model')"
        )
        self.connection.execute(
            """
            CREATE TABLE tmall_service_model (
              "日期" DATE, "旺旺昵称" VARCHAR, "旺旺分组" VARCHAR,
              "有效接待人数" DOUBLE, "当日询单人数" DOUBLE, "销售人数" DOUBLE,
              "净销售额" DOUBLE, "客单价" DOUBLE, "询单流失人数" DOUBLE,
              "首次响应时长（秒)" DOUBLE, "平均响应时长（秒)" DOUBLE, "淘宝答问比" DOUBLE,
              "客户满意率" DOUBLE, "销售额" DOUBLE, "询单最终付款转化率" DOUBLE,
              "_source_mtime_ns" BIGINT, "_source_path" VARCHAR
            )
            """
        )
        self.connection.execute(
            "INSERT INTO tmall_service_model VALUES (?, ?, ?, 10, 5, 2, 3000, 150, 1, 12, 18, 1.2, 0.95, 3200, 0.4, 1, ?)",
            ["2025-10-05", "旺旺A", "售前", "a.xlsx"],
        )
        self._insert("客服A", day="2026-09-09")
        result = _build_customer_service(self.connection, date(2026, 7, 12), date(2026, 9, 9))
        self.assertEqual(result["period"]["start"], "2025-10-05")
        tmall_dates = [str(row["date"]) for row in result["tmall"]["daily"]]
        self.assertEqual(tmall_dates, ["2025-10-05"])
        self.assertEqual(result["jd"], {"daily": [], "serviceDaily": [], "byAgent": [], "groups": []})

    def test_missing_view_returns_empty(self) -> None:
        self.connection.execute("DELETE FROM warehouse_query_catalog")
        result = _build_douyin_customer_service(self.connection, self.START, self.END)
        self.assertEqual(result, {"daily": [], "byAgent": [], "groups": []})


if __name__ == "__main__":
    unittest.main()
