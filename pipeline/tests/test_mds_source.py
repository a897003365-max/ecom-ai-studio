from __future__ import annotations

import os
import sys
import tempfile
import types
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecom_pipeline import warehouse  # noqa: E402
from ecom_pipeline.catalog import QuerySpec  # noqa: E402
from ecom_pipeline.config import WarehousePaths  # noqa: E402
from ecom_pipeline.mds_source import (  # noqa: E402
    MDS_ENV_KEYS,
    TMALL_ITEM_PROMOTION_QUERY,
    TMALL_PRODUCT_DAILY_QUERY,
    TMALL_SCENE_DAILY_QUERY,
    TMALL_SHOP_SUMMARY_QUERY,
    MdsSourceError,
    _credentials,
    fetch_tmall_item_promotion_daily,
    fetch_tmall_product_daily,
    fetch_tmall_scene_daily,
    fetch_tmall_shop_daily,
)

SCRIPT = {
    "daily": [
        (date(2026, 10, 4), 100, 50, 1000.123456, 200.0, 10, 30.0, 20.0, 40.0, 5.0, 80, 7, 60, 40, 12.345, 0.4567),
        (date(2026, 10, 5), 110, 55, 2000.0, None, 11, 31.0, 21.0, 41.0, 6.0, 88, 8, 66, 44, None, 0.5),
    ],
    "marketing": [
        (date(2026, 10, 4), 12.347),
        (date(2026, 10, 5), None),
        (date(2026, 10, 6), 99.0),  # 主表无此日，应被丢弃
    ],
    "rank": [
        (date(2026, 10, 4), 3),
        (date(2026, 10, 5), None),
    ],
}


class _FakeCursor:
    def __init__(self, script):
        self._script = script
        self._result = []

    def execute(self, sql, params=None):
        if "taobao_shop_daily_summary" in sql:
            self._result = self._script["daily"]
        elif "taobao_shop_marketing_daily" in sql:
            assert params and list(params[0]) == ["超级短视频", "超级直播"]
            self._result = self._script["marketing"]
        elif "taobao_shop_rank_daily" in sql:
            assert params and params[0] == "麻大师旗舰店"
            self._result = self._script["rank"]
        else:  # pragma: no cover - 防御未知 SQL
            raise AssertionError(f"unexpected SQL: {sql}")

    def fetchall(self):
        return self._result


class _FakeConnection:
    def __init__(self, script):
        self._script = script

    def cursor(self):
        return _FakeCursor(self._script)

    def close(self):
        pass


def _fake_psycopg2(script):
    module = types.ModuleType("psycopg2")
    module.connect = lambda **kwargs: _FakeConnection(script)
    return module


