from __future__ import annotations

import os
import sys
import tempfile
from datetime import date
from pathlib import Path
from typing import Any

import polars as pl

# manifest 中各查询的登记名（warehouse_query_catalog / state.json 以此为准）
TMALL_SHOP_SUMMARY_QUERY = "mds-天猫店铺日汇总"
TMALL_PRODUCT_DAILY_QUERY = "mds-天猫商品日明细"
TMALL_SCENE_DAILY_QUERY = "mds-天猫场景日明细"
TMALL_ITEM_PROMOTION_QUERY = "mds-天猫商品推广日明细"

# 聚水潭订单层（2026-10-22 从 327MB Excel 迁到 mds-postgres-1）：
# 源 public.jst_order_item_daily → ETL 物化为网站层 48 列 / 共享表导出层 39 列。
# 网站沿用原查询名 "15-聚水潭商品数据"，manifest 改为 postgres 源即可无缝切换。
JST_WEB_QUERY = "15-聚水潭商品数据"
JST_WEB_TABLE = "public.jst_order_item_web"
JST_EXPORT_TABLE = "public.jst_order_item_export"

JST_WEB_FIELDS: tuple[tuple[str, str], ...] = (
    ("线上订单号", "text"), ("线上子订单编号", "text"), ("内部订单号", "text"),
    ("线上商品名", "text"), ("店铺商品编码", "text"), ("商品编码", "text"),
    ("商品简称", "text"), ("颜色规格", "text"), ("产品分类", "text"),
    ("品牌", "text"), ("供应商", "text"), ("店铺", "text"),
    ("店铺简称", "text"), ("店铺简称（结算店铺）", "text"), ("渠道平台", "text"),
    ("订单来源", "text"), ("订单状态", "text"), ("订单状态明细", "text"),
    ("订单状态汇总", "text"), ("达人名称", "text"), ("业务员", "text"),
    ("省", "text"), ("发货仓", "text"), ("是否定制", "bool"),
    ("定制备注标签", "text"), ("退款分类", "text"), ("退款程度", "text"),
    ("订单日期", "date"), ("付款日期", "date"), ("发货日期", "date"),
    ("确认收货日期", "date"), ("销售数量", "float"), ("实发数量", "float"),
    ("实发金额", "float"), ("销售金额", "float"), ("成本价", "float"),
    ("基本售价", "float"), ("销售成本", "float"), ("销售毛利", "float"),
    ("退货数量", "float"), ("退货金额", "float"), ("实退金额", "float"),
    ("买家实付", "float"), ("商家实收", "float"), ("平台补贴金额", "float"),
    ("优惠金额", "float"), ("运费收入", "float"), ("运费支出", "float"),
)

JST_EXPORT_FIELDS: tuple[tuple[str, str], ...] = (
    ("线上订单号", "text"), ("线上子订单编号", "text"), ("线上商品名", "text"),
    ("销售数量", "int"), ("商家实收", "float"), ("买家实付", "float"),
    ("退货金额", "float"), ("SPU产品商编", "text"), ("产品名称", "text"),
    ("子名称", "text"), ("商品编码", "text"), ("颜色规格", "text"),
    ("商品id", "text"), ("渠道平台", "text"), ("店铺简称", "text"),
    ("是否定制", "text"), ("定制备注标签", "text"), ("订单状态汇总", "text"),
    ("订单状态明细", "text"), ("床垫类别", "text"), ("年月", "text"),
    ("付款日期", "date"), ("发货日期", "date"), ("确认收货日期", "date"),
    ("发货仓", "text"), ("买家ID", "text"), ("成本", "float"),
    ("订单状态", "text"), ("卖家备注", "text"), ("小旗", "text"),
    ("店铺简称（结算店铺）", "text"), ("厚度", "text"), ("尺寸", "text"),
    ("店铺", "text"), ("商品简称", "text"), ("毛利额", "float"),
    ("单件价格", "float"), ("周", "text"), ("内部订单号", "text"),
)

