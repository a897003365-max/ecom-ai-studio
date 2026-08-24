"""按 PBIX ``15-聚水潭商品数据`` 的 Power Query M 精确复现 39 列输出。

基准来源
========
``D:/麻大师/BI文件/麻大师商品数据报表.pbix`` 的 ``15-聚水潭商品数据`` 查询
及其依赖的 hidden 查询（``聚水潭商品数据_全量处理``、``辅10-产品编码``、
``京东自营商品表``、``线下``、``01-店铺数据辅助表``、``店铺名称对应表``）。

M 代码基线存档在 ``migration/powerbi-tmdl/jushuitan-expressions/*.pq``，
从 PBIX 的 TMSCHEMA_EXPRESSIONS 经 ADOMD 导出。本模块以那份 M 为唯一取数基准，
不再使用旧 48 列管线的推断逻辑。

目标
====
每天 9:45 基于最新源文件（``15-聚水潭商品数据/销售主题分析_明细订单商品.xlsx``）
输出与 PBIX 一致的 39 列（含过滤、产品 join、年月/周/单件价格/毛利额派生、去重）。
"""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Iterable

import pandas as pd
import polars as pl

from .config import configured_data_root

# 输出 39 列，顺序与 PBIX 最终 Table.SelectColumns 一致
OUTPUT_COLUMNS = [
    "线上订单号", "线上子订单编号", "线上商品名", "销售数量", "商家实收", "买家实付", "退货金额",
    "SPU产品商编", "产品名称", "子名称", "商品编码", "颜色规格", "商品id", "渠道平台",
    "店铺简称", "是否定制", "定制备注标签", "订单状态汇总", "订单状态明细",
    "床垫类别", "年月", "付款日期", "发货日期", "确认收货日期", "发货仓", "买家ID",
    "成本", "订单状态", "卖家备注", "小旗", "店铺简称（结算店铺）",
    "厚度", "尺寸", "店铺", "商品简称", "毛利额", "单件价格", "周", "内部订单号",
]

# M 第 5 步：排除的非麻大师店铺
EXCLUDED_STORES = {
    "伊凯琳家具旗舰店-周飞-猫1",
    "伊凯琳家居特卖旗舰店-周飞-唯1",
    "艾美悦旗舰店-周飞-猫8",
}

# M 第 9 步：手动置零的精确商品名
MANUAL_ZERO_EXACT = {
    "0.01入会专拍链接",
    "1",
    "【3支-紫杆（黑）】【禾硕新5度+东米605刷题能量笔+知心k181】",
    "【3支-蓝杆（黑）】【禾硕新5度+东米605刷题能量笔+知心k181】",
    "入会专拍链接",
    "【优惠价】麻大师乳胶枕头泰国进口正品成人呵护颈椎家用睡眠宿舍橡胶枕芯",
    "【优惠价】麻大师瑜伽茶道黄麻坐垫蒲团坐垫客厅阳台飘窗榻榻米日式坐垫",
    "【特权定金】麻大师乳胶枕头泰国进口正品成人呵护颈椎家用睡眠宿舍橡胶枕芯",
    "麻大师乳胶枕头泰国进口正品成人呵护颈椎家用睡眠宿舍橡胶枕芯",
    "麻大师瑜伽茶道黄麻坐垫蒲团坐垫客厅阳台飘窗榻榻米日式坐垫",
    "麻大师瑜伽茶道黄麻坐垫蒲团坐垫客厅阳台飘窗榻榻米日式坐垫 麻大师坐垫:6CM厚 34cm*40cm",
    "麻大师瑜伽茶道黄麻坐垫蒲团坐垫客厅阳台飘窗榻榻米日式坐垫40cm*40cm 麻大师坐垫:6CM厚 40cm*40cm",
}

# M 第 16 步：抖音达人细分白名单
DOUYIN_KNOWN_DAREN = {
    "与辉同行", "「神机榜」床垫严选", "「神机榜」家居严选",
    "东方甄选家居馆", "兰知春序", "东方甄选美丽生活",
}


def _unique_columns(values: list[str]) -> list[str]:
    counts: dict[str, int] = {}
    result = []
    for value in values:
        base = value if value else "Column"
        count = counts.get(base, 0)
        counts[base] = count + 1
        result.append(base if count == 0 else f"{base}.{count}")
    return result


def _read_excel_sheet1(path: Path) -> pl.DataFrame:
    """M ``转换文件 (N)``：读 xlsx 的 Sheet1 并提升表头（列名唯一化）。

    大文件（>20MB）走 xlsx2csv 快路径（比 pandas+openpyxl 快约 3×），
    与 pipeline/readers.py 的 ``_read_excel_xlsx2csv`` 同思路。
    """
    path = Path(path)
    if path.stat().st_size > 20 * 1024 * 1024:
        try:
            return _read_excel_xlsx2csv_fast(path)
        except Exception:
            pass
    frame = pd.read_excel(path, sheet_name=0, dtype=object, header=None)
    frame = frame.where(pd.notna(frame), None)
    # 提升表头：第一行作为列名（Power Query 会对重复列名自动加 .N 后缀）
    headers = [str(v) if v is not None else f"Column{i+1}" for i, v in enumerate(frame.iloc[0])]
    frame = frame.iloc[1:]
    frame.columns = _unique_columns(headers)
    # Excel.Workbook 默认把单元格当作文本；混合类型 object 列统一按文本处理
    frame = frame.astype(object).map(lambda value: None if value is None else str(value))
    return pl.from_pandas(frame, include_index=False, nan_to_null=True)


