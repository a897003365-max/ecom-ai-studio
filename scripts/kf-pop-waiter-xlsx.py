#!/usr/bin/env python3
"""把 kf-pop-waiter-days.json（逐天每人数据）生成 京东pop<date>.xlsx 源文件。

列 schema 对齐接待数据文件夹现有 京东popYYYY-MM-DD.xlsx 产物（10 业务列），
落入 D:\\麻大师\\日更数据\\天猫旗舰店\\10-2京东客服绩效明细\\接待数据\\ 后，
由 python pipeline/sync.py sync 增量入仓（transforms 高置信判定 -> 店铺=京东POP）。

用法：
  批量（回填）：python scripts/kf-pop-waiter-xlsx.py [days.json] [--dry]
  单日（9:50 monitor）：python scripts/kf-pop-waiter-xlsx.py --day=YYYY-MM-DD --src=<单日json> --dest=<接待数据目录> [--force]
    单日 json 格式 {"YYYY-MM-DD": [waiterDim rows...]}（kf-pop-daily-sync --monitor 归档产物）。
"""
import json
import sys
from pathlib import Path

from openpyxl import Workbook

# waiterDim item -> xlsx 列（列名必须与现有产物一致，管道按列名识别）
COLUMNS = [
    ("客服", "waiter"),
    ("新平均响应时间", "responseAvgDuration"),
    ("留言量", None),  # 京麦每人导出无对应字段，与现有产物一致留空
    ("售前接待人数", "beforeOrderCusNum"),
    ("促成下单人数", "orderCusNum"),
    ("促成下单商品金额", "orderSalePrice"),
    ("值班客服数", None),  # 每人维度无意义，留空
    ("售前下单转化率", "orderConversionRate"),
    ("接待量", "consultNum"),
    ("满意率", "satisfiedRate"),
]
DEFAULT_SRC = Path("local-data/tmp/kf-pop-waiter-days.json")
DEFAULT_DEST = Path(r"D:\麻大师\日更数据\天猫旗舰店\10-2京东客服绩效明细\接待数据")


def parse_args():
    src, day, dest, force, dry, positional = DEFAULT_SRC, None, DEFAULT_DEST, False, False, []
    for a in sys.argv[1:]:
        if a == "--dry":
            dry = True
        elif a == "--force":
            force = True
        elif a.startswith("--day="):
            day = a.split("=", 1)[1]
        elif a.startswith("--src="):
            src = a.split("=", 1)[1]
        elif a.startswith("--dest="):
            dest = a.split("=", 1)[1]
        else:
            positional.append(a)
    if positional:  # 兼容旧批量用法：位置参数 = days.json
        src = positional[0]
    return Path(src), day, Path(dest), force, dry


def num(v):
    """API 数值/字符串/NaN -> 数值或 None。"""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f != f else f  # NaN check


def write_day(day: str, rows: list, dest_dir: Path, force: bool, dry: bool) -> str:
    dest = dest_dir / f"京东pop{day}.xlsx"
    if not rows:
        return "skip_empty"
    if dest.exists() and not force:
        return "skip_exists"
    if dry:
        return "made"
    wb = Workbook()
    ws = wb.active
    ws.append([c for c, _ in COLUMNS])
    for item in rows:
        row = []
        for _, field in COLUMNS:
            if field == "waiter":
                row.append(str(item.get("waiter") or ""))
            elif field is None:
                row.append(None)
            else:
                row.append(num(item.get(field)))
        ws.append(row)
    wb.save(dest)
    return "made"


def main():
    src, day, dest, force, dry = parse_args()
    days: dict = json.loads(src.read_text(encoding="utf-8"))
    dest.mkdir(parents=True, exist_ok=True)
    targets = [day] if day else sorted(days)
    if day and day not in days:
        raise SystemExit(f"[xlsx] {src} 中没有 {day} 的数据")
    made, skipped = 0, 0
    for d in targets:
        result = write_day(d, days[d] or [], dest, force, dry)
        if result == "made":
            made += 1
        else:
            skipped += 1
    print(f"[xlsx] 生成 {made} 个, 跳过 {skipped} 个 -> {dest}")
    if dry:
        print("[xlsx] dry-run 未写盘")


if __name__ == "__main__":
    main()