# 与钉钉填表链同一真值源：前 9 字段映射逐字段对齐 D:\麻大师\脚本\db_source.py 的
# TMALL_FIELD_MAP / TMALL_CONTENT_SCENES / TMALL_RANK_SHOP，改动必须双链同步。
# 后 6 个（商品访客数/支付买家数/新访客数/老访客数/平均停留时长/跳失率）为本看板
# 04 基础数据回填扩展，列名直接采用 04 文件链 canonical 中文，供 UNION 同名对齐；
# 与 04 已逐项对平（2026-10-03~05：visitor_count↔访客数、payment_buyer_count↔支付买家数
# 359/343/321、bounce_rate↔跳失率 0.517/0.4669/0.4457 等 14 字段分毫不差）。
TMALL_FIELD_MAP = {
    "浏览量": "page_view_count",
    "店铺客户数": "visitor_count",
    "GMV": "payment_amount",
    "成功退款金额": "successful_refund_amount",
    "加购人数": "cart_user_count",
    "关键词推广": "keyword_promotion_cost",
    "精准人群推广": "targeted_audience_promotion_cost",
    "全站推广": "all_site_promotion_cost",
    "淘客": "taobao_ke_commission",
    "商品访客数": "product_visitor_count",
    "支付买家数": "payment_buyer_count",
    "新访客数": "new_visitor_count",
    "老访客数": "old_visitor_count",
    "平均停留时长": "average_stay_seconds",
    "跳失率": "bounce_rate",
}
# 「内容场景」= 万相台营销日表 超级短视频+超级直播 花费合计
TMALL_CONTENT_SCENES = ("超级短视频", "超级直播")
# 「店铺排名」= taobao_shop_rank_daily 麻大师旗舰店的 GMV 榜名次
TMALL_RANK_SHOP = "麻大师旗舰店"

# 商品/场景日明细：列名直接采用文件链（07-旗舰店商品销售数据 / 08-旗舰店推广花费）
# 的 canonical 中文字段，warehouse 缺口回填按同名列 UNION。场景映射已与文件链
# 2026-10-04 数据逐项对平（花费↔charge_amount、总成交金额↔alipay_inshop_amount、
# 总购物车数↔cart_inshop_count、直接购物车数↔cart_dir_count、旺旺咨询量↔ww_count、
# 展现量↔ad_pv、点击量↔click_count）。
TMALL_PRODUCT_FIELD_MAP = {
    "商品ID": "spu_id",
    "商品名称": "spu_name",
    "商品访客数": "product_visitor_count",
    "加购人数": "cart_user_count",
    "支付买家数": "payment_buyer_count",
    "支付金额": "payment_amount",
    "退款金额": "refund_amount",
    "商品支付件数": "payment_item_count",
}
TMALL_SCENE_FIELD_MAP = {
    "场景名字": "scene_name",
    "展现量": "ad_pv",
    "点击量": "click_count",
    "花费": "charge_amount",
    "总成交金额": "alipay_inshop_amount",
    "总购物车数": "cart_inshop_count",
    "直接购物车数": "cart_dir_count",
    "旺旺咨询量": "ww_count",
}
# 商品×场景推广日明细（08 文件链商品粒度同口径）：promotion_id 即商品ID，已与文件链
# 2026-10-04 关键词推广前 5 商品逐项对平。item 表无直接/间接购物车拆分，「直接购物车数」
# 在回填日恒为 0（前端直加率随之显示 0，属已知口径缺口，不补造）。
TMALL_ITEM_PROMOTION_FIELD_MAP = {
    "商品ID": "promotion_id",
    "主体名称": "promotion_name",
    "场景名字": "scene_name",
    "展现量": "ad_pv",
    "点击量": "click_count",
    "花费": "charge_amount",
    "总成交金额": "alipay_inshop_amount",
    "总购物车数": "cart_inshop_count",
    "旺旺咨询量": "ww_count",
}
# 映射中为文本的字段，其余一律 Float64
TMALL_TEXT_FIELDS = {"商品ID", "商品名称", "场景名字", "主体名称"}

