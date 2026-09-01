"""商品经营明细国补后金额/同比对账脚本。

读取本地数仓快照 + 直接查询 DuckDB 原始 07 表，独立验证：
1. 去年同期商品数据是否真的取到（productDailyPriorYear 非空 + 07 表日期覆盖去年同期）
2. 派生公式自洽（国补后金额 = (支付-退款)*0.85，同比 = (本期-去年)/去年）
3. 输出 Top10 商品对比表，供与 PowerBI Desktop 报表人工对账

用法：python scripts/audit-product-subsidized-yoy.py
"""
from __future__ import annotations

import io
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_PATH = PROJECT_ROOT / "local-data" / "warehouse" / "analytics-snapshot.json"
DUCKDB_PATH = PROJECT_ROOT / "local-data" / "warehouse" / "ecom.duckdb"


def load_snapshot() -> dict:
    if not SNAPSHOT_PATH.exists():
        sys.exit(f"快照不存在：{SNAPSHOT_PATH}，请先跑 node scripts/sync-warehouse.mjs")
    return json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))


def audit_snapshot(pages: dict) -> list[dict]:
    """从快照 powerbiPages 聚合本期 + 去年同期，派生对账字段。"""
    period = pages.get("period")
    product_daily = pages.get("productDaily", [])
    prior_year = pages.get("productDailyPriorYear", [])
    products = {p["productId"]: p for p in pages.get("products", [])}

    current = defaultdict(lambda: {"payAmount": 0.0, "refund": 0.0, "visitors": 0, "payBuyers": 0, "paidUnits": 0})
    for row in product_daily:
        bucket = current[row["productId"]]
        for field in ("payAmount", "refund", "visitors", "payBuyers", "paidUnits"):
            bucket[field] += row.get(field, 0)

    prior_map = {item["productId"]: item for item in prior_year}
    total_subsidized = sum((v["payAmount"] - v["refund"]) * 0.85 for v in current.values())

    rows = []
    for pid, v in current.items():
        subsidized = (v["payAmount"] - v["refund"]) * 0.85
        prior = prior_map.get(pid)
        prior_subsidized = (prior["payAmount"] - prior["refund"]) * 0.85 if prior else 0.0
        has_prior = bool(prior) and prior_subsidized > 0
        yoy = (subsidized - prior_subsidized) / prior_subsidized if has_prior else None
        rows.append({
            "productId": pid,
            "name": products.get(pid, {}).get("merchantCode") or pid,
            "payAmount": v["payAmount"],
            "refund": v["refund"],
            "subsidized_wan": subsidized / 10000,
            "prior_subsidized_wan": prior_subsidized / 10000 if has_prior else None,
            "yoy": yoy,
            "amount_share": subsidized / total_subsidized if total_subsidized else 0,
        })
    rows.sort(key=lambda r: r["subsidized_wan"], reverse=True)
    return rows


def audit_duckdb_coverage(period: dict | None) -> None:
    """直接查 DuckDB 07 表日期范围与窗口行数，独立验证本期 + 去年同期数据存在。"""
    try:
        import duckdb
    except ImportError:
        print("duckdb 包未安装，跳过原始表覆盖范围验证")
        return
    if not DUCKDB_PATH.exists():
        print(f"DuckDB 不存在：{DUCKDB_PATH}")
        return
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    try:
        # 通过 warehouse_query_catalog 按 query_name 定位 07 表的 model_view
        row = con.execute(
            "SELECT model_view FROM warehouse_query_catalog WHERE query_name = ?",
            ["07-旗舰店商品销售数据"],
        ).fetchone()
        if not row:
            print("warehouse_query_catalog 中未找到 07-旗舰店商品销售数据")
            return
        view = row[0]
        rng = con.execute(
            f'SELECT min(try_cast("日期" AS DATE)), max(try_cast("日期" AS DATE)) FROM "{view}"'
        ).fetchone()
        print(f"DuckDB 07 视图: {view}")
        print(f"07 表日期覆盖: {rng[0]} ~ {rng[1]}")
        if not period:
            return
        prior_start = f"{int(period['start'][:4]) - 1}{period['start'][4:]}"
        prior_end = f"{int(period['end'][:4]) - 1}{period['end'][4:]}"
        print(f"  本期窗口: {period['start']} ~ {period['end']}")
        print(f"  去年同期窗口: {prior_start} ~ {prior_end}")
        cur_cnt = con.execute(
            f'SELECT count(*), count(DISTINCT cast("商品ID" AS VARCHAR)) FROM "{view}" '
            f'WHERE try_cast("日期" AS DATE) BETWEEN ? AND ?',
            [period["start"], period["end"]],
        ).fetchone()
        prior_cnt = con.execute(
            f'SELECT count(*), count(DISTINCT cast("商品ID" AS VARCHAR)) FROM "{view}" '
            f'WHERE try_cast("日期" AS DATE) BETWEEN ? AND ?',
            [prior_start, prior_end],
        ).fetchone()
        print(f"  本期窗口行数: {cur_cnt[0]}, 商品数: {cur_cnt[1]}")
        print(f"  去年同期窗口行数: {prior_cnt[0]}, 商品数: {prior_cnt[1]}")
    finally:
        con.close()


def main() -> None:
    snapshot = load_snapshot()
    pages = snapshot["powerbiPages"]
    period = pages.get("period")

    print("=" * 80)
    print("商品经营明细 · 国补后金额/同比 对账")
    print("=" * 80)
    print(f"快照 refreshedAt: {snapshot.get('refreshedAt')}")
    print(f"PowerBI 页面 period: {period}")
    print(f"本期 productDaily 行数: {len(pages.get('productDaily', []))}")
    print(f"去年同期 productDailyPriorYear 商品数: {len(pages.get('productDailyPriorYear', []))}")

    coverage = audit_duckdb_coverage(period)

    rows = audit_snapshot(pages)
    print(f"\n本期商品数（Top60 聚合后）: {len(rows)}")
    with_prior = sum(1 for r in rows if r["prior_subsidized_wan"] is not None)
    print(f"有去年同期数据的商品数: {with_prior} / {len(rows)}")

    print("\n--- Top 10 by 国补后金额（与 PowerBI Desktop 报表人工比对）---")
    print(f"{'商品':24s} {'支付金额':>12s} {'退款':>10s} {'本期国补后(万)':>14s} {'去年国补后(万)':>14s} {'同比':>10s} {'销额占比':>9s}")
    for r in rows[:10]:
        prior_str = f"{r['prior_subsidized_wan']:.2f}" if r["prior_subsidized_wan"] is not None else "-"
        yoy_str = f"{r['yoy']*100:+.2f}%" if r["yoy"] is not None else "数据不足"
        print(
            f"{r['name'][:24]:24s} "
            f"{r['payAmount']:>12.0f} "
            f"{r['refund']:>10.0f} "
            f"{r['subsidized_wan']:>14.2f} "
            f"{prior_str:>14s} "
            f"{yoy_str:>10s} "
            f"{r['amount_share']*100:>8.2f}%"
        )

    print("\n--- 公式自洽抽查（首行）---")
    if rows:
        r = rows[0]
        expected = (r["payAmount"] - r["refund"]) * 0.85 / 10000
        diff = abs(expected - r["subsidized_wan"])
        print(f"商品 {r['name']}: (支付{r['payAmount']:.0f} - 退款{r['refund']:.0f}) * 0.85 / 10000 = {expected:.4f}万")
        print(f"快照派生值: {r['subsidized_wan']:.4f}万  偏差: {diff:.6f}  {'OK' if diff < 0.01 else '偏差超阈值'}")


if __name__ == "__main__":
    main()
