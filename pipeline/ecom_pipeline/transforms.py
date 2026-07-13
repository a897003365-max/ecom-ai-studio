from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path

import polars as pl

from .catalog import QuerySpec

SUMMARY_LABELS = {
    "全店平均值",
    "全店汇总值",
    "同行同层优秀",
    "同行同层均值",
    "平均值",
    "汇总值",
    "均值",
    "总值",
}

MANUAL_RENAMES: dict[str, dict[str, str]] = {
    "04-旗舰店基础数据": {
        "客单价": "客单价（固数））",
        "UV价值": "UV价值（固数）",
        "支付转化率": "支付转化率（固数）",
    },
    "06-旗舰店流量数据": {"数据日期": "日期"},
    "07-旗舰店商品销售数据": {"支付件数": "商品支付件数"},
    "08-旗舰店推广花费": {
        "主体ID": "商品ID",
        "点击率": "点击率（固定）",
        "加购成本": "加购成本（固数）",
        "花费": "花费（未含达人）",
        "加购率": "加购率（固数）",
    },
    "10-1淘宝客服绩效明细": {"答问比": "淘宝答问比"},
    "接待数据": {
        "平均响应时长(新标)": "新平均响应时间",
        "平均响应时长": "平均响应时间",
        "应答率": "回复率",
    },
    "考勤数据": {"平均响应时间（新标）": "新平均响应时间", "客服": "UID"},
    "京东客服分组表": {"旺旺昵称": "客服"},
    "辅5-床类编码": {"主型号": "SPU产品商编", "id": "商品ID", "商家编码（后台）": "商家规编（后台）"},
}

FILTER_COLUMNS: dict[str, str] = {
    "06-旗舰店流量数据": "三级来源",
    "10-1淘宝客服绩效明细": "旺旺昵称",
    "10-2京东客服营销明细": "客服",
    "10-3京东客服绩效数据": "客服",
    "接待数据": "客服",
    "考勤数据": "客服",
    "营销数据": "客服",
    "营销数据改版": "客服",
}

DEDUPE_KEYS: dict[str, tuple[str, ...]] = {
    "04-旗舰店基础数据": ("统计日期", "店铺名称", "访客数", "直播间访客数", "短视频访客数"),
    "07-旗舰店商品销售数据": ("日期", "商品名称", "商品ID", "支付金额"),
    "08-1关键词报表数据": ("日期", "场景ID", "计划ID", "单元ID", "宝贝ID", "词ID/词包ID"),
    "08-2人群报表数据": ("日期", "场景ID", "计划ID", "单元ID", "宝贝ID", "定向类型", "定向名称"),
    "08-旗舰店推广花费": ("日期", "计划ID", "商品ID", "场景名字"),
    "10-1淘宝客服绩效明细": ("日期", "旺旺昵称", "净销售额", "客单价"),
    "10-2京东客服营销明细": ("客服", "日期"),
    "10-3京东客服绩效数据": ("客服", "日期"),
    "10-4客服员工日报统计": ("日期", "UID", "技能组", "服务商"),
    "14-推广竞品数据": ("时间", "品牌", "渠道", "时间段"),
}

FILENAME_DATE_QUERIES = {
    "10-1淘宝客服绩效明细",
    "10-2京东客服营销明细",
    "10-3京东客服绩效数据",
    "考勤数据",
}


def canonical_column(value: str) -> str:
    normalized = value.replace("#(lf)", "").replace("\r", "").replace("\n", "")
    return re.sub(r"[\s_()（）\-—]+", "", normalized).lower()


def _align_schema_columns(frame: pl.DataFrame, spec: QuerySpec) -> pl.DataFrame:
    targets = {canonical_column(item.name): item.name for item in spec.schema}
    existing = set(frame.columns)
    renames: dict[str, str] = {}
    for column in frame.columns:
        target = targets.get(canonical_column(column))
        if target and target != column and target not in existing and target not in renames.values():
            renames[column] = target
    return frame.rename(renames) if renames else frame


def _numeric_expression(column: str, integer: bool = False) -> pl.Expr:
    text = (
        pl.col(column)
        .cast(pl.String, strict=False)
        .str.strip_chars()
        .str.replace_all(r"[,，￥¥\s]", "")
    )
    has_percent = text.str.ends_with("%")
    number = text.str.replace_all("%", "").cast(pl.Float64, strict=False)
    number = pl.when(has_percent).then(number / 100).otherwise(number)
    if integer:
        return number.round(0).cast(pl.Int64, strict=False).alias(column)
    return number.alias(column)