def _read_excel_xlsx2csv_fast(path: Path) -> pl.DataFrame:
    """大 xlsx 快路径：xlsx2csv 转 csv 再 Polars 读，第一行提升为表头。"""
    import io

    import xlsx2csv

    buf = io.StringIO()
    xlsx2csv.Xlsx2csv(str(path)).convert(buf)
    buf.seek(0)
    import csv as _csv

    reader = _csv.reader(buf.getvalue().splitlines())
    rows = list(reader)
    if not rows:
        return pl.DataFrame()
    headers = _unique_columns([str(h) if h else f"Column{i+1}" for i, h in enumerate(rows[0])])
    data = rows[1:]
    # Excel.Workbook 语义：空单元格 = null（M 的 `_ = null` 判断依赖此语义）。
    # xlsx2csv 的空字段是 ""，这里归一为 None，与 pandas 路径对齐。
    return pl.DataFrame(
        {
            headers[i]: [row[i] if i < len(row) and row[i] != "" else None for row in data]
            for i in range(len(headers))
        }
    )


def _discover_source_files(directory: Path, suffixes: Iterable[str] = (".xlsx", ".xls")) -> list[Path]:
    return sorted(
        path for path in directory.rglob("*")
        if path.is_file() and path.suffix.lower() in suffixes and not path.name.startswith(("~$", "."))
    )


def _read_excel_sheet_named(path: Path, sheet: str | int = 0) -> pl.DataFrame:
    """读指定 sheet 并提升表头（列名唯一化），空单元格 → null。"""
    frame = pd.read_excel(path, sheet_name=sheet, dtype=object, header=None)
    frame = frame.where(pd.notna(frame), None)
    headers = [str(v) if v is not None else f"Column{i+1}" for i, v in enumerate(frame.iloc[0])]
    frame = frame.iloc[1:]
    frame.columns = _unique_columns(headers)
    frame = frame.astype(object).map(lambda value: None if value is None else str(value))
    return pl.from_pandas(frame, include_index=False, nan_to_null=True)