MDS_ENV_KEYS = ("MDS_DB_HOST", "MDS_DB_PORT", "MDS_DB_USERNAME", "MDS_DB_PASSWORD")


class MdsSourceError(RuntimeError):
    """mds 库读取失败（不可达/凭据缺失/查询异常），调用方按查询级失败处理。"""


def _credentials(env_file: Path | None = None) -> dict[str, str]:
    """凭据解析：进程环境变量优先，缺项回退 local-data/mds-db.env（gitignore 的本机目录）。

    计划任务（S4U）与服务端 spawn 的 python 都不一定能拿到用户环境变量，
    文件兜底保证两条入口行为一致；凭据永不写入仓库。
    """
    values = {key: os.environ.get(key, "") for key in MDS_ENV_KEYS}
    env_file = env_file or Path(__file__).resolve().parents[2] / "local-data" / "mds-db.env"
    if not all(values.values()) and env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                key = key.strip()
                if key in MDS_ENV_KEYS and not values[key]:
                    values[key] = value.strip().strip('"').strip("'")
    missing = [key for key, value in values.items() if not value]
    if missing:
        raise MdsSourceError(f"缺少 mds 凭据：{', '.join(missing)}（环境变量或 local-data/mds-db.env）")
    values["MDS_DB_NAME"] = os.environ.get("MDS_DB_NAME", "") or "mds"
    return values


def _float(value: Any) -> float | None:
    """与 db_source._float 同口径：None 保持 None，金额 round 到 2 位小数。"""
    return round(float(value), 2) if value is not None else None


# 04 回填扩展列不做 2 位舍入：停留时长/跳失率需保留原始精度（04 文件链为 4 位小数）
TMALL_PRECISE_FIELDS = {"商品访客数", "支付买家数", "新访客数", "老访客数", "平均停留时长", "跳失率"}


def _float_precise(value: Any) -> float | None:
    return float(value) if value is not None else None


def _import_psycopg2() -> Any:
    """延迟导入 psycopg2；失败时兜底接入 local-data/pylibs 后重试一次。

    服务器 pipeline 的 python 环境不受仓库管理，驱动以 pip --target 方式预置到
    local-data/pylibs（gitignore）；仍未安装时抛 MdsSourceError，仅本查询失败。
    """
    try:
        import psycopg2

        return psycopg2
    except ImportError as first_error:
        pylibs = Path(__file__).resolve().parents[2] / "local-data" / "pylibs"
        if pylibs.is_dir() and str(pylibs) not in sys.path:
            sys.path.insert(0, str(pylibs))
        try:
            import psycopg2

            return psycopg2
        except ImportError:
            raise MdsSourceError(
                "未安装 psycopg2-binary，无法读取 mds 库"
                f"（python {sys.version.split()[0]} @ {sys.executable}）"
            ) from first_error


def _connect(creds: dict[str, str]) -> Any:
    return _import_psycopg2().connect(
        host=creds["MDS_DB_HOST"],
        port=int(creds["MDS_DB_PORT"]),
        dbname=creds.get("MDS_DB_NAME") or "mds",
        user=creds["MDS_DB_USERNAME"],
        password=creds["MDS_DB_PASSWORD"],
        connect_timeout=15,
    )


