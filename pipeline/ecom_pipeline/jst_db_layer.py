"""聚水潭订单层：从 mds-postgres-1 的 public.jst_order_item_daily 直接生成

* ``public.jst_order_item_web``     网站商品页层（48 列，与 transforms._transform_jushuitan 同口径）
* ``public.jst_order_item_export``  共享表导出层（39 列，与 jushuitan39.transform_jushuitan_39 同口径）

辅助维表（首次/变更时用 ``--refresh-aux`` 从日更 Excel 重建）：

* ``jst_product_master`` / ``jst_jd_self_product`` / ``jst_shop_mapping`` /
  ``jst_offline_suborder`` / ``jst_week_map``

约定：
- 用户要求 mds-postgres-1 上只由 ``maizi`` 建表/写表；maizi 默认只读，
  写入连接先 ``SET default_transaction_read_only=off``。
- 规则以仓库版为准（2026-10-06 起不再有 ``0.01`` 垃圾单过滤），
  与网站 transforms.py 完全一致。
- 全量刷新；一个事务内 TRUNCATE + COPY，失败回滚、旧数据不变。
"""
from __future__ import annotations

import argparse
import json
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import polars as pl
import psycopg2

from .config import configured_data_root
from .jushuitan39 import (
    OUTPUT_COLUMNS,
    _load_京东自营商品表,
    _load_线下,
    _load_日期辅助表,
    _load_店铺名称对应表,
    _load_辅10_产品编码,
    transform_jushuitan_39,
)
from .jushuitan_source import normalize_jushuitan_columns
from .mds_source import _credentials
from .transforms import _transform_jushuitan

SOURCE_TABLE = "public.jst_order_item_daily"
WEB_TABLE = "public.jst_order_item_web"
EXPORT_TABLE = "public.jst_order_item_export"
PRODUCT_MASTER_TABLE = "public.jst_product_master"
JD_SELF_TABLE = "public.jst_jd_self_product"
SHOP_MAPPING_TABLE = "public.jst_shop_mapping"
OFFLINE_TABLE = "public.jst_offline_suborder"
WEEK_TABLE = "public.jst_week_map"
RUNS_TABLE = "public.jst_etl_runs"
EXPORT_STAGING_TABLE = "public.jst_order_item_export_staging"

# 分块大小：662k×108 全量常驻内存约 2GB+，分块降到 ~250MB，避免内存较小的机器 OOM。
# mds 服务器（7GB 内存、可用约 2.4GB）用 JST_ETL_CHUNK_SIZE=50000 更稳。
CHUNK_SIZE = int(os.environ.get("JST_ETL_CHUNK_SIZE", "100000"))