def _load_辅10_产品编码(data_root: Path) -> pl.DataFrame:
    """复现 M ``辅10-产品编码``：6 张产品表 union + 各组件 rename/派生 + 发货仓改名 + 去重。

    组件表及其 M 定义的 rename/派生（对应 C:\\tmp\\pbix_m\\*.pq）：
      - 辅4-床垫编码（产品明细.xlsx）：做货工厂→发货仓
      - 辅5-床类编码（床类编码.xlsx）：主型号→SPU产品商编、id→商品ID、商家编码（后台）→商家规编（后台）；
        按商家规编 join 辅4 取床垫类别（null→"床类"）；合计成本→成本、做货工厂→发货仓
      - 拼多多商品：做货工厂→发货仓
      - 家纺商品表：成本#(lf)（不含运费）→成本、名称→产品名称、类别→家纺类别、床垫类别="家纺"
      - 京东自营商品表（自营商品表.xlsx）：三级类目→床垫类别、SKUid→商品ID、sku标题→sku名称（后台）、
        SKU产品名→产品名称、SPU产品名→SPU产品商编、规格→尺寸
      - 京东POP商品表（pop商品表.xlsx）：规格→尺寸、商家编码→商家规编（后台）、SPU产品名→SPU产品商编
      - 发货仓改名表.xlsx：sheet "导出计数_发货仓"，旧名→新名
    """
    products_dir = data_root / "天猫旗舰店" / "商品信息文件"

    # 辅4-床垫编码
    source4 = products_dir / "产品明细.xlsx"
    if not source4.exists():
        raise FileNotFoundError(f"缺少产品明细.xlsx: {source4}")
    f4 = _read_excel_sheet1(source4)
    if "做货工厂" in f4.columns:
        f4 = f4.rename({"做货工厂": "发货仓"})

    # 辅5-床类编码
    source5 = products_dir / "床类编码.xlsx"
    f5 = pl.DataFrame()
    if source5.exists():
        raw5 = _read_excel_sheet1(source5)
        rename5 = {}
        if "主型号" in raw5.columns:
            rename5["主型号"] = "SPU产品商编"
        if "id" in raw5.columns:
            rename5["id"] = "商品ID"
        if "商家编码（后台）" in raw5.columns:
            rename5["商家编码（后台）"] = "商家规编（后台）"
        if rename5:
            raw5 = raw5.rename(rename5)
        # join 辅4 取床垫类别（null→"床类"）
        if "商家规编（后台）" in raw5.columns and "商家规编（后台）" in f4.columns and "床垫类别" in f4.columns:
            f4_cat = f4.select(["商家规编（后台）", "床垫类别"]).filter(pl.col("商家规编（后台）").is_not_null()).unique(subset="商家规编（后台）", keep="first")
            raw5 = raw5.join(f4_cat, on="商家规编（后台）", how="left")
            raw5 = raw5.with_columns(pl.col("床垫类别").fill_null("床类"))
        rename5b = {}
        if "合计成本" in raw5.columns:
            rename5b["合计成本"] = "成本"
        if "做货工厂" in raw5.columns:
            rename5b["做货工厂"] = "发货仓"
        if rename5b:
            raw5 = raw5.rename(rename5b)
        f5 = raw5

    # 拼多多商品
    source_pdd = products_dir / "拼多多店铺麻大师床垫产品信息表合集.xlsx"
    f_pdd = pl.DataFrame()
    if source_pdd.exists():
        raw_pdd = _read_excel_sheet1(source_pdd)
        if "做货工厂" in raw_pdd.columns:
            raw_pdd = raw_pdd.rename({"做货工厂": "发货仓"})
        f_pdd = raw_pdd

    # 家纺商品表（M 的 "成本#(lf)（不含运费）" 中 #(lf) 是换行转义，
    # pandas 实际读到的列名是含真实换行符 "成本\n（不含运费）"）
    source_home = products_dir / "家纺商品表.xlsx"
    f_home = pl.DataFrame()
    if source_home.exists():
        raw_home = _read_excel_sheet1(source_home)
        rename_home = {}
        home_cost_col = next((c for c in raw_home.columns if c.startswith("成本") and "不含运费" in c), None)
        if home_cost_col:
            rename_home[home_cost_col] = "成本"
        if "名称" in raw_home.columns:
            rename_home["名称"] = "产品名称"
        if "类别" in raw_home.columns:
            rename_home["类别"] = "家纺类别"
        if rename_home:
            raw_home = raw_home.rename(rename_home)
        raw_home = raw_home.with_columns(pl.lit("家纺").alias("床垫类别"))
        f_home = raw_home

    # 京东自营商品表（辅10 组件）
    source_jd = products_dir / "自营商品表.xlsx"
    f_jd = pl.DataFrame()
    if source_jd.exists():
        raw_jd = _read_excel_sheet1(source_jd)
        rename_jd = {
            "三级类目": "床垫类别", "SKUid": "商品ID", "sku标题": "sku名称（后台）",
            "SKU产品名": "产品名称", "SPU产品名": "SPU产品商编", "规格": "尺寸",
        }
        raw_jd = raw_jd.rename({k: v for k, v in rename_jd.items() if k in raw_jd.columns})
        f_jd = raw_jd

    # 京东POP商品表
    source_pop = products_dir / "pop商品表.xlsx"
    f_pop = pl.DataFrame()
    if source_pop.exists():
        raw_pop = _read_excel_sheet1(source_pop)
        rename_pop = {"规格": "尺寸", "商家编码": "商家规编（后台）", "SPU产品名": "SPU产品商编"}
        raw_pop = raw_pop.rename({k: v for k, v in rename_pop.items() if k in raw_pop.columns})
        f_pop = raw_pop

    combined = pl.concat([f4, f5, f_pdd, f_home, f_jd, f_pop], how="diagonal_relaxed")

    # 发货仓改名（sheet "导出计数_发货仓"，旧名→新名）
    rename_file = products_dir / "发货仓改名表.xlsx"
    if rename_file.exists():
        try:
            rename_map = _read_excel_sheet_named(rename_file, sheet="导出计数_发货仓")
        except Exception:
            rename_map = _read_excel_sheet1(rename_file)
        if "旧名" in rename_map.columns and "新名" in rename_map.columns:
            rename_map = rename_map.select(["旧名", "新名"]).rename({"新名": "发货仓新名"})
            rename_map = rename_map.filter(pl.col("旧名").is_not_null()).unique(subset="旧名", keep="first")
            combined = combined.join(rename_map, left_on="发货仓", right_on="旧名", how="left")
            combined = combined.with_columns(
                pl.when(pl.col("发货仓新名").is_not_null()).then(pl.col("发货仓新名")).otherwise(pl.col("发货仓")).alias("发货仓")
            )
            combined = combined.drop(["发货仓新名"])

    # 类型
    for col, typ in {"商品ID": pl.String, "产品名称": pl.String, "子名称": pl.String,
                     "商家规编（后台）": pl.String, "尺寸": pl.String}.items():
        if col in combined.columns:
            combined = combined.with_columns(pl.col(col).cast(typ, strict=False))

    # 按 商家规编（后台） 去重（M: Table.Distinct）
    if "商家规编（后台）" in combined.columns:
        combined = combined.unique(subset=["商家规编（后台）"], keep="first")

    return combined