def _date_expression(column: str) -> pl.Expr:
    text = pl.col(column).cast(pl.String, strict=False).str.strip_chars()
    serial = text.cast(pl.Float64, strict=False)
    parsed = pl.coalesce(
        text.str.strptime(pl.Date, "%Y-%m-%d", strict=False),
        text.str.strptime(pl.Datetime, "%Y-%m-%d %H:%M:%S", strict=False).dt.date(),
        text.str.strptime(pl.Date, "%Y/%m/%d", strict=False),
        text.str.strptime(pl.Date, "%Y.%m.%d", strict=False),
    )
    excel_date = pl.date(1899, 12, 30) + pl.duration(days=serial.floor().cast(pl.Int64, strict=False))
    return (
        pl.when(serial.is_between(20_000, 80_000))
        .then(excel_date)
        .otherwise(parsed)
        .alias(column)
    )


def _apply_types(frame: pl.DataFrame, spec: QuerySpec) -> pl.DataFrame:
    expressions = []
    for item in spec.schema:
        if item.name not in frame.columns:
            continue
        m_type = item.m_type.lower()
        if "int64" in m_type:
            expressions.append(_numeric_expression(item.name, integer=True))
        elif any(value in m_type for value in ("number", "currency", "percentage")):
            expressions.append(_numeric_expression(item.name))
        elif "datetime" in m_type:
            expressions.append(pl.col(item.name).cast(pl.String, strict=False).str.to_datetime(strict=False).alias(item.name))
        elif "date" in m_type:
            expressions.append(_date_expression(item.name))
        elif "text" in m_type:
            expressions.append(pl.col(item.name).cast(pl.String, strict=False).alias(item.name))
    return frame.with_columns(expressions) if expressions else frame


def _promote_first_row(frame: pl.DataFrame) -> pl.DataFrame:
    if frame.height == 0 or not any(column.startswith("Column") for column in frame.columns):
        return frame
    metadata_columns = [column for column in frame.columns if column == "Source.Name" or column.startswith("_source_")]
    data_columns = [column for column in frame.columns if column not in metadata_columns]
    values = frame.select(data_columns).row(0)
    if sum(bool(value is not None and str(value).strip()) for value in values) < 2:
        return frame
    columns = []
    used: dict[str, int] = {}
    for index, value in enumerate(values):
        base = str(value).strip() if value is not None and str(value).strip() else f"Column{index + 1}"
        base = base.replace("\r\n", "#(lf)").replace("\n", "#(lf)")
        count = used.get(base, 0)
        used[base] = count + 1
        columns.append(base if count == 0 else f"{base}.{count}")
    metadata = {column: frame.get_column(column)[0] for column in metadata_columns}
    promoted = frame.select(data_columns).slice(1)
    promoted.columns = columns
    return promoted.with_columns([pl.lit(value).alias(column) for column, value in metadata.items()])


def _parse_filename_date(value: object) -> date | None:
    text = str(value or "")
    iso = re.search(r"(20\d{2})[-_/年](\d{1,2})[-_/月](\d{1,2})", text)
    if iso:
        try:
            return date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
        except ValueError:
            return None
    compact = re.search(r"(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)", text)
    if compact:
        try:
            return date(int(compact.group(1)), int(compact.group(2)), int(compact.group(3)))
        except ValueError:
            return None
    english = re.search(
        r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b[\s\S]*?(?<!\d)(20\d{2})(?!\d)",
        text,
        re.IGNORECASE,
    )
    if english:
        try:
            return datetime.strptime(f"{english.group(1)} {english.group(2)} {english.group(3)}", "%b %d %Y").date()
        except ValueError:
            return None
    return None


def _add_filename_date(frame: pl.DataFrame) -> pl.DataFrame:
    if "Source.Name" not in frame.columns:
        return frame
    if frame.height == 0:
        if "日期" in frame.columns:
            return frame
        return frame.with_columns(pl.lit(None, dtype=pl.Date).alias("日期"))
    names = frame.get_column("Source.Name").cast(pl.String).unique().to_list()
    mapping = pl.DataFrame(
        {"Source.Name": names, "_filename_date": [_parse_filename_date(value) for value in names]},
        schema_overrides={"_filename_date": pl.Date},
    )
    frame = frame.join(mapping, on="Source.Name", how="left")
    if "日期" in frame.columns:
        return frame.with_columns(pl.coalesce("日期", "_filename_date").alias("日期")).drop("_filename_date")
    return frame.rename({"_filename_date": "日期"})


def _transform_targets(frame: pl.DataFrame, path: Path) -> pl.DataFrame:
    frame = _promote_first_row(frame)
    month_columns = [column for column in frame.columns if re.fullmatch(r"(?:[1-9]|1[0-2])月", column)]
    if not month_columns or not {"渠道", "店铺"}.issubset(frame.columns):
        return frame
    match = re.search(r"(\d{2,4})年", path.name)
    year = int(match.group(1)) if match else datetime.now().year
    if year < 100:
        year += 2000
    frame = frame.unpivot(on=month_columns, index=["渠道", "店铺"], variable_name="月份", value_name="目标金额")
    return frame.with_columns(
        pl.col("月份")
        .str.replace("月", "")
        .cast(pl.Int32, strict=False)
        .map_elements(lambda month: date(year, month, 1) if month else None, return_dtype=pl.Date)
        .alias("日期"),
        _numeric_expression("目标金额"),
    ).drop("月份")