# jst_order_item_daily 的 108 个 snake_case 列与 Excel 导出表头按位置一一对应。
# 转换层直接复用现有逻辑，所以这里还原成 Excel 的注释表头（normalize 会再转短名）。
EXCEL_HEADERS: tuple[str, ...] = (
    "记录 ID",
    "内部订单号（聚水潭订单号）",
    '标记多标签（逗号分隔，如 "以旧换新·国家补贴,晚发赔"）',
    "售后单号",
    "订单类型（普通订单 等）",
    "线上订单号（平台订单号）",
    "平台外部订单号（当前源表为空）",
    "订单状态（异常/发货中(打单拣货)/已发货 等）",
    "原始线上订单号",
    "线上子订单编号",
    "出仓单号",
    "店铺（如 麻大师旗舰店-龚敢-京9）",
    "店铺编号（聚水潭店铺编号）",
    "商店站点（京东商城/淘宝天猫/京东厂家直送 等）",
    "订单来源（如 Mobile,拆分）",
    "发货仓",
    "运营云仓（当前源表为空）",
    "是否预售商品（是/否）",
    "分销商（当前源表为空）",
    "小旗（红色旗帜/蓝色旗帜/灰色旗帜 等）",
    "快递公司",
    "快递单号",
    "优惠券名称（分号分隔）",
    "买家账号（平台脱敏账号）",
    "买家ID（聚水潭）",
    "买家留言",
    "卖家备注（含跟单/审核/打款记录）",
    "业务员",
    "收货人（平台脱敏姓名）",
    "省",
    "市",
    "区县",
    "便签（含收货人电话/地址等）",
    "商品编码（SKU）",
    "款式编码",
    "店铺款式编码",
    "店铺商品编码",
    "组合装实体编码（当前源表为空）",
    "组合装商品编码",
    "虚拟分类（当前源表为空）",
    "产品分类（如 全拆款 - C黄麻薄垫）",
    "品牌",
    "商品简称",
    "线上商品名",
    "颜色规格（含尺寸，如 豆7 0胶透气-11CM=...,1350MM*2000MM）",
    "线上颜色规格",
    "供应商（当前源表为空）",
    "供应商款号（当前源表为空）",
    "供应商商品编码（当前源表为空）",
    "商品标签（当前源表为空）",
    "达人名称",
    "基本售价",
    "成本价（当前源表为空）",
    "成本价来源（当前源表为空）",
    "售价",
    "基本金额",
    "销售金额",
    "销售成本（当前源表为空）",
    "销售毛利",
    '销售毛利率（源为 "100.000%" 文本，按原文保留）',
    "已付金额",
    "应付金额",
    "买家实付",
    "商家实收",
    "平台补贴金额",
    "优惠金额",
    "运费收入",
    "运费收入分摊",
    "运费支出（当前源表为空）",
    "运费支出分摊（当前源表为空）",
    "其它价格1（当前源表为空）",
    "其它价格2（当前源表为空）",
    "其它价格3（当前源表为空）",
    "其它价格4（当前源表为空）",
    "其它价格5（当前源表为空）",
    "其它属性1（当前源表为空）",
    "其它属性2（当前源表为空）",
    "其它属性3（当前源表为空）",
    "其它属性4（当前源表为空）",
    "其它属性5（当前源表为空）",
    "销售数量",
    "赠品数量（当前源表为空）",
    "价格为零的商品数量",
    "实发数量",
    "实发金额",
    "实发成本（当前源表为空）",
    "退货数量",
    "实退数量（当前源表为空）",
    "退货金额",
    "退货成本（当前源表为空）",
    "实退成本（当前源表为空）",
    "实退金额（当前源表为空）",
    "订单重量",
    "订单商品重量",
    "商品资料设置重量",
    "订单日期",
    "发货日期",
    "付款日期",
    "确认收货日期",
    "供销支付时间",
    "售后登记日期",
    "售后确认日期",
    "售后进仓日期（当前源表为空）",
    "售后进仓单号（当前源表为空）",
    "售后分类（仅退款 等）",
    "问题类型（其他原因/与商家协商一致退款 等）",
    "首次导入时间",
    "最后更新时间",
)

# 需要截断到秒的日期列（Excel 路径是 "YYYY-MM-DD HH:MM:SS" 文本；DB 可能带微秒）
DATE_HEADERS = (
    "订单日期",
    "发货日期",
    "付款日期",
    "确认收货日期",
    "供销支付时间",
    "售后登记日期",
    "售后确认日期",
    "售后进仓日期（当前源表为空）",
)


def _db_columns(connection: Any, table: str) -> list[str]:
    with connection.cursor() as cursor:
        cursor.execute(f"SELECT * FROM {table} LIMIT 0")
        return [description[0] for description in cursor.description]


def _connect(write: bool = False) -> Any:
    """mds 连接。write=True 时关闭本会话只读（maizi 默认 default_transaction_read_only=on）。"""
    creds = _credentials()
    connection = psycopg2.connect(
        host=creds["MDS_DB_HOST"],
        port=int(creds["MDS_DB_PORT"]),
        dbname=creds.get("MDS_DB_NAME") or "mds",
        user=creds["MDS_DB_USERNAME"],
        password=creds["MDS_DB_PASSWORD"],
        connect_timeout=30,
    )
    connection.autocommit = True
    if write:
        with connection.cursor() as cursor:
            cursor.execute("SET default_transaction_read_only = off")
    connection.autocommit = False
    return connection