def _read_csv_936(path: Path, columns: int | None = None) -> pl.DataFrame:
    """M ``转换文件 (57)``：Csv.Document(Delimiter=',', Encoding=936, Columns=N)。"""
    frame = pd.read_csv(path, sep=",", encoding="gb18030", dtype=object, header=None, nrows=None)
    frame = frame.where(pd.notna(frame), None)
    headers = [str(v) if v is not None else f"Column{i+1}" for i, v in enumerate(frame.iloc[0])]
    frame = frame.iloc[1:]
    frame.columns = _unique_columns(headers)
    frame = frame.astype(object).map(lambda value: None if value is None else str(value))
    return pl.from_pandas(frame, include_index=False, nan_to_null=True)


def _load_京东自营商品表(data_root: Path) -> pl.DataFrame:
    """M ``京东自营商品表``：自营商品表.xlsx（SKUid→商品ID、商家规编（后台））。"""
    source = data_root / "天猫旗舰店" / "商品信息文件" / "自营商品表.xlsx"
    if not source.exists():
        return pl.DataFrame({"商品ID": [], "商家规编（后台）": []})
    frame = _read_excel_sheet1(source)
    rename_map = {}
    if "SKUid" in frame.columns:
        rename_map["SKUid"] = "商品ID"
    if rename_map:
        frame = frame.rename(rename_map)
    keep = [c for c in ("商品ID", "商家规编（后台）") if c in frame.columns]
    if not keep:
        return pl.DataFrame({"商品ID": [], "商家规编（后台）": []})
    return frame.select(keep).unique(subset=keep, keep="first")


def _load_线下(data_root: Path) -> pl.DataFrame:
    """M ``线下``：02-商品明细库存表/线下 文件夹，子订单编号/主订单编号。"""
    folder = data_root / "天猫旗舰店" / "02-商品明细库存表" / "线下"
    frames = [_read_excel_sheet1(path) for path in _discover_source_files(folder)]
    if not frames:
        return pl.DataFrame({"子订单编号": []})
    frame = pl.concat(frames, how="diagonal_relaxed")
    return frame.select([c for c in ("子订单编号", "主订单编号") if c in frame.columns])


def _load_日期辅助表(data_root: Path) -> pl.DataFrame:
    """M ``01-店铺数据辅助表``：日期 → 周 映射。

    该表的日期列是 Excel 序列号（如 45292 = 2024-01-01），需先转换回日期。
    """
    folder = data_root / "天猫旗舰店" / "01-店铺数据辅助表"
    frames = [_read_excel_sheet1(path) for path in _discover_source_files(folder)]
    if not frames:
        return pl.DataFrame({"日期": [], "周": []})
    frame = pl.concat(frames, how="diagonal_relaxed")
    if "日期" in frame.columns:
        # Excel 序列号（天数，1899-12-30 起）→ 日期；也兼容已是日期/ISO 字符串的值
        serial = pl.col("日期").cast(pl.Float64, strict=False)
        frame = frame.with_columns(
            pl.when(serial.is_not_null() & (serial > 20000))
            .then((pl.lit(pd.Timestamp("1899-12-30")) + pl.duration(seconds=(serial * 86400).cast(pl.Int64))).dt.date())
            .otherwise(pl.col("日期").cast(pl.Date, strict=False))
            .alias("日期")
        )
    return frame


def _load_店铺名称对应表(data_root: Path) -> pl.DataFrame:
    """M ``店铺名称对应表``：ERP店铺对照表.xlsx（ERP店铺名称→店铺、共享表店铺名称→店铺简称）。"""
    source = data_root / "天猫旗舰店" / "商品信息文件" / "ERP店铺对照表.xlsx"
    if not source.exists():
        return pl.DataFrame({"店铺": [], "店铺简称": []})
    frame = _read_excel_sheet1(source)
    rename_map = {}
    if "ERP店铺名称" in frame.columns:
        rename_map["ERP店铺名称"] = "店铺"
    if "共享表店铺名称" in frame.columns:
        rename_map["共享表店铺名称"] = "店铺简称"
    if rename_map:
        frame = frame.rename(rename_map)
    keep = [c for c in ("店铺", "店铺简称") if c in frame.columns]
    if "店铺" not in keep:
        return pl.DataFrame({"店铺": [], "店铺简称": []})
    return frame.select(keep).unique(subset="店铺", keep="first")


def load_auxiliary_tables(data_root: Path | None = None) -> dict[str, pl.DataFrame]:
    """加载 39 列逻辑需要的全部辅助表。"""
    root = data_root or configured_data_root()
    return {
        "辅10产品编码": _load_辅10_产品编码(root),
        "京东自营商品表": _load_京东自营商品表(root),
        "线下": _load_线下(root),
        "日期辅助表": _load_日期辅助表(root),
        "店铺名称对应表": _load_店铺名称对应表(root),
    }


def _as_text(expr: pl.Expr) -> pl.Expr:
    return expr.cast(pl.String, strict=False)


def _date_text_conversion(column: str) -> pl.Expr:
    """M 第 3 步：DateTime.FromText(_, [Culture='en-US'])。"""
    return (
        pl.when(pl.col(column).is_null() | (pl.col(column).cast(pl.String, strict=False) == ""))
        .then(None)
        .otherwise(
            pl.col(column).cast(pl.String, strict=False).str.strptime(pl.Datetime, "%Y/%m/%d %H:%M:%S", strict=False)
        )
    ).alias(column)


