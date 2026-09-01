# -*- coding: utf-8 -*-
"""深挖 missing_reasons 中 None（规则全过仍缺失）与未匹配两类订单的源行细节。"""
import io
import json
import sys
from pathlib import Path

import polars as pl
from xlsx2csv import Xlsx2csv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))

SOURCE = r"D:/麻大师/日更数据/天猫旗舰店/15-聚水潭商品数据/销售主题分析_明细订单商品.xlsx"

csv_buf = io.StringIO()
Xlsx2csv(SOURCE, outputencoding="utf-8").convert(csv_buf, sheetid=1)
csv_text = csv_buf.getvalue()
import csv as _csv  # noqa: E402

col_names = next(_csv.reader([csv_text.splitlines()[0]]))
schema_overrides = {name: pl.String for name in col_names}
source = pl.read_csv(io.StringIO(csv_text), schema_overrides=schema_overrides)

with open("/tmp/missing_reasons.json", encoding="utf-8") as f:
    data = json.load(f)

details = data["details"]
none_rows = [d for d in details if d["环节"] is None]
lowpay = [d for d in details if d["环节"] and "买家实付" in d["环节"]]
unmatched = data["unmatched"]

print(f"规则全过仍缺失(None): {len(none_rows)}")
print(f"买家实付<50: {len(lowpay)}")
print(f"未匹配: {len(unmatched)}")

# 列筛选
show_cols = ["线上子订单编号", "线上订单号", "内部订单号", "订单类型", "订单状态", "订单日期",
             "付款日期", "店铺", "线上商品名", "商品简称", "买家实付", "商家实收", "销售数量", "订单来源", "商店站点"]
show_cols = [c for c in show_cols if c in source.columns]

# 索引
by_id = {}
for r in source.to_dicts():
    for col in ("线上子订单编号", "线上订单号", "内部订单号", "平台外部订单号"):
        k = str(r.get(col) or "").strip()
        if k:
            by_id.setdefault(k, r)

print("\n===== 规则全过仍缺失 (None) 的源行 =====")
for d in none_rows:
    r = by_id.get(d["子订单编号"])
    if not r:
        print(f"  [{d['子订单编号']}] {d['商品标题'][:30]} -> 源行未匹配")
        continue
    vals = {c: str(r.get(c))[:40] for c in show_cols}
    print(f"  {d['子订单编号']} 日期={vals.get('订单日期')} 店={vals.get('店铺')} 状态={vals.get('订单状态')} "
          f"类型={vals.get('订单类型')} 实付={vals.get('买家实付')} 实收={vals.get('商家实收')} 数量={vals.get('销售数量')}")
    print(f"      标题={vals.get('线上商品名')} 来源={vals.get('订单来源')}")

print("\n===== 未匹配订单编号特征 =====")
prefixes = {}
for sid, title in unmatched:
    if sid and sid[0].isdigit():
        p = sid[:4]
        prefixes[p] = prefixes.get(p, 0) + 1
    print(f"  {sid} {title[:30]}")
print("前缀分布:", dict(sorted(prefixes.items(), key=lambda kv: -kv[1])))