def _fetch_source_csv(connection: Any, destination: Path) -> None:
    """把源表导出成本地 CSV。

    destination 只由 ``refresh`` 传固定路径 ``local-data/tmp/jst_order_item_daily.csv``，
    不接受网络/用户输入；这里仍限制 .csv 后缀并拒绝符号链接，避免误写到其它位置。
    SOURCE_TABLE 是模块常量，f-string 不拼接外部输入。
    """
    destination = Path(destination)
    if destination.suffix.lower() != ".csv":
        raise ValueError(f"源表导出目标必须是 .csv：{destination}")
    if destination.is_symlink():
        raise ValueError(f"源表导出目标不允许是符号链接：{destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with open(destination, "w", encoding="utf-8", newline="") as handle:
        with connection.cursor() as cursor:
            cursor.copy_expert(
                f"COPY (SELECT * FROM {SOURCE_TABLE}) TO STDOUT WITH (FORMAT csv, HEADER true)",
                handle,
            )


def _source_lazy(csv_path: Path) -> pl.LazyFrame:
    return pl.scan_csv(
        csv_path,
        infer_schema_length=0,
        null_values=[""],
        quote_char='"',
        encoding="utf8",
    )


def _normalize_chunk(frame: pl.DataFrame, source_columns: list[str]) -> pl.DataFrame:
    if len(source_columns) != len(EXCEL_HEADERS):
        raise ValueError(f"源表列数 {len(source_columns)} 与 Excel 表头 {len(EXCEL_HEADERS)} 不一致")
    if frame.columns != source_columns:
        raise ValueError("源表列顺序与 jst_order_item_daily 不一致，拒绝按位置映射")
    frame = frame.rename(dict(zip(source_columns, EXCEL_HEADERS)))
    # 与 xlsx2csv 输出对齐：日期统一为秒级文本；空值保持 null。
    return frame.with_columns(
        [
            pl.col(column).cast(pl.String, strict=False).str.slice(0, 19)
            for column in DATE_HEADERS
            if column in frame.columns
        ]
    )


def _aux_from_excel(data_root: Path) -> dict[str, pl.DataFrame]:
    return {
        "辅10产品编码": _load_辅10_产品编码(data_root),
        "京东自营商品表": _load_京东自营商品表(data_root),
        "线下": _load_线下(data_root),
        "日期辅助表": _load_日期辅助表(data_root),
        "店铺名称对应表": _load_店铺名称对应表(data_root),
    }


def _aux_from_db(connection: Any) -> dict[str, pl.DataFrame]:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT merchant_spec_code, product_name, sub_name, spu_code, ship_warehouse, "
            "mattress_category, thickness, size, cost FROM public.jst_product_master"
        )
        product_rows = cursor.fetchall()
        cursor.execute("SELECT product_id, merchant_spec_code FROM public.jst_jd_self_product")
        jd_rows = cursor.fetchall()
        cursor.execute("SELECT sub_order_no, main_order_no FROM public.jst_offline_suborder")
        offline_rows = cursor.fetchall()
        cursor.execute("SELECT date, week FROM public.jst_week_map")
        week_rows = cursor.fetchall()
        cursor.execute("SELECT shop_name, shop_short_name FROM public.jst_shop_mapping")
        shop_rows = cursor.fetchall()

    product = pl.DataFrame(
        product_rows,
        schema={
            "商家规编（后台）": pl.String,
            "产品名称": pl.String,
            "子名称": pl.String,
            "SPU产品商编": pl.String,
            "发货仓": pl.String,
            "床垫类别": pl.String,
            "厚度": pl.String,
            "尺寸": pl.String,
            "成本": pl.String,
        },
        orient="row",
    )
    jd = pl.DataFrame(
        jd_rows,
        schema={"商品ID": pl.String, "商家规编（后台）": pl.String},
        orient="row",
    )
    offline = pl.DataFrame(
        offline_rows,
        schema={"子订单编号": pl.String, "主订单编号": pl.String},
        orient="row",
    )
    week = pl.DataFrame(
        week_rows,
        schema={"日期": pl.Date, "周": pl.String},
        orient="row",
    )
    shop = pl.DataFrame(
        shop_rows,
        schema={"店铺": pl.String, "店铺简称": pl.String},
        orient="row",
    )
    return {
        "辅10产品编码": product,
        "京东自营商品表": jd,
        "线下": offline,
        "日期辅助表": week,
        "店铺名称对应表": shop,
    }