def fetch_tmall_shop_daily(creds: dict[str, str] | None = None) -> pl.DataFrame:
    """全量拉取 mds 天猫店铺日汇总（1 行/天，整表全量刷新代价可忽略）。

    三条 SQL 逐字对齐 db_source.fetch_tmall：主表 15 字段（9 卡片字段 + 6 个 04 回填
    扩展字段，扩展列不 round 保留原始精度）+ 内容场景两场景求和 + 店铺排名同日取
    最好名次（MIN）。连接失败/凭据缺失抛 MdsSourceError。
    """
    creds = creds or _credentials()
    rows: dict[date, dict[str, Any]] = {}
    try:
        connection = _connect(creds)
        try:
            cursor = connection.cursor()
            columns = ", ".join(TMALL_FIELD_MAP.values())
            cursor.execute(f"SELECT data_date, {columns} FROM taobao_shop_daily_summary")
            fields = list(TMALL_FIELD_MAP)
            for row in cursor.fetchall():
                day = row[0]
                rows[day] = {
                    field: (_float_precise if field in TMALL_PRECISE_FIELDS else _float)(value)
                    for field, value in zip(fields, row[1:])
                }
            cursor.execute(
                "SELECT data_date, SUM(charge_amount) FROM taobao_shop_marketing_daily "
                "WHERE scene_name = ANY(%s) GROUP BY data_date",
                (list(TMALL_CONTENT_SCENES),),
            )
            for day, total in cursor.fetchall():
                if total is not None and day in rows:
                    rows[day]["内容场景"] = _float(total)
            cursor.execute(
                "SELECT data_date, MIN(rank_no) FROM taobao_shop_rank_daily "
                "WHERE shop_name = %s GROUP BY data_date",
                (TMALL_RANK_SHOP,),
            )
            for day, rank_no in cursor.fetchall():
                if rank_no is not None and day in rows:
                    rows[day]["店铺排名"] = int(rank_no)
        finally:
            connection.close()
    except MdsSourceError:
        raise
    except Exception as error:
        raise MdsSourceError(f"mds 天猫店铺日汇总读取失败：{type(error).__name__}: {error}") from error

    days = sorted(rows)
    schema = [("日期", pl.Date), *[(field, pl.Float64) for field in (*TMALL_FIELD_MAP, "内容场景")], ("店铺排名", pl.Int64)]
    data: dict[str, list[Any]] = {"日期": days}
    for field in (*TMALL_FIELD_MAP, "内容场景", "店铺排名"):
        data[field] = [rows[day].get(field) for day in days]
    return pl.DataFrame(data, schema=schema)


def _fetch_mapped_daily(
    creds: dict[str, str] | None,
    table: str,
    field_map: dict[str, str],
    label: str,
) -> pl.DataFrame:
    """通用日表映射拉取：SELECT data_date + 映射列 全量，列名换为文件链 canonical 中文。"""
    creds = creds or _credentials()
    try:
        connection = _connect(creds)
        try:
            cursor = connection.cursor()
            cursor.execute(f"SELECT data_date, {', '.join(field_map.values())} FROM {table}")
            records = cursor.fetchall()
        finally:
            connection.close()
    except MdsSourceError:
        raise
    except Exception as error:
        raise MdsSourceError(f"mds {label}读取失败：{type(error).__name__}: {error}") from error

    schema: list[tuple[str, Any]] = [("日期", pl.Date)]
    data: dict[str, list[Any]] = {"日期": [record[0] for record in records]}
    for index, field in enumerate(field_map, start=1):
        if field in TMALL_TEXT_FIELDS:
            schema.append((field, pl.Utf8))
            data[field] = [None if record[index] is None else str(record[index]) for record in records]
        else:
            schema.append((field, pl.Float64))
            data[field] = [_float(record[index]) for record in records]
    return pl.DataFrame(data, schema=schema)


def fetch_tmall_product_daily(creds: dict[str, str] | None = None) -> pl.DataFrame:
    """mds 天猫商品日明细（07 同口径）：taobao_shop_product_daily 全量（旗舰店单店单粒度）。"""
    return _fetch_mapped_daily(creds, "taobao_shop_product_daily", TMALL_PRODUCT_FIELD_MAP, "天猫商品日明细")