def transform_jushuitan_39(frame: pl.DataFrame, aux: dict[str, pl.DataFrame]) -> pl.DataFrame:
    """把源文件（聚水潭明细）按 M 的 24 步转成 39 列输出。

    ``frame`` 是源文件 Sheet1 提升表头后的全量数据（105+ 列）。
    ``aux`` 由 :func:`load_auxiliary_tables` 提供。
    """
    aux_辅10 = aux["辅10产品编码"]
    aux_京东自营 = aux["京东自营商品表"]
    aux_线下 = aux["线下"]
    aux_日期 = aux["日期辅助表"]
    aux_店铺 = aux["店铺名称对应表"]

    # ---- M 第 3 步：安全转换日期时间列 ----
    for col in ("付款日期", "确认收货日期", "发货日期", "订单日期", "供销支付时间"):
        if col in frame.columns:
            frame = frame.with_columns(_date_text_conversion(col))

    # ---- M 第 4 步：核心列类型转换 ----
    number_cols = ["商家实收", "销售数量", "销售金额", "销售毛利", "退货金额", "实退金额", "买家实付"]
    for col in number_cols:
        if col in frame.columns:
            frame = frame.with_columns(pl.col(col).cast(pl.Float64, strict=False))
    text_cols = ["线上订单号", "买家ID", "原始线上订单号", "线上子订单编号", "店铺商品编码",
                 "商品编码", "店铺款式编码", "款式编码", "线上商品名", "买家留言"]
    for col in text_cols:
        if col in frame.columns:
            frame = frame.with_columns(_as_text(pl.col(col)))
    # M 第 4 步：日期列 type date（只保留日期，无时分秒）。
    # 付款日期对齐 M 的 type date；发货/确认收货日期按业务要求也输出短日期（用户指定 v/w/x 列短日期）。
    for col in ("付款日期", "发货日期", "确认收货日期"):
        if col in frame.columns:
            frame = frame.with_columns(pl.col(col).cast(pl.Date, strict=False))

    # ---- M 第 5 步：尽早筛选 ----
    if "订单类型" in frame.columns:
        frame = frame.filter(pl.col("订单类型").cast(pl.String, strict=False) == "普通订单")
    # 买家实付 >= 50 硬过滤已取消（2026-08-19 业务决策，与看板 transforms.py 同步），
    # 低金额订单也纳入导出；0.01 链接等垃圾单仍由第 9 步 manual_zero 置零剔除。
    if "店铺" in frame.columns:
        frame = frame.filter(~pl.col("店铺").cast(pl.String, strict=False).is_in(list(EXCLUDED_STORES)))
    if "买家留言" in frame.columns:
        memo = _as_text(pl.col("买家留言"))
        frame = frame.filter(pl.col("买家留言").is_null() | (~memo.str.contains("返修", literal=True)))

    # ---- M 第 6 步：商店站点 → 渠道平台 ----
    if "商店站点" in frame.columns:
        station = pl.col("商店站点").cast(pl.String, strict=False)
        station = (
            station.str.replace_all("头条放心购", "抖音", literal=True)
            .str.replace_all("京东厂家直送", "京东自营", literal=True)
            .str.replace_all("京东商城", "京东POP", literal=True)
        )
        frame = frame.with_columns(station.alias("渠道平台"))
    elif "渠道平台" not in frame.columns:
        frame = frame.with_columns(pl.lit(None, dtype=pl.String).alias("渠道平台"))

    # ---- M 第 7 步：合并自营 id 编码 → 条件替换商品编码 ----
    if "店铺商品编码" in frame.columns and len(aux_京东自营) > 0 and "商品ID" in aux_京东自营.columns:
        jd_map = aux_京东自营.select(["商品ID", "商家规编（后台）"]).rename({"商家规编（后台）": "自营商家规编"})
        jd_map = jd_map.filter(pl.col("商品ID").is_not_null())
        frame = frame.join(jd_map, left_on="店铺商品编码", right_on="商品ID", how="left")
        if "自营商家规编" in frame.columns and "商品编码" in frame.columns:
            frame = frame.with_columns(
                pl.when(pl.col("自营商家规编").is_not_null()).then(pl.col("自营商家规编")).otherwise(pl.col("商品编码")).alias("商品编码")
            )
            frame = frame.drop(["自营商家规编"])

    # ---- M 第 8 步：合并辅10-产品编码 → 获取产品属性 ----
    if "商品编码" in frame.columns and len(aux_辅10) > 0 and "商家规编（后台）" in aux_辅10.columns:
        product_keep = [c for c in ("商家规编（后台）", "产品名称", "子名称", "SPU产品商编", "发货仓", "床垫类别", "厚度", "尺寸", "成本") if c in aux_辅10.columns]
        pm = aux_辅10.select(product_keep).rename({"商家规编（后台）": "pm_key", "发货仓": "发货仓.1"})
        pm = pm.filter(pl.col("pm_key").is_not_null())
        frame = frame.join(pm, left_on="商品编码", right_on="pm_key", how="left")

    # ---- M 第 8.5 步：成本转换（暂无//→0；null 保持 null）----
    # M: txt = Text.From(_); if txt="暂无" or txt="/" then 0 else try Number.From(_) otherwise 0
    # Number.From(null) 返回 null（非 error），所以 join 不上时的 null 保持 null（不是 0）。
    if "成本" in frame.columns:
        cost_raw = pl.col("成本")
        cost_text = _as_text(cost_raw)
        cost_num = cost_raw.cast(pl.Float64, strict=False)
        frame = frame.with_columns(
            pl.when(cost_text == "暂无").then(0.0)
            .when(cost_text == "/").then(0.0)
            .when(cost_num.is_not_null()).then(cost_num)
            .when(cost_raw.is_null()).then(None)
            .otherwise(0.0)
            .alias("成本")
        )

    # ---- M 第 9 步：手动将指定商品销售数量改为 0 ----
    if "线上商品名" in frame.columns and "销售数量" in frame.columns:
        product_name = _as_text(pl.col("线上商品名")).fill_null("")
        needs_zero = (
            pl.col("线上商品名").is_null()
            | product_name.str.contains("礼品袋", literal=True)
            | product_name.str.contains("差", literal=True)
            | product_name.is_in(list(MANUAL_ZERO_EXACT))
            | product_name.str.contains("皮革", literal=True)
            | product_name.str.contains("单拍不发货", literal=True)
            | product_name.str.contains("0.01", literal=True)
            | product_name.str.contains("链接", literal=True)
            | product_name.str.contains("入会", literal=True)
            | product_name.str.contains("袋子", literal=True)
            | product_name.str.contains("小额收款", literal=True)
            | product_name.str.contains("麻大师环保黄麻手提袋", literal=True)
        )
        frame = frame.with_columns(
            pl.when(needs_zero).then(0).otherwise(pl.col("销售数量").cast(pl.Int64, strict=False)).alias("销售数量")
        )

    # ---- M 第 10 步：填充空值 ----
    if "小旗" in frame.columns:
        frame = frame.with_columns(pl.col("小旗").fill_null("灰色旗帜").cast(pl.String, strict=False))
    if "标记多标签" in frame.columns:
        frame = frame.with_columns(pl.col("标记多标签").fill_null("无").cast(pl.String, strict=False))
    if "卖家备注" in frame.columns:
        frame = frame.with_columns(pl.col("卖家备注").fill_null("").cast(pl.String, strict=False))

    # ---- M 第 11 步：添加订单状态明细与汇总 ----
    if all(c in frame.columns for c in ("售后分类", "发货日期", "确认收货日期", "小旗", "订单状态", "付款日期")):
        after_sale = _as_text(pl.col("售后分类"))
        flag = _as_text(pl.col("小旗"))
        raw_status = _as_text(pl.col("订单状态"))
        pending_status = (
            (raw_status == "异常")
            | raw_status.str.contains("等供销", literal=True)
            | raw_status.str.contains("发货中", literal=True)
            | raw_status.str.contains("已付款待审核", literal=True)
        )
        status_detail = (
            pl.when(after_sale == "仅退款").then(pl.lit("交易关闭（仅退款）"))
            .when(after_sale == "普通退货").then(pl.lit("交易关闭（退货退款）"))
            .when(pl.col("发货日期").is_not_null()).then(pl.lit("已发货"))
            .when(pl.col("确认收货日期").is_not_null()).then(pl.lit("已收货"))
            .when(flag.str.contains("紫", literal=True)).then(pl.lit("等通知"))
            .when(flag.str.contains("黄", literal=True)).then(pl.lit("指定日"))
            .when(pending_status).then(pl.lit("待发货"))
            .when(pl.col("付款日期").is_null()).then(pl.lit("未付款"))
            .otherwise(raw_status)
        )
        # M 用 Replacer.ReplaceText（子串替换）：订单状态明细中含 "已取消" 子串 → 交易关闭（仅退款）
        status_detail = status_detail.cast(pl.String, strict=False).str.replace("已取消", "交易关闭（仅退款）", literal=True)
        status_summary = (
            pl.when(status_detail.is_in(["待发货", "等通知", "指定日"])).then(pl.lit("待发"))
            .when(status_detail.is_in(["已发货", "已收货"])).then(pl.lit("已发"))
            .otherwise(pl.lit("未付款或交易关闭"))
        )
        frame = frame.with_columns(
            status_detail.cast(pl.String, strict=False).alias("订单状态明细"),
            status_summary.cast(pl.String, strict=False).alias("订单状态汇总"),
        )

    # ---- M 第 12 步：是否定制 + 定制备注标签 ----
    if "卖家备注" in frame.columns:
        remark = _as_text(pl.col("卖家备注")).fill_null("")
        is_custom = (
            remark.str.contains("定制", literal=True)
            | remark.str.contains("厚度", literal=True)
            | remark.str.contains("订制", literal=True)
            | remark.str.contains("特殊", literal=True)
            | remark.str.contains("横折", literal=True)
            | remark.str.contains("竖折", literal=True)
            | remark.str.contains("折叠", literal=True)
            | remark.str.contains("对角", literal=True)
            | remark.str.contains("对折", literal=True)
        )
        custom_tag = (
            pl.when(remark.str.contains("定制尺寸/缺角/折叠/内材", literal=True) | remark.str.contains("定制异形", literal=True)).then(pl.lit("定制异形"))
            .when(remark.str.contains("定制尺寸", literal=True)).then(pl.lit("定制尺寸"))
            .when(remark.str.contains("定制内材", literal=True)).then(pl.lit("定制内材"))
            .when(remark.str.contains("定制厚度", literal=True)).then(pl.lit("定制厚度"))
            .when(remark.str.contains("定制折叠", literal=True)).then(pl.lit("定制折叠"))
            .when(remark.str.contains("定制缺角", literal=True)).then(pl.lit("定制缺角"))
            .when(remark.str.contains("更换赠品", literal=True)).then(pl.lit("更换赠品"))
            .otherwise(None)
        )
        frame = frame.with_columns(
            pl.when(is_custom).then(pl.lit("定制")).otherwise(pl.lit("常规")).alias("是否定制"),
            custom_tag.cast(pl.String, strict=False).alias("定制备注标签"),
        )

    # ---- M 第 13 步：颜色规格处理（SplitAny ",，" 取第一段）----
    if "颜色规格" in frame.columns:
        # polars str.split 的 pattern 是字面量（非正则）；先把中文逗号统一成英文再 split
        spec = _as_text(pl.col("颜色规格")).str.replace_all("，", ",", literal=True)
        frame = frame.with_columns(
            pl.when(pl.col("颜色规格").is_null())
            .then(None)
            .otherwise(spec.str.split(",", strict=False).list.get(0))
            .alias("颜色规格")
        )

    # ---- M 第 14 步：合并线下表（判断新零售）----
    if "线上子订单编号" in frame.columns and len(aux_线下) > 0 and "子订单编号" in aux_线下.columns:
        offline_ids = (
            aux_线下.select(["子订单编号"])
            .filter(pl.col("子订单编号").is_not_null())
            .unique()
            .with_columns(pl.lit(1).alias("线下匹配标记"))
            .rename({"子订单编号": "线下子订单编号"})
        )
        frame = frame.join(offline_ids, left_on="线上子订单编号", right_on="线下子订单编号", how="left")

    # ---- M 第 15 步：合并店铺名称对应表 → 店铺简称 ----
    if "店铺" in frame.columns and len(aux_店铺) > 0 and "店铺" in aux_店铺.columns:
        shop_map = aux_店铺.select(["店铺", "店铺简称"]).rename({"店铺简称": "店铺简称映射"})
        shop_map = shop_map.filter(pl.col("店铺").is_not_null()).unique(subset="店铺", keep="first")
        frame = frame.join(shop_map, on="店铺", how="left")
    else:
        frame = frame.with_columns(pl.lit(None, dtype=pl.String).alias("店铺简称映射"))

    # ---- M 第 16 步：抖音细分及店铺简称加工 ----
    if "渠道平台" in frame.columns and "达人名称" in frame.columns:
        channel = _as_text(pl.col("渠道平台"))
        daren = _as_text(pl.col("达人名称"))
        daren = pl.when(daren == "null").then(None).otherwise(daren)
        douyin_sub = (
            pl.when(channel != "抖音").then(pl.lit("非抖音渠道"))
            .when(daren.is_null() | daren.is_in(["麻大师床垫旗舰店", "麻大师官方旗舰店"])).then(pl.lit("抖1"))
            .when(daren == "麻大师床垫官方直播间").then(pl.lit("抖2"))
            .when(daren == "麻大师官方旗舰店直播间").then(pl.lit("抖3"))
            .when(daren.is_in(list(DOUYIN_KNOWN_DAREN))).then(daren)
            .otherwise(pl.lit("抖音达人"))
        )
        # 店铺简称2 = 非抖音用店铺简称，否则抖音细分
        shop_short2 = pl.when(douyin_sub == "非抖音渠道").then(pl.col("店铺简称映射")).otherwise(douyin_sub)
        # 店铺简称3 = 线下订单（线上子订单编号命中线下表）→ 新零售
        if "线下匹配标记" in frame.columns:
            shop_short3 = pl.when(pl.col("线下匹配标记") == 1).then(pl.lit("新零售")).otherwise(shop_short2)
        else:
            shop_short3 = shop_short2
        # 店铺简称4 = 卖家备注含 M0 → 新零售
        if "卖家备注" in frame.columns:
            remark = _as_text(pl.col("卖家备注")).fill_null("")
            shop_short4 = pl.when(remark.str.contains("M0", literal=True)).then(pl.lit("新零售")).otherwise(shop_short3)
        else:
            shop_short4 = shop_short3
        frame = frame.with_columns(
            shop_short2.cast(pl.String, strict=False).alias("店铺简称（结算店铺）"),
            shop_short4.cast(pl.String, strict=False).alias("店铺简称"),
            # 渠道平台 = 店铺简称=新零售 ? 新零售 : 渠道平台
            pl.when(shop_short4 == "新零售").then(pl.lit("新零售")).otherwise(channel).alias("渠道平台"),
        )

    # ---- M 第 17 步：添加年月（付款日期 yyyy-MM）----
    if "付款日期" in frame.columns:
        frame = frame.with_columns(
            pl.col("付款日期").cast(pl.Date, strict=False).dt.strftime("%Y-%m").alias("年月")
        )

    # ---- M 第 18-19 步：删除冗余列 + 商品id（店铺款式编码→商品id）----
    if "店铺款式编码" in frame.columns:
        frame = frame.rename({"店铺款式编码": "商品id"})

    # ---- M 第 20 步：单件价格 = 商家实收/销售数量；毛利额 = 商家实收 - 成本×销售数量 ----
    # M: 单件价格 = try [商家实收]/[销售数量] otherwise 0（仅除零→0，null/1=null 保持 null）
    #     毛利额 = [商家实收] - [成本]*[销售数量]（null 传播，成本 null 时毛利额 null）
    if "商家实收" in frame.columns and "销售数量" in frame.columns:
        received = pl.col("商家实收").cast(pl.Float64, strict=False)
        qty = pl.col("销售数量").cast(pl.Float64, strict=False).fill_null(0)
        frame = frame.with_columns(
            (pl.when(qty != 0).then(received / qty).otherwise(0.0)).alias("单件价格"),
        )
    if "成本" in frame.columns:
        cost = pl.col("成本").cast(pl.Float64, strict=False)
        frame = frame.with_columns((received - cost * qty).alias("毛利额"))

    # ---- M 第 21 步：合并日期辅助表 → 周 ----
    if "付款日期" in frame.columns and len(aux_日期) > 0 and "日期" in aux_日期.columns:
        week_map = aux_日期.select(["日期", "周"]).rename({"日期": "aux_date", "周": "周"})
        week_map = week_map.filter(pl.col("aux_date").is_not_null()).unique(subset="aux_date", keep="first")
        frame = frame.with_columns(pl.col("付款日期").cast(pl.Date, strict=False).alias("aux_date"))
        frame = frame.join(week_map, on="aux_date", how="left").drop(["aux_date"])

    # ---- M 第 22 步：修正发货仓（2026-05-27 前、未设定、已发 → 发货仓.1）----
    if "发货仓.1" in frame.columns:
        frame = frame.with_columns(
            pl.when(
                (pl.col("付款日期").cast(pl.Date, strict=False) < date(2026, 5, 27))
                & (_as_text(pl.col("发货仓")) == "---- 未设定 ----")
                & (_as_text(pl.col("订单状态汇总")) == "已发")
            )
            .then(pl.col("发货仓.1"))
            .otherwise(pl.col("发货仓"))
            .cast(pl.String, strict=False)
            .alias("发货仓")
        )

    # ---- M 第 23 步：选择最终 39 列 + 去重 ----
    final = frame.select([c for c in OUTPUT_COLUMNS if c in frame.columns])
    # 补齐缺失列（保持 39 列宽度）
    missing = [c for c in OUTPUT_COLUMNS if c not in final.columns]
    if missing:
        final = final.with_columns([pl.lit(None, dtype=pl.String).alias(c) for c in missing])
    final = final.select(OUTPUT_COLUMNS)
    # 类型
    final = final.with_columns(pl.col("销售数量").cast(pl.Int64, strict=False))
    final = final.with_columns(pl.col("单件价格").cast(pl.Float64, strict=False))
    final = final.with_columns(pl.col("毛利额").cast(pl.Float64, strict=False))
    # M 第 24 步：去重
    final = final.unique(keep="first")
    # PBIX 最终查询 `15-聚水潭商品数据` = 全量处理 + 排除手动置零（销售数量 <> 0）。
    # 第 9 步手动置零后，把销售数量为 0 的行剔除（0.01链接/补差/入会等）。
    if "销售数量" in final.columns:
        final = final.filter(pl.col("销售数量") != 0)
    return final


def build_jushuitan_39(source_path: Path | None = None, data_root: Path | None = None) -> pl.DataFrame:
    """读取最新源文件并按 M 生成 39 列（含辅助表加载）。"""
    root = data_root or configured_data_root()
    source_dir = root / "天猫旗舰店" / "15-聚水潭商品数据"
    if source_path is not None:
        frame = _read_excel_sheet1(Path(source_path))
    else:
        candidates = _discover_source_files(source_dir)
        if not candidates:
            raise FileNotFoundError(f"15-聚水潭商品数据 目录无源文件: {source_dir}")
        # M 用 Folder.Files 合并目录全部文件（当前目录仅 1 个，未来多文件时对齐 M）
        frames = [_read_excel_sheet1(path) for path in candidates]
        frame = pl.concat(frames, how="diagonal_relaxed") if len(frames) > 1 else frames[0]
    aux = load_auxiliary_tables(root)
    return transform_jushuitan_39(frame, aux)