def _copy_frame(cursor: Any, table: str, frame: pl.DataFrame) -> None:
    """COPY 写入；polars 的空值写成空字段，与 COPY 的 NULL '' 对齐。"""
    descriptor, path = tempfile.mkstemp(suffix=".csv")
    os.close(descriptor)
    try:
        frame.write_csv(path, include_header=False)
        columns = ", ".join(f'"{column}"' for column in frame.columns)
        with open(path, "rb") as source:
            cursor.copy_expert(
                f"COPY {table} ({columns}) FROM STDIN WITH (FORMAT csv, NULL '')",
                source,
            )
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _replace_aux_tables(connection: Any, aux: dict[str, pl.DataFrame]) -> None:
    product = aux["辅10产品编码"].select(
        [
            pl.col("商家规编（后台）"),
            pl.col("产品名称"),
            pl.col("子名称"),
            pl.col("SPU产品商编"),
            pl.col("发货仓"),
            pl.col("床垫类别"),
            pl.col("厚度"),
            pl.col("尺寸"),
            pl.col("成本"),
        ]
    )
    product = product.filter(
        pl.col("商家规编（后台）").is_not_null()
        & (pl.col("商家规编（后台）").cast(pl.String, strict=False) != "")
    ).unique(subset=["商家规编（后台）"], keep="first").rename(
        {
            "商家规编（后台）": "merchant_spec_code",
            "产品名称": "product_name",
            "子名称": "sub_name",
            "SPU产品商编": "spu_code",
            "发货仓": "ship_warehouse",
            "床垫类别": "mattress_category",
            "厚度": "thickness",
            "尺寸": "size",
            "成本": "cost",
        }
    )

    jd = aux["京东自营商品表"].select(["商品ID", "商家规编（后台）"]).unique().rename(
        {"商品ID": "product_id", "商家规编（后台）": "merchant_spec_code"}
    )
    offline = aux["线下"].select(["子订单编号", "主订单编号"]).filter(
        pl.col("子订单编号").is_not_null()
    ).unique(subset=["子订单编号"], keep="first").rename(
        {"子订单编号": "sub_order_no", "主订单编号": "main_order_no"}
    )
    week = aux["日期辅助表"].select(["日期", "周"]).filter(
        pl.col("日期").is_not_null()
    ).unique(subset=["日期"], keep="first").rename({"日期": "date", "周": "week"})
    shop = aux["店铺名称对应表"].select(["店铺", "店铺简称"]).filter(
        pl.col("店铺").is_not_null()
    ).unique(subset=["店铺"], keep="first").rename(
        {"店铺": "shop_name", "店铺简称": "shop_short_name"}
    )

    with connection:
        cursor = connection.cursor()
        cursor.execute(f"TRUNCATE {PRODUCT_MASTER_TABLE}")
        _copy_frame(cursor, PRODUCT_MASTER_TABLE, product)
        cursor.execute(f"TRUNCATE {JD_SELF_TABLE}")
        _copy_frame(cursor, JD_SELF_TABLE, jd)
        cursor.execute(f"TRUNCATE {OFFLINE_TABLE}")
        _copy_frame(cursor, OFFLINE_TABLE, offline)
        cursor.execute(f"TRUNCATE {WEEK_TABLE}")
        _copy_frame(cursor, WEEK_TABLE, week)
        cursor.execute(f"TRUNCATE {SHOP_MAPPING_TABLE}")
        _copy_frame(cursor, SHOP_MAPPING_TABLE, shop)


def _build_web_frame(source: pl.DataFrame, aux: dict[str, pl.DataFrame]) -> pl.DataFrame:
    offline_ids = frozenset(
        value
        for value in aux["线下"]["子订单编号"].drop_nulls().to_list()
        if value
    )
    store_mapping = {
        str(shop): str(short)
        for shop, short in aux["店铺名称对应表"].select(["店铺", "店铺简称"]).iter_rows()
        if shop
    }
    normalized = normalize_jushuitan_columns(source)
    return _transform_jushuitan(
        normalized,
        path=None,
        store_mapping=store_mapping,
        offline_ids=offline_ids,
    )


def _build_export_frame(source: pl.DataFrame, aux: dict[str, pl.DataFrame]) -> pl.DataFrame:
    export = transform_jushuitan_39(source, aux)
    return export.select(OUTPUT_COLUMNS)