def _drop_empty_rows(frame: pl.DataFrame) -> pl.DataFrame:
    data_columns = [column for column in frame.columns if not column.startswith("_") and column != "Source.Name"]
    if not data_columns:
        return frame
    populated = [
        pl.col(column).is_not_null() & (pl.col(column).cast(pl.String, strict=False).str.strip_chars() != "")
        for column in data_columns
    ]
    return frame.filter(pl.any_horizontal(populated))


def _apply_query_rules(frame: pl.DataFrame, spec: QuerySpec, path: Path) -> pl.DataFrame:
    if spec.name == "03-1-各渠道目标金额":
        return _transform_targets(frame, path)

    if spec.name == "07-旗舰店商品销售数据":
        frame = frame.drop([column for column in ("Column4", "Column37", "Column38") if column in frame.columns])

    filter_column = FILTER_COLUMNS.get(spec.name)
    if filter_column in frame.columns:
        frame = frame.filter(~pl.col(filter_column).cast(pl.String, strict=False).is_in(list(SUMMARY_LABELS)))
    if spec.name == "06-旗舰店流量数据" and "三级来源" in frame.columns:
        frame = frame.filter(pl.col("三级来源").cast(pl.String, strict=False) != "汇总")
    if spec.name == "14-推广竞品数据" and "渠道" in frame.columns:
        frame = frame.filter(pl.col("渠道").is_not_null() & (pl.col("渠道").cast(pl.String) != "汇总"))
    if spec.name == "京东客服分组表" and "客服账号" in frame.columns:
        frame = frame.filter(pl.col("客服账号").cast(pl.String, strict=False) != "麻大师思思")

    renames = {
        source: target
        for source, target in MANUAL_RENAMES.get(spec.name, {}).items()
        if source in frame.columns and target not in frame.columns
    }
    if renames:
        frame = frame.rename(renames)

    if spec.name in FILENAME_DATE_QUERIES:
        frame = _add_filename_date(frame)

    if spec.name == "10-3京东客服绩效数据" and {"促成下单人数", "售前接待人数"}.issubset(frame.columns):
        frame = frame.with_columns(
            (pl.col("促成下单人数").cast(pl.Float64, strict=False) / pl.col("售前接待人数").cast(pl.Float64, strict=False))
            .fill_nan(None)
            .alias("售前咨询-下单转化率")
        )
    if spec.name == "10-4客服员工日报统计" and {"非常满意", "满意", "不满意", "非常不满意"}.issubset(frame.columns):
        frame = frame.with_columns(
            (pl.col("非常满意").cast(pl.Float64, strict=False).fill_null(0) + pl.col("满意").cast(pl.Float64, strict=False).fill_null(0)).alias("好评量"),
            (pl.col("不满意").cast(pl.Float64, strict=False).fill_null(0) + pl.col("非常不满意").cast(pl.Float64, strict=False).fill_null(0)).alias("差评量"),
        )
    if spec.name == "08-旗舰店推广花费":
        if {"Source.Name", "场景名字"}.issubset(frame.columns):
            blocked = pl.col("Source.Name").cast(pl.String).str.contains("营销场景报表") & pl.col("场景名字").cast(pl.String).is_in(
                ["关键词推广", "人群推广", "货品全站推", "货品全站推广"]
            )
            frame = frame.filter(~blocked)
        if {"商品ID", "场景名字"}.issubset(frame.columns):
            frame = frame.with_columns(
                pl.when(pl.col("商品ID").cast(pl.String, strict=False).is_in(["0", "0.0"]))
                .then(pl.col("场景名字").cast(pl.String, strict=False))
                .otherwise(pl.col("商品ID").cast(pl.String, strict=False))
                .alias("商品ID")
            )

    keys = [column for column in DEDUPE_KEYS.get(spec.name, ()) if column in frame.columns]
    if keys:
        frame = frame.unique(subset=keys, keep="first", maintain_order=True)
    return frame


def transform_source_file(frame: pl.DataFrame, spec: QuerySpec, path: Path) -> pl.DataFrame:
    if spec.name in {"营销数据改版", "淘宝客服排班表"} and any(column.startswith("Column") for column in frame.columns):
        frame = _promote_first_row(frame)
    frame = _align_schema_columns(frame, spec)
    frame = _apply_types(frame, spec)
    frame = _apply_query_rules(frame, spec, path)
    frame = _drop_empty_rows(frame)
    return frame.with_columns(
        pl.lit(str(path)).alias("_source_path"),
        pl.lit(path.stat().st_mtime_ns).alias("_source_mtime_ns"),
    )


__all__ = ["canonical_column", "transform_source_file", "_parse_filename_date"]