class FetchTmallShopDailyTest(unittest.TestCase):
    def test_merges_three_tables_with_dingtalk_caliber(self) -> None:
        with mock.patch.dict(sys.modules, {"psycopg2": _fake_psycopg2(SCRIPT)}):
            frame = fetch_tmall_shop_daily(creds={"MDS_DB_HOST": "h", "MDS_DB_PORT": "1", "MDS_DB_USERNAME": "u", "MDS_DB_PASSWORD": "p"})

        self.assertEqual(frame.columns, ["日期", "浏览量", "店铺客户数", "GMV", "成功退款金额", "加购人数", "关键词推广", "精准人群推广", "全站推广", "淘客", "商品访客数", "支付买家数", "新访客数", "老访客数", "平均停留时长", "跳失率", "内容场景", "店铺排名"])
        self.assertEqual(frame.height, 2)
        self.assertEqual(frame["日期"].dtype, pl.Date)
        self.assertEqual(frame["店铺排名"].dtype, pl.Int64)
        rows = {row["日期"]: row for row in frame.to_dicts()}
        day4 = rows[date(2026, 10, 4)]
        self.assertEqual(day4["GMV"], 1000.12)  # round 2 位，与 db_source._float 同口径
        self.assertEqual(day4["内容场景"], 12.35)
        self.assertEqual(day4["店铺排名"], 3)
        # 04 回填扩展列（不 round，保留原始精度）
        self.assertEqual(day4["支付买家数"], 7.0)
        self.assertEqual(day4["新访客数"], 60.0)
        self.assertEqual(day4["平均停留时长"], 12.345)
        self.assertEqual(day4["跳失率"], 0.4567)
        day5 = rows[date(2026, 10, 5)]
        self.assertIsNone(day5["成功退款金额"])  # DB NULL 保持空，不置 0
        self.assertIsNone(day5["内容场景"])
        self.assertIsNone(day5["店铺排名"])
        self.assertIsNone(day5["平均停留时长"])  # 扩展列 NULL 同样保持空

    def test_missing_credentials_raise_mds_error(self) -> None:
        cleared = {key: "" for key in MDS_ENV_KEYS}
        with mock.patch.dict(os.environ, cleared):
            with self.assertRaises(MdsSourceError):
                _credentials(env_file=Path("definitely-not-exists-mds-db.env"))

    def test_connect_failure_raises_mds_error(self) -> None:
        broken = types.ModuleType("psycopg2")

        def _connect(**kwargs):
            raise OSError("connection refused")

        broken.connect = _connect
        with mock.patch.dict(sys.modules, {"psycopg2": broken}):
            with self.assertRaises(MdsSourceError):
                fetch_tmall_shop_daily(creds={"MDS_DB_HOST": "h", "MDS_DB_PORT": "1", "MDS_DB_USERNAME": "u", "MDS_DB_PASSWORD": "p"})


DETAIL_SCRIPT = {
    "product": [
        (date(2026, 10, 5), 681141376007, "麻大师床垫A", 14915.0, 482.0, 37.0, 56196.394, 17367.46, 40.0),
        (date(2026, 10, 5), "679598949615", None, 28157.0, 728.0, 20.0, 55093.64, None, 22.0),
    ],
    "scene": [
        (date(2026, 10, 5), "关键词推广", 293183.0, 11160.0, 50501.704, 112851.55, 1150.0, 913.0, 244.0),
    ],
    "item_promo": [
        (date(2026, 10, 4), 681141376007, "麻大师床垫A", "关键词推广", 293183.0, 11160.0, 50501.704, 112851.55, 1150.0, 244.0),
        (date(2026, 10, 4), "679598949615", None, "全站推广", 1000.0, 50.0, None, 2000.0, 30.0, 5.0),
    ],
}


class _FakeDetailCursor:
    def __init__(self, script):
        self._script = script
        self._result = []

    def execute(self, sql, params=None):
        if "taobao_item_promotion_daily" in sql:
            self._result = self._script["item_promo"]
        elif "taobao_shop_product_daily" in sql:
            self._result = self._script["product"]
        elif "taobao_shop_marketing_daily" in sql and "SUM(" not in sql:
            self._result = self._script["scene"]
        else:  # pragma: no cover - 防御未知 SQL
            raise AssertionError(f"unexpected SQL: {sql}")

    def fetchall(self):
        return self._result


class _FakeDetailConnection:
    def __init__(self, script):
        self._script = script

    def cursor(self):
        return _FakeDetailCursor(self._script)

    def close(self):
        pass


def _fake_detail_psycopg2(script):
    module = types.ModuleType("psycopg2")
    module.connect = lambda **kwargs: _FakeDetailConnection(script)
    return module


_CREDS = {"MDS_DB_HOST": "h", "MDS_DB_PORT": "1", "MDS_DB_USERNAME": "u", "MDS_DB_PASSWORD": "p"}