def fetch_tmall_scene_daily(creds: dict[str, str] | None = None) -> pl.DataFrame:
    """mds 天猫场景日明细（08 同口径）：taobao_shop_marketing_daily 全量（旗舰店单店）。"""
    return _fetch_mapped_daily(creds, "taobao_shop_marketing_daily", TMALL_SCENE_FIELD_MAP, "天猫场景日明细")


def fetch_tmall_item_promotion_daily(creds: dict[str, str] | None = None) -> pl.DataFrame:
    """mds 天猫商品推广日明细（08 商品粒度同口径）：taobao_item_promotion_daily 全量。

    promotion_id 即商品ID；表内无直接/间接购物车拆分，「直接购物车数」不输出，
    回填时由 warehouse 侧置 NULL（聚合后显示 0，已知口径缺口）。
    """
    return _fetch_mapped_daily(creds, "taobao_item_promotion_daily", TMALL_ITEM_PROMOTION_FIELD_MAP, "天猫商品推广日明细")


def _fetch_table(
    creds: dict[str, str] | None,
    table: str,
    fields: tuple[tuple[str, str], ...],
    label: str,
) -> pl.DataFrame:
    """通用整表拉取：COPY 到临时 CSV（低内存），再按字段类型 cast。

    大表（聚水潭 60 万行）不走 fetchall，避免 88.28 上同时驻留 tuple 列表与
    polars 字符串列造成峰值翻倍。
    """
    creds = creds or _credentials()
    columns = ", ".join(f'"{name}"' for name, _ in fields)
    descriptor, path = tempfile.mkstemp(suffix=".csv")
    os.close(descriptor)
    try:
        try:
            connection = _connect(creds)
            try:
                with open(path, "w", encoding="utf-8", newline="") as handle:
                    with connection.cursor() as cursor:
                        cursor.copy_expert(
                            f"COPY (SELECT {columns} FROM {table}) TO STDOUT "
                            "WITH (FORMAT csv, HEADER true)",
                            handle,
                        )
            finally:
                connection.close()
            frame = pl.read_csv(
                path,
                infer_schema_length=0,
                null_values=[""],
                quote_char='"',
                encoding="utf8",
            )
        except MdsSourceError:
            raise
        except Exception as error:
            raise MdsSourceError(
                f"mds {label}读取失败：{type(error).__name__}: {error}"
            ) from error
    finally:
        try:
            os.unlink(path)
        except OSError:
            # Windows 下 polars 可能仍持有 mmap 句柄，删不掉就留给临时目录清理。
            pass

    expressions = []
    for name, kind in fields:
        if kind == "date":
            expressions.append(pl.col(name).str.to_date("%Y-%m-%d").alias(name))
        elif kind == "float":
            expressions.append(pl.col(name).cast(pl.Float64, strict=False).alias(name))
        elif kind == "int":
            expressions.append(pl.col(name).cast(pl.Int64, strict=False).alias(name))
        elif kind == "bool":
            expressions.append(
                pl.when(pl.col(name).is_in(["t", "true"]))
                .then(True)
                .when(pl.col(name).is_in(["f", "false"]))
                .then(False)
                .otherwise(None)
                .alias(name)
            )
        else:
            expressions.append(pl.col(name).cast(pl.String, strict=False).alias(name))
    frame = frame.with_columns(expressions)
    return frame.select([name for name, _ in fields])


def fetch_jst_order_item_web(creds: dict[str, str] | None = None) -> pl.DataFrame:
    """mds 聚水潭商品页层（48 列，已过滤/派生/新零售覆盖）。"""
    return _fetch_table(creds, JST_WEB_TABLE, JST_WEB_FIELDS, "聚水潭商品页层")


def fetch_jst_order_item_export(creds: dict[str, str] | None = None) -> pl.DataFrame:
    """mds 聚水潭共享表导出层（39 列，已按 39 列去重）。"""
    return _fetch_table(creds, JST_EXPORT_TABLE, JST_EXPORT_FIELDS, "聚水潭共享表导出层")
