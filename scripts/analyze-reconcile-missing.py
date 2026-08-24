# -*- coding: utf-8 -*-
"""分析「天猫平台与工作台核对.xlsx」中平台有、网站无的订单被哪个过滤环节剔除。

用 transforms.py 的真实规则逐条判定，输出归类统计 + 明细。
"""
import json
import sys
from pathlib import Path

import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))
from ecom_pipeline.transforms import JUSHUITAN_MANUAL_ZERO_EXACT_NAMES  # noqa: E402

RECONCILE = r"D:/麻大师/日更数据/天猫旗舰店/中转处理文件/天猫平台与工作台核对.xlsx"
SOURCE = r"D:/麻大师/日更数据/天猫旗舰店/15-聚水潭商品数据/销售主题分析_明细订单商品.xlsx"

# 读取核对文件
import openpyxl  # noqa: E402

wb = openpyxl.load_workbook(RECONCILE, read_only=True)
ws = wb["Sheet1"]
all_rows = list(ws.iter_rows(values_only=True))
header = all_rows[0]
missing_rows = [dict(zip(header, r)) for r in all_rows[1:] if any(r)]
print(f"核对文件缺失订单: {len(missing_rows)} 行（已排除表头）")

# 读取源文件（xlsx2csv API -> polars，与数仓管线一致）
import io  # noqa: E402
from xlsx2csv import Xlsx2csv  # noqa: E402

csv_buf = io.StringIO()
Xlsx2csv(SOURCE, outputencoding="utf-8").convert(csv_buf, sheetid=1)
csv_text = csv_buf.getvalue()
import csv as _csv  # noqa: E402

first_line = csv_text.splitlines()[0]
col_names = next(_csv.reader([first_line]))
schema_overrides = {name: pl.String for name in col_names}
source = pl.read_csv(io.StringIO(csv_text), schema_overrides=schema_overrides)
print(f"源文件: {source.shape[0]} 行 x {source.shape[1]} 列")
for col in ("线上子订单编号", "线上订单号", "内部订单号"):
    if col in source.columns:
        print(f"  匹配列 {col} 示例: {source[col].head(2).to_list()}")


def norm(v):
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


# 建立索引：多个编号列 -> 行（用 polars join，避免全量 to_dicts 内存溢出）
index_cols = [c for c in ("线上子订单编号", "线上订单号", "内部订单号", "平台外部订单号") if c in source.columns]
need_cols = list(set(index_cols + ["订单类型", "买家实付", "线上商品名", "商品简称", "店铺", "买家留言", "销售数量"]))
need_cols = [c for c in source.columns if c in need_cols]
src_subset = source.select(need_cols)


def classify(title: str) -> str | None:
    """命中 manual_zero 标题规则则返回规则名，否则 None。"""
    if title is None:
        return "manual_zero:标题为空"
    t = title
    if "礼品袋" in t:
        return "manual_zero:含礼品袋"
    if "差" in t:
        return "manual_zero:含差"
    if t in JUSHUITAN_MANUAL_ZERO_EXACT_NAMES:
        return "manual_zero:精确命中列表"
    if "皮革" in t:
        return "manual_zero:含皮革"
    if "单拍不发货" in t:
        return "manual_zero:含单拍不发货"
    if "0.01" in t:
        return "manual_zero:含0.01"
    if "链接" in t:
        return "manual_zero:含链接"
    if "入会" in t:
        return "manual_zero:含入会"
    if "袋子" in t:
        return "manual_zero:含袋子"
    if "小额收款" in t:
        return "manual_zero:含小额收款"
    if "麻大师环保黄麻手提袋" in t:
        return "manual_zero:含环保黄麻手提袋"
    return None


def reasons_for(row) -> list[str]:
    """按 transforms.py 真实顺序（transforms.py:516-542）判定命中环节，返回全部命中（非首个）。

    低实付不提前 return——取消 >=50 后仍需检查是否命中 manual_zero（礼品袋/坐垫等会继续被剔）。
    """
    from ecom_pipeline.transforms import JUSHUITAN_EXCLUDED_STORES  # noqa: E402

    order_type = str(row.get("订单类型") or "").strip()
    payment = row.get("买家实付")
    try:
        payment_f = float(payment) if payment is not None and payment != "" else None
    except (TypeError, ValueError):
        payment_f = None
    title = norm(row.get("线上商品名")) or (row.get("商品简称") and norm(row.get("商品简称")))
    store = norm(row.get("店铺"))
    memo = norm(row.get("买家留言"))
    qty = row.get("销售数量")

    hits: list[str] = []
    # 1. 订单类型
    if order_type != "普通订单":
        hits.append(f"订单类型非普通订单: {order_type or '(空)'}")
    # 2. 买家实付 >= 50（已取消，仅标注）
    if payment_f is not None and payment_f < 50:
        hits.append(f"买家实付<50（已取消，现应保留）: {payment_f}")
    # 3. 排除店铺
    if store in JUSHUITAN_EXCLUDED_STORES:
        hits.append(f"排除店铺: {store}")
    # 4. 返修
    if memo and "返修" in memo:
        hits.append("买家留言含返修")
    # 5. manual_zero 标题规则
    hit = classify(title)
    if hit:
        hits.append(hit)
    # 6. 销售数量 = 0
    try:
        if float(qty or 0) == 0:
            hits.append("销售数量=0")
    except (TypeError, ValueError):
        pass
    return hits


# 用 polars join 匹配核对编号到源行
def norm_pl(col):
    return pl.col(col).cast(pl.String, strict=False).str.strip_chars()

joined = None
for col in index_cols:
    probe = pl.DataFrame({"probe_id": [norm(m.get("子订单编号")) or norm(m.get("主订单编号")) for m in missing_rows]})
    matched = src_subset.with_columns(norm_pl(col).alias("probe_id")).drop_nulls("probe_id").join(
        probe, on="probe_id", how="semi"
    )
    if joined is None:
        joined = matched.unique(subset=["probe_id"])
    else:
        joined = pl.concat([joined, matched]).unique(subset=["probe_id"])

matched_ids = set(joined["probe_id"].to_list()) if joined is not None else set()
src_by_id = {}
for r in src_subset.to_dicts():
    for col in index_cols:
        k = norm(r.get(col))
        if k:
            src_by_id.setdefault(k, r)

stats = {}
details = []
unmatched = []
for m in missing_rows:
    sub_id = norm(m.get("子订单编号")) or norm(m.get("主订单编号"))
    title = norm(m.get("商品标题"))
    row = src_by_id.get(sub_id)
    if row is None:
        unmatched.append((sub_id, title))
        continue
    reasons = reasons_for(row)
    key = tuple(reasons) if reasons else "None"
    stats[key] = stats.get(key, 0) + 1
    details.append({"子订单编号": sub_id, "商品标题": title, "环节": reasons or None})

print("\n===== 分类统计（多重命中用 + 连接）=====")
for reason, cnt in sorted(stats.items(), key=lambda kv: -kv[1]):
    label = reason if reason == "None" else " + ".join(reason)
    print(f"  {cnt:>4}  {label}")
print(f"\n  {len(unmatched):>4}  源文件未匹配到（可能不在当前源快照）")

with open("/tmp/missing_reasons.json", "w", encoding="utf-8") as f:
    json.dump({"stats": {str(k): v for k, v in stats.items()}, "details": details, "unmatched": unmatched}, f, ensure_ascii=False, indent=1)
print("\n明细已写入 /tmp/missing_reasons.json")
