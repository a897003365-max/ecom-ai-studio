from __future__ import annotations

import re
import warnings
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path

import pandas as pd
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
    "05-旗舰店ID对照表": {"商品编码": "商家编码", "图片链接": "商品图片"},
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

JUSHUITAN_EXCLUDED_STORES = {
    "伊凯琳家具旗舰店-周飞-猫1",
    "伊凯琳家居特卖旗舰店-周飞-唯1",
    "艾美悦旗舰店-周飞-猫8",
}

JUSHUITAN_MANUAL_ZERO_EXACT_NAMES = {
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


def _normalize_order_id(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    text = str(value).strip()
    return text if text and text.lower() not in {"nan", "none"} else None


@lru_cache(maxsize=8)
def _read_offline_suborder_ids(offline_directory: str) -> frozenset[str]:
    """Load the PBIX 线下 helper table without persisting order identifiers."""

    folder = Path(offline_directory)
    if not folder.is_dir():
        return frozenset()

    suborder_ids: set[str] = set()
    for source in sorted(folder.glob("*.xls*")):
        if source.name.startswith("~$"):
            continue
        try:
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", message="Workbook contains no default style")
                frame = pd.read_excel(
                    source,
                    usecols=lambda column: str(column).strip() == "子订单编号",
                    dtype=object,
                )
        except Exception as error:
            raise ValueError(f"无法读取线下子订单来源文件: {source.name}") from error
        if "子订单编号" not in frame.columns:
            continue
        suborder_ids.update(
            value
            for value in (_normalize_order_id(item) for item in frame["子订单编号"].tolist())
            if value is not None
        )
    return frozenset(suborder_ids)


def _offline_suborder_ids(jushuitan_source: Path) -> frozenset[str]:
    """Resolve the PBIX sibling 线下 folder relative to a 聚水潭 source file."""

    offline_directory = jushuitan_source.parent.parent / "02-商品明细库存表" / "线下"
    return _read_offline_suborder_ids(str(offline_directory.resolve()))


@lru_cache(maxsize=8)
def _read_store_short_name_mapping(mapping_file: str) -> dict[str, str]:
    """Load the same ERP store-name mapping used by the PBIX product report."""

    source = Path(mapping_file)
    if not source.is_file():
        return {}
    try:
        frame = pd.read_excel(source, dtype=object)
    except Exception as error:
        raise ValueError(f"无法读取 ERP 店铺对照表: {source.name}") from error

    source_column = next((column for column in ("ERP店铺名称", "店铺") if column in frame.columns), None)
    short_name_column = next(
        (column for column in ("共享表店铺名称", "店铺简称", "简称") if column in frame.columns),
        None,
    )
    if not source_column or not short_name_column:
        raise ValueError(f"ERP 店铺对照表缺少店铺映射列: {source.name}")
    return {
        store: short_name
        for store, short_name in (
            (_normalize_order_id(store), _normalize_order_id(short_name))
            for store, short_name in zip(frame[source_column], frame[short_name_column], strict=False)
        )
        if store and short_name
    }


def _store_short_name_mapping(jushuitan_source: Path) -> dict[str, str]:
    """Resolve the PBIX 店铺名称对应表 source next to 聚水潭 data files."""

    mapping_file = jushuitan_source.parent.parent / "商品信息文件" / "ERP店铺对照表.xlsx"
    return _read_store_short_name_mapping(str(mapping_file.resolve()))


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


def _transform_jushuitan(frame: pl.DataFrame, path: Path) -> pl.DataFrame:
    """Reproduce the business rules of PBIX query ``15-聚水潭商品数据``.

    The source export has more than 100 columns.  We use the raw helper fields only
    long enough to reproduce the PBIX filters and status priority, then drop them so
    customer messages and after-sales annotations never enter the local warehouse.
    """

    required = {
        "订单类型",
        "买家实付",
        "线上商品名",
        "店铺",
        "买家留言",
        "售后分类",
        "发货日期",
        "确认收货日期",
        "小旗",
        "订单状态",
        "付款日期",
        "销售数量",
    }
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"聚水潭源文件缺少 PBIX 状态规则必需列: {', '.join(missing)}")

    # The catalog uses text types for date columns.  Support both the original
    # slash-delimited datetime and a normalized ISO value for deterministic tests.
    def _jushuitan_date(column: str) -> pl.Expr:
        text = pl.col(column).cast(pl.String, strict=False).str.strip_chars()
        return pl.coalesce(
            text.str.strptime(pl.Date, "%Y/%m/%d %H:%M:%S", strict=False),
            text.str.strptime(pl.Date, "%Y/%m/%d", strict=False),
            text.str.strptime(pl.Date, "%Y-%m-%d %H:%M:%S", strict=False),
            text.str.strptime(pl.Date, "%Y-%m-%d", strict=False),
        ).alias(column)

    numeric_columns = [
        "买家实付", "销售数量", "实发数量", "实发金额", "销售金额", "成本价", "基本售价",
        "销售成本", "销售毛利", "退货数量", "退货金额", "实退金额", "商家实收",
        "平台补贴金额", "优惠金额", "运费收入", "运费支出",
    ]
    expressions = [_numeric_expression(column) for column in numeric_columns if column in frame.columns]
    expressions.extend(
        _jushuitan_date(column)
        for column in ("订单日期", "发货日期", "确认收货日期", "付款日期")
        if column in frame.columns
    )
    if expressions:
        frame = frame.with_columns(expressions)

    # PBIX 聚水潭商品数据_全量处理：渠道平台来自订单的商店站点，而不是店铺名推断。
    # 保留 PBIX 中的三项站点标准化，避免网站把淘宝天猫、京东 POP/自营等口径折叠。
    if "商店站点" in frame.columns:
        channel_platform = (
            pl.col("商店站点")
            .cast(pl.String, strict=False)
            .str.strip_chars()
            .str.replace_all("头条放心购", "抖音", literal=True)
            .str.replace_all("京东厂家直送", "京东自营", literal=True)
            .str.replace_all("京东商城", "京东POP", literal=True)
        )
    elif "渠道平台" in frame.columns:
        channel_platform = pl.col("渠道平台").cast(pl.String, strict=False).str.strip_chars()
    else:
        channel_platform = pl.lit(None, dtype=pl.String)

    # PBIX 的店铺名称对应表来自 ERP店铺对照表.xlsx。先映射原始店铺，再按抖音达人和
    # 新零售规则覆盖，确保网站筛选项与 PBIX 最终 [店铺简称] 同口径。
    store_mapping = _store_short_name_mapping(path)
    if store_mapping:
        mapping_frame = pl.DataFrame(
            {
                "_store_name_key": list(store_mapping),
                "_mapped_store_short_name": list(store_mapping.values()),
            },
            schema={"_store_name_key": pl.String, "_mapped_store_short_name": pl.String},
        )
        frame = (
            frame.with_columns(
                pl.col("店铺").cast(pl.String, strict=False).str.strip_chars().alias("_store_name_key")
            )
            .join(mapping_frame, on="_store_name_key", how="left")
        )
    else:
        frame = frame.with_columns(pl.lit(None, dtype=pl.String).alias("_mapped_store_short_name"))

    source_store_short_name = (
        pl.col("店铺简称").cast(pl.String, strict=False).str.strip_chars()
        if "店铺简称" in frame.columns
        else pl.lit(None, dtype=pl.String)
    )
    mapped_store_short_name = pl.col("_mapped_store_short_name").cast(pl.String, strict=False).str.strip_chars()
    base_store_short_name = pl.coalesce(
        [
            pl.when(mapped_store_short_name == "").then(None).otherwise(mapped_store_short_name),
            pl.when(source_store_short_name == "").then(None).otherwise(source_store_short_name),
            pl.lit("未映射"),
        ]
    )

    # PBIX 最终渠道还有“新零售”覆盖：线上子订单命中线下表，或卖家备注含 M0 时，
    # 都优先归入新零售。辅助订单号和备注原文仅在此处参与判断，不会进入最终数据集。
    new_retail = pl.lit(False)
    if "线上子订单编号" in frame.columns:
        offline_ids = _offline_suborder_ids(path)
        if offline_ids:
            new_retail = (
                pl.col("线上子订单编号")
                .cast(pl.String, strict=False)
                .str.strip_chars()
                .is_in(offline_ids)
                .fill_null(False)
            )
    if "卖家备注" in frame.columns:
        seller_m0 = (
            pl.col("卖家备注")
            .cast(pl.String, strict=False)
            .str.contains("M0", literal=True)
            .fill_null(False)
        )
        new_retail = new_retail | seller_m0

    daren_name = (
        pl.col("达人名称").cast(pl.String, strict=False).str.strip_chars()
        if "达人名称" in frame.columns
        else pl.lit(None, dtype=pl.String)
    )
    douyin_store_short_name = (
        pl.when(channel_platform == "抖音")
        .then(
            pl.when(
                daren_name.is_null()
                | daren_name.is_in(["", "null", "麻大师床垫旗舰店", "麻大师官方旗舰店"])
            )
            .then(pl.lit("抖1"))
            .when(daren_name == "麻大师床垫官方直播间")
            .then(pl.lit("抖2"))
            .when(daren_name == "麻大师官方旗舰店直播间")
            .then(pl.lit("抖3"))
            .when(
                daren_name.is_in(
                    ["与辉同行", "「神机榜」床垫严选", "「神机榜」家居严选", "东方甄选家居馆", "兰知春序", "东方甄选美丽生活"]
                )
            )
            .then(daren_name)
            .otherwise(pl.lit("抖音达人"))
        )
        .otherwise(base_store_short_name)
    )
    store_short_name = pl.when(new_retail).then(pl.lit("新零售")).otherwise(douyin_store_short_name)
    final_channel_platform = pl.when(store_short_name == "新零售").then(pl.lit("新零售")).otherwise(channel_platform)
    frame = frame.with_columns(
        douyin_store_short_name.alias("店铺简称（结算店铺）"),
        store_short_name.alias("店铺简称"),
        final_channel_platform.alias("渠道平台"),
    )

    product_name = pl.col("线上商品名").cast(pl.String, strict=False)
    store = pl.col("店铺").cast(pl.String, strict=False)
    buyer_memo = pl.col("买家留言").cast(pl.String, strict=False)

    # 聚水潭商品数据_全量处理: 普通订单、排除三家店铺与返修单。
    # （买家实付 >= 50 的硬过滤已取消，低金额订单也计入；垃圾单仍由下方标题规则剔除）
    valid_business_row = (
        (pl.col("订单类型").cast(pl.String, strict=False) == "普通订单")
        & (~store.is_in(JUSHUITAN_EXCLUDED_STORES)).fill_null(True)
        & (~buyer_memo.str.contains("返修", literal=True)).fill_null(True)
    )
    frame = frame.filter(valid_business_row)

    # PBIX marks these as 销售数量 = 0 in the upstream query; query 15 removes
    # those rows with [销售数量] <> 0.  Filtering here preserves that final query's
    # grain without exposing the manual-zero detail table to the web app.
    manual_zero = (
        product_name.is_null()
        | product_name.str.contains("礼品袋", literal=True).fill_null(False)
        | product_name.str.contains("差", literal=True).fill_null(False)
        | product_name.is_in(JUSHUITAN_MANUAL_ZERO_EXACT_NAMES).fill_null(False)
        | product_name.str.contains("皮革", literal=True).fill_null(False)
        | product_name.str.contains("单拍不发货", literal=True).fill_null(False)
        | product_name.str.contains("0.01", literal=True).fill_null(False)
        | product_name.str.contains("链接", literal=True).fill_null(False)
        | product_name.str.contains("入会", literal=True).fill_null(False)
        | product_name.str.contains("袋子", literal=True).fill_null(False)
        | product_name.str.contains("小额收款", literal=True).fill_null(False)
        | product_name.str.contains("麻大师环保黄麻手提袋", literal=True).fill_null(False)
    )
    frame = frame.filter((~manual_zero) & (pl.col("销售数量") != 0).fill_null(False))

    after_sale = pl.col("售后分类").cast(pl.String, strict=False)
    flag = pl.col("小旗").cast(pl.String, strict=False)
    raw_status = pl.col("订单状态").cast(pl.String, strict=False)
    pending_raw_status = (
        (raw_status == "异常")
        | raw_status.str.contains("等供销", literal=True).fill_null(False)
        | raw_status.str.contains("发货中", literal=True).fill_null(False)
        | (raw_status == "已付款待审核")
    )
    status_before_cancel = (
        pl.when(after_sale == "仅退款")
        .then(pl.lit("交易关闭（仅退款）"))
        .when(after_sale == "普通退货")
        .then(pl.lit("交易关闭（退货退款）"))
        .when(pl.col("发货日期").is_not_null())
        .then(pl.lit("已发货"))
        .when(pl.col("确认收货日期").is_not_null())
        .then(pl.lit("已收货"))
        .when(flag.str.contains("紫", literal=True).fill_null(False))
        .then(pl.lit("等通知"))
        .when(flag.str.contains("黄", literal=True).fill_null(False))
        .then(pl.lit("指定日"))
        .when(pending_raw_status)
        .then(pl.lit("待发货"))
        .when(pl.col("付款日期").is_null())
        .then(pl.lit("未付款"))
        .otherwise(raw_status)
    )
    status_detail = (
        pl.when(status_before_cancel == "已取消")
        .then(pl.lit("交易关闭（仅退款）"))
        .otherwise(status_before_cancel)
    )
    status_summary = (
        pl.when(status_detail.is_in(["待发货", "等通知", "指定日"]))
        .then(pl.lit("待发"))
        .when(status_detail.is_in(["已发货", "已收货"]))
        .then(pl.lit("已发"))
        .otherwise(pl.lit("未付款或交易关闭"))
    )

    # 是否定制（对齐 PBI 商家备注打标）：卖家备注含 定制/折叠/横折/竖折 即为定制。
    # 备注原文不进入最终数据集（见上方 line 456 注释），仅保留是否定制标记与分类标签。
    if "卖家备注" in frame.columns:
        seller_remark_text = pl.col("卖家备注").cast(pl.String, strict=False).fill_null("")
        is_custom_order = (
            seller_remark_text.str.contains("定制", literal=True)
            | seller_remark_text.str.contains("折叠", literal=True)
            | seller_remark_text.str.contains("横折", literal=True)
            | seller_remark_text.str.contains("竖折", literal=True)
        )
        custom_tag_value = (
            pl.when(
                seller_remark_text.str.contains("定制尺寸/缺角/折叠/内材", literal=True)
                | seller_remark_text.str.contains("定制异形", literal=True)
            )
            .then(pl.lit("定制异形"))
            .when(seller_remark_text.str.contains("定制尺寸", literal=True))
            .then(pl.lit("定制尺寸"))
            .when(seller_remark_text.str.contains("定制内材", literal=True))
            .then(pl.lit("定制内材"))
            .when(seller_remark_text.str.contains("定制厚度", literal=True))
            .then(pl.lit("定制厚度"))
            .when(seller_remark_text.str.contains("定制折叠", literal=True))
            .then(pl.lit("定制折叠"))
            .when(seller_remark_text.str.contains("定制缺角", literal=True))
            .then(pl.lit("定制缺角"))
            .when(seller_remark_text.str.contains("更换赠品", literal=True))
            .then(pl.lit("更换赠品"))
            .otherwise(None)
        )
    else:
        is_custom_order = pl.lit(False)
        custom_tag_value = pl.lit(None, dtype=pl.String)

    # 退款分类:无退款/未发货退款/已发货退款(基于退货金额 + 发货状态)
    # 退款程度:无退款/小额打款/部分退款/全部退款(退款率=退货金额/商家实收,<0.5 小额,>=1 全部)
    if "退货金额" in frame.columns and "发货日期" in frame.columns:
        _refund = pl.col("退货金额").cast(pl.Float64, strict=False).fill_null(0)
        _received = pl.col("商家实收").cast(pl.Float64, strict=False).fill_null(0) if "商家实收" in frame.columns else pl.lit(0.0)
        _rate = pl.when(_received > 0).then(_refund / _received).otherwise(pl.lit(0.0))
        refund_class = (
            pl.when(_refund <= 0).then(pl.lit("无退款"))
            .when(pl.col("发货日期").is_null()).then(pl.lit("未发货退款"))
            .otherwise(pl.lit("已发货退款"))
        )
        refund_degree = (
            pl.when(_refund <= 0).then(pl.lit("无退款"))
            .when(_refund >= _received).then(pl.lit("全部退款"))
            .when(_rate < 0.5).then(pl.lit("小额打款"))
            .otherwise(pl.lit("部分退款"))
        )
    else:
        refund_class = pl.lit("无退款")
        refund_degree = pl.lit("无退款")

    frame = frame.with_columns(
        status_detail.alias("订单状态明细"),
        status_summary.alias("订单状态汇总"),
        is_custom_order.alias("是否定制"),
        custom_tag_value.alias("定制备注标签"),
        refund_class.alias("退款分类"),
        refund_degree.alias("退款程度"),
    )

    # Keep line identifiers so the warehouse can apply the PBIX Table.Distinct
    # semantics without collapsing legitimate orders for the same SKU and day.
    keep = [
        "线上订单号", "线上子订单编号", "内部订单号", "线上商品名", "店铺商品编码", "商品编码", "商品简称", "产品名称",
        "SPU产品商编", "子名称", "颜色规格", "商品id", "产品分类", "床垫类别", "品牌", "供应商",
        "店铺", "店铺简称", "店铺简称（结算店铺）", "渠道平台", "订单来源", "订单状态", "订单状态明细",
        "订单状态汇总", "达人名称", "业务员", "省", "发货仓", "是否定制", "定制备注标签", "退款分类", "退款程度", "厚度", "尺寸",
        "订单日期", "付款日期", "发货日期", "确认收货日期", "年月", "销售数量", "实发数量", "实发金额",
        "销售金额", "成本价", "基本售价", "销售成本", "销售毛利", "退货数量", "退货金额", "实退金额",
        "买家实付", "商家实收", "平台补贴金额", "优惠金额", "运费收入", "运费支出",
    ]
    return frame.select([column for column in keep if column in frame.columns])


def _transform_product_master(frame: pl.DataFrame) -> pl.DataFrame:
    """产品主表（复刻 pbix 辅10-产品编码 的 union 逻辑）：5 个产品主表按文件列映射到统一列。

    各文件原始列名不同，用 coalesce 合并：
      商品编码 = coalesce(商家规编（后台）, 商家编码, sku产品编码)
      产品名称 = coalesce(产品名称, SKU产品名, 商品名称, 名称, SPU产品名, 商品标题)
      床垫类别 = coalesce(床垫类别, 三级类目)  家纺行无此列 -> "家纺"
      成本 = coalesce(成本, 成本价, 成本（不含运费）)
      尺寸 = coalesce(尺寸, 规格)
    按 商品编码 去重，提供给聚水潭 join 计算毛利率与床垫类别分析。
    """
    def _coalesce_str(cols: list[str]) -> pl.Expr | None:
        present = [c for c in cols if c in frame.columns]
        if not present:
            return None
        return pl.coalesce(
            [
                pl.when(pl.col(c).cast(pl.String, strict=False).str.strip_chars() == "")
                .then(None)
                .otherwise(pl.col(c).cast(pl.String, strict=False).str.strip_chars())
                for c in present
            ]
        )

    code_expr = _coalesce_str(["商家规编（后台）", "商家编码", "sku产品编码"])
    product_id_expr = _coalesce_str(["商品ID", "SKUid", "SKUID"])
    product_name_expr = _coalesce_str(
        ["产品名称", "SKU产品名", "商品名称", "名称", "SPU产品名", "商品标题"]
    )
    cat_expr = _coalesce_str(["床垫类别", "三级类目"])
    if cat_expr is not None and "Source.Name" in frame.columns:
        # 家纺商品表无 床垫类别/三级类目，按 pbix M 派生为 "家纺"
        cat_expr = (
            pl.when(cat_expr.is_null() | (cat_expr == ""))
            .then(pl.when(pl.col("Source.Name").str.contains("家纺")).then(pl.lit("家纺")).otherwise(None))
            .otherwise(cat_expr)
        )
    cost_present = [c for c in ["成本", "成本价", "成本（不含运费）"] if c in frame.columns]
    cost_expr = (
        pl.coalesce([pl.col(c).cast(pl.Float64, strict=False) for c in cost_present]) if cost_present else None
    )
    size_expr = _coalesce_str(["尺寸", "规格"])
    sub_name_expr = _coalesce_str(["子名称"])

    exprs = []
    if code_expr is not None:
        exprs.append(code_expr.alias("商品编码"))
    if product_id_expr is not None:
        exprs.append(product_id_expr.alias("商品ID"))
    if product_name_expr is not None:
        exprs.append(product_name_expr.alias("产品名称"))
    if cat_expr is not None:
        exprs.append(cat_expr.alias("床垫类别"))
    if cost_expr is not None:
        exprs.append(cost_expr.alias("成本"))
    if size_expr is not None:
        exprs.append(size_expr.alias("尺寸"))
    if sub_name_expr is not None:
        exprs.append(sub_name_expr.alias("子名称"))
    if exprs:
        frame = frame.with_columns(exprs)

    keep = [c for c in ["商品编码", "商品ID", "产品名称", "床垫类别", "成本", "尺寸", "子名称"] if c in frame.columns]
    frame = frame.select(keep)
    if "商品编码" in frame.columns:
        frame = frame.filter(pl.col("商品编码").is_not_null() & (pl.col("商品编码") != ""))
        frame = frame.unique(subset=["商品编码"], keep="first", maintain_order=True)
    return frame


def _apply_query_rules(frame: pl.DataFrame, spec: QuerySpec, path: Path) -> pl.DataFrame:
    if spec.name == "03-1-各渠道目标金额":
        return _transform_targets(frame, path)

    if spec.name == "15-聚水潭商品数据":
        return _transform_jushuitan(frame, path)

    if spec.name == "product-master":
        return _transform_product_master(frame)

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