def _write_health(payload: dict[str, Any]) -> None:
    path = (
        Path(__file__).resolve().parents[2]
        / "local-data"
        / "runtime"
        / "jst-db-layer-health.json"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    os.replace(temporary, path)


def refresh(
    *,
    refresh_aux: bool = False,
    data_root: Path | None = None,
    source_csv: Path | None = None,
    web_only: bool = False,
    export_only: bool = False,
) -> dict[str, Any]:
    started = datetime.now(timezone.utc)
    started_perf = time.perf_counter()
    root = data_root or configured_data_root()
    explicit_source = source_csv is not None
    csv_path = source_csv or (
        Path(__file__).resolve().parents[2] / "local-data" / "tmp" / "jst_order_item_daily.csv"
    )

    connection = _connect(write=True)
    try:
        source_columns = _db_columns(connection, SOURCE_TABLE)
        # 定时任务必须每轮重拉；只有显式 --source-csv（调试/复算）才复用既有文件。
        if not explicit_source:
            _fetch_source_csv(connection, csv_path)
        lazy = _source_lazy(csv_path)
        total_rows = int(lazy.select(pl.len()).collect().item())

        with connection.cursor() as cursor:
            cursor.execute(f"SELECT max(updated_at) FROM {SOURCE_TABLE}")
            source_max_updated_at = cursor.fetchone()[0]

        if refresh_aux:
            _replace_aux_tables(connection, _aux_from_excel(root))
        aux = _aux_from_db(connection)

        web_rows = 0
        export_rows = None
        with connection:
            cursor = connection.cursor()
            if not export_only:
                cursor.execute(f"TRUNCATE {WEB_TABLE}")
            if not web_only:
                cursor.execute(f"TRUNCATE {EXPORT_STAGING_TABLE}")

            for offset in range(0, total_rows, CHUNK_SIZE):
                chunk = _normalize_chunk(
                    lazy.slice(offset, CHUNK_SIZE).collect(),
                    source_columns,
                )
                if not export_only:
                    web = _build_web_frame(chunk, aux)
                    _copy_frame(cursor, WEB_TABLE, web)
                    web_rows += int(web.height)
                if not web_only:
                    export = _build_export_frame(chunk, aux)
                    _copy_frame(cursor, EXPORT_STAGING_TABLE, export)

            if not web_only:
                cursor.execute(f"TRUNCATE {EXPORT_TABLE}")
                cursor.execute(
                    f"INSERT INTO {EXPORT_TABLE} SELECT DISTINCT * FROM {EXPORT_STAGING_TABLE}"
                )
                cursor.execute(f"SELECT count(*) FROM {EXPORT_TABLE}")
                export_rows = int(cursor.fetchone()[0])
                cursor.execute(f"TRUNCATE {EXPORT_STAGING_TABLE}")

            cursor.execute(
                f"INSERT INTO {RUNS_TABLE} "
                "(started_at, finished_at, source_max_updated_at, web_rows, export_rows, status) "
                "VALUES (%s, now(), %s, %s, %s, 'success')",
                [
                    started,
                    source_max_updated_at,
                    web_rows if not export_only else None,
                    export_rows,
                ],
            )
        result = {
            "ok": True,
            "webRows": web_rows if not export_only else None,
            "exportRows": export_rows,
            "sourceRows": total_rows,
            "sourceMaxUpdatedAt": str(source_max_updated_at),
            "durationSeconds": round(time.perf_counter() - started_perf, 1),
            "finishedAt": datetime.now(timezone.utc).isoformat(),
        }
        _write_health({"status": "success", **result})
        return result
    except Exception as error:
        try:
            with connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"INSERT INTO {RUNS_TABLE} "
                        "(started_at, finished_at, status, error) VALUES (%s, now(), 'failed', %s)",
                        [started, f"{type(error).__name__}: {error}"[:2000]],
                    )
        except Exception:
            pass
        _write_health(
            {
                "status": "failed",
                "error": f"{type(error).__name__}: {error}"[:2000],
                "finishedAt": datetime.now(timezone.utc).isoformat(),
                "durationSeconds": round(time.perf_counter() - started_perf, 1),
            }
        )
        raise
    finally:
        connection.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build jst order layer tables in mds-postgres-1")
    parser.add_argument("--refresh-aux", action="store_true", help="从日更 Excel 重建辅助维表")
    parser.add_argument("--data-root", default=None, help="日更数据根目录（默认 ECOM_DATA_ROOT）")
    parser.add_argument("--source-csv", default=None, help="复用已导出的源表 CSV（调试用）")
    parser.add_argument("--web-only", action="store_true")
    parser.add_argument("--export-only", action="store_true")
    args = parser.parse_args(argv)
    result = refresh(
        refresh_aux=args.refresh_aux,
        data_root=Path(args.data_root) if args.data_root else None,
        source_csv=Path(args.source_csv) if args.source_csv else None,
        web_only=args.web_only,
        export_only=args.export_only,
    )
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