class FetchTmallDetailDailyTest(unittest.TestCase):
    def test_product_daily_maps_file_chain_canonical_columns(self) -> None:
        with mock.patch.dict(sys.modules, {"psycopg2": _fake_detail_psycopg2(DETAIL_SCRIPT)}):
            frame = fetch_tmall_product_daily(creds=_CREDS)

        self.assertEqual(
            frame.columns,
            ["日期", "商品ID", "商品名称", "商品访客数", "加购人数", "支付买家数", "支付金额", "退款金额", "商品支付件数"],
        )
        self.assertEqual(frame["日期"].dtype, pl.Date)
        self.assertEqual(frame["商品ID"].dtype, pl.Utf8)  # 数值型 spu_id 也归一为文本，与文件链商品ID同域
        self.assertEqual(frame["支付金额"].dtype, pl.Float64)
        rows = frame.to_dicts()
        self.assertEqual(rows[0]["商品ID"], "681141376007")
        self.assertEqual(rows[0]["支付金额"], 56196.39)  # round 2 位
        self.assertIsNone(rows[1]["商品名称"])  # DB NULL 保持空
        self.assertIsNone(rows[1]["退款金额"])

    def test_scene_daily_maps_file_chain_canonical_columns(self) -> None:
        with mock.patch.dict(sys.modules, {"psycopg2": _fake_detail_psycopg2(DETAIL_SCRIPT)}):
            frame = fetch_tmall_scene_daily(creds=_CREDS)

        self.assertEqual(
            frame.columns,
            ["日期", "场景名字", "展现量", "点击量", "花费", "总成交金额", "总购物车数", "直接购物车数", "旺旺咨询量"],
        )
        row = frame.to_dicts()[0]
        self.assertEqual(row["场景名字"], "关键词推广")
        self.assertEqual(row["花费"], 50501.7)  # charge_amount → 花费
        self.assertEqual(row["总成交金额"], 112851.55)  # alipay_inshop_amount → 总成交金额
        self.assertEqual(row["直接购物车数"], 913.0)  # cart_dir_count → 直接购物车数

    def test_item_promotion_daily_maps_file_chain_canonical_columns(self) -> None:
        with mock.patch.dict(sys.modules, {"psycopg2": _fake_detail_psycopg2(DETAIL_SCRIPT)}):
            frame = fetch_tmall_item_promotion_daily(creds=_CREDS)

        self.assertEqual(
            frame.columns,
            ["日期", "商品ID", "主体名称", "场景名字", "展现量", "点击量", "花费", "总成交金额", "总购物车数", "旺旺咨询量"],
        )
        self.assertEqual(frame["商品ID"].dtype, pl.Utf8)  # promotion_id 数值型也归一为文本
        self.assertNotIn("直接购物车数", frame.columns)  # item 表无该列，由回填侧置 NULL
        rows = frame.to_dicts()
        self.assertEqual(rows[0]["商品ID"], "681141376007")
        self.assertEqual(rows[0]["花费"], 50501.7)  # round 2 位
        self.assertEqual(rows[0]["总购物车数"], 1150.0)
        self.assertIsNone(rows[1]["主体名称"])  # DB NULL 保持空
        self.assertIsNone(rows[1]["花费"])

    def test_detail_fetch_connect_failure_raises_mds_error(self) -> None:
        broken = types.ModuleType("psycopg2")

        def _connect(**kwargs):
            raise OSError("connection refused")

        broken.connect = _connect
        with mock.patch.dict(sys.modules, {"psycopg2": broken}):
            for fetcher in (fetch_tmall_product_daily, fetch_tmall_scene_daily, fetch_tmall_item_promotion_daily):
                with self.subTest(fetcher=fetcher.__name__):
                    with self.assertRaises(MdsSourceError):
                        fetcher(creds=_CREDS)


def _postgres_spec() -> QuerySpec:
    return QuerySpec(
        index=29,
        name=TMALL_SHOP_SUMMARY_QUERY,
        m_file="external/mds-天猫店铺日汇总.md",
        source_kind="postgres",
        source_paths=(Path("postgres://mds/taobao_shop_daily_summary"),),
        sheet_name=None,
        promote_headers=False,
        schema=(),
        operations=(),
    )


def _tmp_paths(root: Path) -> WarehousePaths:
    warehouse_root = root / "warehouse"
    return WarehousePaths(
        project_root=root,
        manifest=root / "manifest.json",
        warehouse_root=warehouse_root,
        staging_root=warehouse_root / "staging",
        marts_root=warehouse_root / "marts",
        state_file=warehouse_root / "state.json",
        database=warehouse_root / "ecom.duckdb",
        snapshot=warehouse_root / "analytics-snapshot.json",
    )


class SyncPostgresQueryTest(unittest.TestCase):
    def test_success_writes_single_partition(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = _tmp_paths(Path(tmp))
            state = {"version": 1, "files": {}}
            with mock.patch.dict(sys.modules, {"psycopg2": _fake_psycopg2(SCRIPT)}):
                result = warehouse._sync_postgres_query(paths, _postgres_spec(), state, warehouse.SyncOptions(), None)

            self.assertEqual(result["status"], "success")
            self.assertEqual((result["rows"], result["columns"]), (2, 18))
            entry = state["files"][f"postgres://{TMALL_SHOP_SUMMARY_QUERY}"]
            self.assertTrue(Path(entry["parquet"]).exists())
            frame = pl.read_parquet(entry["parquet"])
            self.assertEqual(frame.height, 2)

    def test_item_promotion_query_dispatches_to_mapped_fetcher(self) -> None:
        spec = QuerySpec(
            index=32,
            name=TMALL_ITEM_PROMOTION_QUERY,
            m_file="external/mds-天猫商品推广日明细.md",
            source_kind="postgres",
            source_paths=(Path("postgres://mds/taobao_item_promotion_daily"),),
            sheet_name=None,
            promote_headers=False,
            schema=(),
            operations=(),
        )
        with tempfile.TemporaryDirectory() as tmp:
            paths = _tmp_paths(Path(tmp))
            state = {"version": 1, "files": {}}
            with mock.patch.dict(sys.modules, {"psycopg2": _fake_detail_psycopg2(DETAIL_SCRIPT)}):
                result = warehouse._sync_postgres_query(paths, spec, state, warehouse.SyncOptions(), None)

            self.assertEqual(result["status"], "success")
            self.assertEqual((result["rows"], result["columns"]), (2, 10))
            frame = pl.read_parquet(state["files"][f"postgres://{TMALL_ITEM_PROMOTION_QUERY}"]["parquet"])
            self.assertEqual(frame["商品ID"].to_list(), ["681141376007", "679598949615"])

    def test_failure_never_raises_and_keeps_previous_partition(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = _tmp_paths(Path(tmp))
            state = {"version": 1, "files": {}}
            with mock.patch.dict(sys.modules, {"psycopg2": _fake_psycopg2(SCRIPT)}):
                first = warehouse._sync_postgres_query(paths, _postgres_spec(), state, warehouse.SyncOptions(), None)
            self.assertEqual(first["status"], "success")

            with mock.patch("ecom_pipeline.warehouse.fetch_tmall_shop_daily", side_effect=MdsSourceError("mds 不可达")):
                second = warehouse._sync_postgres_query(paths, _postgres_spec(), state, warehouse.SyncOptions(), None)
            self.assertEqual(second["status"], "partial")  # 保留上次有效分区
            self.assertEqual(second["rows"], 2)
            self.assertEqual(second["failed"], 1)

            # 从未成功过时为 failed，且两次调用都不向主循环抛异常
            with tempfile.TemporaryDirectory() as tmp2:
                with mock.patch("ecom_pipeline.warehouse.fetch_tmall_shop_daily", side_effect=MdsSourceError("mds 不可达")):
                    third = warehouse._sync_postgres_query(_tmp_paths(Path(tmp2)), _postgres_spec(), {"version": 1, "files": {}}, warehouse.SyncOptions(), None)
            self.assertEqual(third["status"], "failed")
            self.assertEqual(third["activePartitions"], 0)


if __name__ == "__main__":
    unittest.main()
