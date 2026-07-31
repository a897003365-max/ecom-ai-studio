from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable

import duckdb
import polars as pl

from .catalog import QuerySpec, load_catalog
from .config import WarehousePaths
from .product_structure_builders import (
    build_product_structure_modules,
    empty_customization_structure,
    empty_price_structure,
    empty_size_structure,
    empty_spu_sales_trend,
)
from .readers import discover_files, read_source_file
from .source_policy import (
    DINGTALK_COVERED_QUERIES,
    PARTIAL_OVERLAP_QUERIES,
    select_sync_specs,
    unique_domain_catalog,
)
from .transforms import transform_source_file

ProgressCallback = Callable[[dict[str, Any]], None]
POWERBI_PAGE_WINDOW_DAYS = 60


@dataclass(frozen=True)
class SyncOptions:
    query_names: frozenset[str] | None = None
    max_files_per_query: int | None = None
    force: bool = False


def _read_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "files": {}}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value.get("files"), dict) else {"version": 1, "files": {}}
    except (json.JSONDecodeError, OSError):
        return {"version": 1, "files": {}}


def _write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=_json_value) + "\n", encoding="utf-8")
    for attempt in range(5):
        try:
            os.replace(temporary, path)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.05 * (attempt + 1))


def _json_value(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if hasattr(value, "item"):
        return value.item()
    raise TypeError(f"Unsupported JSON type: {type(value)!r}")


def _state_key(path: Path) -> str:
    return str(path.resolve()).lower()


def _file_signature(path: Path) -> str:
    metadata = path.stat()
    return f"{metadata.st_size}:{metadata.st_mtime_ns}"


def _partition_path(root: Path, spec: QuerySpec, source: Path) -> Path:
    digest = hashlib.sha1(str(source.resolve()).lower().encode("utf-8")).hexdigest()[:20]
    return root / spec.key / f"{digest}.parquet"


def _emit(progress: ProgressCallback | None, payload: dict[str, Any]) -> None:
    if progress:
        progress(payload)


def _sync_query(
    paths: WarehousePaths,
    spec: QuerySpec,
    state: dict[str, Any],
    options: SyncOptions,
    progress: ProgressCallback | None,
) -> dict[str, Any]:
    started = time.perf_counter()
    all_files = discover_files(spec.source_paths)
    selected = all_files
    if options.max_files_per_query:
        selected = sorted(all_files, key=lambda path: path.stat().st_mtime_ns, reverse=True)[: options.max_files_per_query]
    output_dir = paths.staging_root / spec.key
    output_dir.mkdir(parents=True, exist_ok=True)
    current_keys = {_state_key(path) for path in all_files}
    processed = 0
    reused = 0
    failed = 0
    errors = []

    _emit(progress, {"event": "query_started", "query": spec.name, "files": len(selected), "totalFiles": len(all_files)})
    for index, source in enumerate(selected, start=1):
        key = _state_key(source)
        signature = _file_signature(source)
        destination = _partition_path(paths.staging_root, spec, source)
        previous = state["files"].get(key)
        if (
            not options.force
            and previous
            and previous.get("query") == spec.name
            and previous.get("signature") == signature
            and destination.exists()
        ):
            reused += 1
            continue
        try:
            frame = read_source_file(source, spec)
            frame = transform_source_file(frame, spec, source)
            temporary = destination.with_suffix(".parquet.tmp")
            frame.write_parquet(temporary, compression="zstd", statistics=True)
            os.replace(temporary, destination)
            state["files"][key] = {
                "query": spec.name,
                "signature": signature,
                "source": str(source),
                "parquet": str(destination),
                "rows": frame.height,
                "columns": frame.width,
                "updatedAt": datetime.now().astimezone().isoformat(),
                "error": None,
            }
            processed += 1
        except Exception as error:  # Keep the last valid partition when one file is malformed.
            failed += 1
            message = str(error).replace("\r", " ").replace("\n", " ")[:500]
            errors.append({"file": source.name, "error": message})
            if previous:
                previous["error"] = message
                previous["failedAt"] = datetime.now().astimezone().isoformat()
            else:
                state["files"][key] = {
                    "query": spec.name,
                    "signature": signature,
                    "source": str(source),
                    "parquet": None,
                    "rows": 0,
                    "columns": 0,
                    "updatedAt": datetime.now().astimezone().isoformat(),
                    "error": message,
                }
        if index % 50 == 0:
            _emit(progress, {"event": "query_progress", "query": spec.name, "completed": index, "files": len(selected), "failed": failed})

    if options.max_files_per_query is None:
        for key, item in list(state["files"].items()):
            if item.get("query") != spec.name or key in current_keys:
                continue
            parquet = item.get("parquet")
            if parquet:
                Path(parquet).unlink(missing_ok=True)
            del state["files"][key]

    active = [
        item
        for item in state["files"].values()
        if item.get("query") == spec.name and item.get("parquet") and Path(item["parquet"]).exists()
    ]
    result = {
        "query": spec.name,
        "key": spec.key,
        "files": len(all_files),
        "activePartitions": len(active),
        "processed": processed,
        "reused": reused,
        "failed": failed,
        "rows": sum(int(item.get("rows", 0)) for item in active),
        "columns": max((int(item.get("columns", 0)) for item in active), default=0),
        "errors": errors[:20],
        "durationSeconds": round(time.perf_counter() - started, 3),
        "status": "success" if failed == 0 else "partial" if active else "failed",
    }
    _emit(progress, {"event": "query_finished", **{key: value for key, value in result.items() if key != "errors"}})
    return result


def _quote_identifier(value: str) -> str:
    return f'"{value.replace(chr(34), chr(34) * 2)}"'


def _sql_path(path: Path) -> str:
    return path.resolve().as_posix().replace("'", "''")


def _view_columns(connection: duckdb.DuckDBPyConnection, view_name: str) -> list[str]:
    return [row[0] for row in connection.execute(f"DESCRIBE {_quote_identifier(view_name)}").fetchall()]


def _create_source_views(
    connection: duckdb.DuckDBPyConnection,
    paths: WarehousePaths,
    specs: list[QuerySpec],
    query_results: dict[str, dict[str, Any]],
) -> None:
    connection.execute("DROP TABLE IF EXISTS warehouse_query_catalog")
    connection.execute(
        """
        CREATE TABLE warehouse_query_catalog (
          query_name VARCHAR,
          source_view VARCHAR,
          model_view VARCHAR,
          source_kind VARCHAR,
          m_file VARCHAR,
          source_paths JSON,
          files BIGINT,
          partitions BIGINT,
          rows BIGINT,
          columns BIGINT,
          status VARCHAR,
          updated_at TIMESTAMPTZ
        )
        """
    )
    for spec in specs:
        query_dir = paths.staging_root / spec.key
        partitions = list(query_dir.glob("*.parquet"))
        source_view = spec.view_name
        model_view = f"model_{spec.key}"
        connection.execute(f"DROP VIEW IF EXISTS {_quote_identifier(model_view)}")
        connection.execute(f"DROP VIEW IF EXISTS {_quote_identifier(source_view)}")
        if partitions:
            glob = _sql_path(query_dir / "*.parquet")
            connection.execute(
                f"CREATE VIEW {_quote_identifier(source_view)} AS SELECT * FROM read_parquet('{glob}', union_by_name=true)"
            )
            source_columns = _view_columns(connection, source_view)
            if spec.name == "product-master" and "商品编码" in source_columns:
                # 一个商品编码只能作为一条维表记录参与订单 JOIN。源文件维度
                # (_source_path/_source_mtime_ns) 会让 SELECT DISTINCT 无法跨文件去重，
                # 从而把聚水潭订单行放大；这里沿用其他快照模型的最新文件优先规则。
                connection.execute(
                    f"""
                    CREATE VIEW {_quote_identifier(model_view)} AS
                    SELECT * EXCLUDE (_product_master_rank)
                    FROM (
                      SELECT *, row_number() OVER (
                        PARTITION BY cast("商品编码" AS VARCHAR)
                        ORDER BY "_source_mtime_ns" DESC NULLS LAST, "_source_path" DESC NULLS LAST
                      ) AS _product_master_rank
                      FROM {_quote_identifier(source_view)}
                      WHERE "商品编码" IS NOT NULL AND trim(cast("商品编码" AS VARCHAR)) <> ''
                    )
                    WHERE _product_master_rank = 1
                    """
                )
            elif spec.name == "15-聚水潭商品数据" and {"_source_path", "_source_mtime_ns"}.issubset(source_columns):
                # PBIX query 15 ends with Table.Distinct.  Source metadata is not
                # part of that query, so exclude it before deduplicating snapshots.
                # The transformer retains order identifiers, preventing distinct
                # from collapsing separate order lines with similar SKU metrics.
                connection.execute(
                    f"""
                    CREATE VIEW {_quote_identifier(model_view)} AS
                    SELECT DISTINCT * EXCLUDE (_source_path, _source_mtime_ns)
                    FROM {_quote_identifier(source_view)}
                    """
                )
            else:
                connection.execute(f"CREATE VIEW {_quote_identifier(model_view)} AS SELECT DISTINCT * FROM {_quote_identifier(source_view)}")
        else:
            connection.execute(f"CREATE VIEW {_quote_identifier(source_view)} AS SELECT NULL::VARCHAR AS _empty WHERE FALSE")
            connection.execute(f"CREATE VIEW {_quote_identifier(model_view)} AS SELECT * FROM {_quote_identifier(source_view)}")
        result = query_results.get(spec.name, {})
        connection.execute(
            "INSERT INTO warehouse_query_catalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)",
            [
                spec.name,
                source_view,
                model_view,
                spec.source_kind,
                spec.m_file,
                json.dumps([str(path) for path in spec.source_paths], ensure_ascii=False),
                result.get("files", len(discover_files(spec.source_paths))),
                len(partitions),
                result.get("rows", 0),
                result.get("columns", 0),
                result.get("status", "cached" if partitions else "empty"),
            ],
        )


def _deactivate_dingtalk_overlap(
    connection: duckdb.DuckDBPyConnection,
    paths: WarehousePaths,
    excluded_specs: list[QuerySpec],
) -> None:
    """Remove duplicate data from active models while preserving source partitions."""

    for spec in excluded_specs:
        connection.execute(f"DROP VIEW IF EXISTS {_quote_identifier(f'model_{spec.key}')}")
        connection.execute(f"DROP VIEW IF EXISTS {_quote_identifier(spec.view_name)}")
    connection.execute("DROP TABLE IF EXISTS fact_channel_daily")
    (paths.marts_root / "fact_channel_daily.parquet").unlink(missing_ok=True)


def _replace_model_view(
    connection: duckdb.DuckDBPyConnection,
    destination: str,
    source_views: list[str],
) -> None:
    existing = []
    for view in source_views:
        columns = _view_columns(connection, view)
        if columns != ["_empty"]:
            existing.append(view)
    if not existing:
        return
    union = " UNION ALL BY NAME ".join(f"SELECT * FROM {_quote_identifier(view)}" for view in existing)
    connection.execute(f"CREATE OR REPLACE VIEW {_quote_identifier(destination)} AS SELECT DISTINCT * FROM ({union})")


def _create_composite_views(connection: duckdb.DuckDBPyConnection, specs: list[QuerySpec]) -> None:
    by_name = {spec.name: spec for spec in specs}
    combinations = {
        "08-旗舰店推广花费": ["08-旗舰店推广花费", "11-旗舰店UD推广计划"],
        "10-2京东客服营销明细": ["10-2京东客服营销明细", "接待数据"],
        "10-3京东客服绩效数据": ["10-3京东客服绩效数据", "营销数据", "营销数据改版"],
        "10-4客服员工日报统计": ["10-4客服员工日报统计", "考勤数据"],
    }
    for destination_name, source_names in combinations.items():
        if destination_name not in by_name or not all(name in by_name for name in source_names):
            continue
        destination = f"model_{by_name[destination_name].key}"
        sources = [by_name[name].view_name for name in source_names]
        _replace_model_view(connection, destination, sources)

    group_spec = by_name.get("京东客服分组表")
    schedule_spec = by_name.get("淘宝客服排班表")
    if group_spec and schedule_spec:
        group_source = _quote_identifier(group_spec.view_name)
        schedule_source = _quote_identifier(schedule_spec.view_name)
        group_columns = _view_columns(connection, group_spec.view_name)
        schedule_columns = _view_columns(connection, schedule_spec.view_name)
        if "客服账号" in group_columns and {"昵称", "旺旺昵称"}.issubset(schedule_columns):
            destination = _quote_identifier(f"model_{group_spec.key}")
            connection.execute(
                f"""
                CREATE OR REPLACE VIEW {destination} AS
                SELECT groups.*, match."昵称", match."旺旺昵称" AS "客服"
                FROM {group_source} AS groups
                LEFT JOIN LATERAL (
                  SELECT schedules."昵称", schedules."旺旺昵称",
                         jaro_winkler_similarity(
                           lower(replace(cast(groups."客服账号" AS VARCHAR), ' ', '')),
                           lower(replace(cast(schedules."昵称" AS VARCHAR), ' ', ''))
                         ) AS score
                  FROM {schedule_source} AS schedules
                  ORDER BY score DESC
                  LIMIT 1
                ) AS match ON match.score >= 0.1
                WHERE cast(groups."客服账号" AS VARCHAR) <> '麻大师思思'
                """
            )


def _records(
    connection: duckdb.DuckDBPyConnection,
    sql: str,
    parameters: list[Any] | None = None,
) -> list[dict[str, Any]]:
    cursor = connection.execute(sql, parameters or [])
    columns = [item[0] for item in cursor.description]
    return [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]


def _matrix(
    connection: duckdb.DuckDBPyConnection,
    sql: str,
    row_field: str,
) -> dict[str, Any]:
    """把 PIVOT 查询结果转为前端矩阵 {columns:[...], rows:[{rowKey, values, total}]}。

    列按总计降序排列。每个 PIVOT 查询须把行维度别名为 {row_field}，列维度作为 PIVOT ON 目标。
    """
    rows = _records(connection, sql)
    if not rows:
        return {"columns": [], "rows": []}
    col_keys = [k for k in rows[0].keys() if k != row_field]
    result_rows = []
    for record in rows:
        values = {k: (record.get(k) or 0) for k in col_keys}
        result_rows.append(
            {"rowKey": str(record[row_field]) if record[row_field] is not None else "(空)", "values": values, "total": sum(values.values())}
        )
    col_totals = {k: sum((rr["values"].get(k, 0) or 0) for rr in result_rows) for k in col_keys}
    col_keys_sorted = sorted(col_keys, key=lambda k: col_totals[k], reverse=True)
    return {"columns": col_keys_sorted, "rows": result_rows}


def _safe_product_image(value: Any) -> str | None:
    """Allow only the catalog image CDN in the public PowerBI snapshot."""

    text = str(value or "").strip()
    return text if text.lower().startswith("https://img.alicdn.com/") else None


def _model_view(connection: duckdb.DuckDBPyConnection, query_name: str) -> str:
    row = connection.execute(
        "SELECT model_view FROM warehouse_query_catalog WHERE query_name = ?",
        [query_name],
    ).fetchone()
    if not row:
        raise ValueError(f"未找到 PowerBI 查询模型：{query_name}")
    return _quote_identifier(row[0])


def _source_view(connection: duckdb.DuckDBPyConnection, query_name: str) -> str:
    """返回 source 视图名（未去重全量行）。聚水潭订单行粒度需用 source 聚合，model 视图
    的 SELECT DISTINCT 会因丢弃订单唯一键而错误折叠同商品同日同金额的不同订单行。"""
    row = connection.execute(
        "SELECT source_view FROM warehouse_query_catalog WHERE query_name = ?",
        [query_name],
    ).fetchone()
    if not row:
        raise ValueError(f"未找到 PowerBI 查询源视图：{query_name}")
    return _quote_identifier(row[0])


def _store_rank_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    text = str(value).strip()
    return text if text and text.lower() not in {"nan", "none"} else None


def _store_rank_sort_key(value: str) -> tuple[int, float | str]:
    """Match the PBIX numeric MIN while retaining a deterministic text fallback."""

    try:
        return (0, float(value.replace(",", "")))
    except ValueError:
        return (1, value)


def _load_pbix_store_rank_daily(paths: WarehousePaths) -> dict[str, str]:
    """Read only PBIX 店铺排名 from excluded 00 source without creating a warehouse view.

    00-月表汇总 remains excluded because DingTalk owns its overlapping business metrics.
    店铺排名 is the one PBIX matrix field not covered by DingTalk, so it is read
    ephemerally and never persisted with the overlapping GMV/refund/spend columns.
    """

    _, specs = load_catalog(paths.manifest)
    spec = next((item for item in specs if item.name == "00-月表汇总"), None)
    if spec is None:
        raise ValueError("PBIX manifest 缺少 00-月表汇总，无法读取店铺排名")

    ranks: dict[str, str] = {}
    for source in discover_files(spec.source_paths):
        frame = transform_source_file(read_source_file(source, spec), spec, source)
        required = {"日期", "店铺", "渠道", "店铺排名"}
        missing = required - set(frame.columns)
        if missing:
            raise ValueError(f"00-月表汇总缺少店铺排名字段：{', '.join(sorted(missing))}")
        for row in frame.select(sorted(required)).iter_rows(named=True):
            if str(row.get("店铺") or "").strip() != "麻大师旗舰店":
                continue
            if str(row.get("渠道") or "").strip() not in {"淘系", "淘宝"}:
                continue
            day = row.get("日期")
            rank = _store_rank_text(row.get("店铺排名"))
            if day is None or rank is None:
                continue
            day_key = day.isoformat() if isinstance(day, (date, datetime)) else str(day)[:10]
            current = ranks.get(day_key)
            if current is None or _store_rank_sort_key(rank) < _store_rank_sort_key(current):
                ranks[day_key] = rank
    return ranks


def _build_powerbi_pages(
    connection: duckdb.DuckDBPyConnection,
    store_rank_daily: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Build compact daily aggregates for the three PBIX-derived website pages."""

    base_view = _model_view(connection, "04-旗舰店基础数据")
    product_view = _model_view(connection, "07-旗舰店商品销售数据")
    promotion_view = _model_view(connection, "08-旗舰店推广花费")
    catalog_view = _model_view(connection, "05-旗舰店ID对照表")

    latest_candidates = [
        connection.execute(
            f'SELECT max(try_cast("统计日期" AS DATE)) FROM {base_view} '
            'WHERE try_cast("统计日期" AS DATE) <= current_date'
        ).fetchone()[0],
        connection.execute(
            f'SELECT max(try_cast("日期" AS DATE)) FROM {product_view} '
            'WHERE try_cast("日期" AS DATE) <= current_date'
        ).fetchone()[0],
        connection.execute(
            f'SELECT max(try_cast("日期" AS DATE)) FROM {promotion_view} '
            'WHERE try_cast("日期" AS DATE) <= current_date'
        ).fetchone()[0],
    ]
    latest_dates = [value for value in latest_candidates if value]
    if not latest_dates:
        return {
            "source": "powerbi_local_logic",
            "period": None,
            "overallDaily": [],
            "dailyCore": [],
            "productDaily": [],
            "productDailyPriorYear": [],
            "promotionSceneDaily": [],
            "promotionProductDaily": [],
            "products": [],
        }
    period_end = max(latest_dates)
    period_start = period_end - timedelta(days=POWERBI_PAGE_WINDOW_DAYS - 1)

    overall_daily = _records(
        connection,
        f"""
        WITH dedup AS (
          SELECT * EXCLUDE (_snapshot_rank) FROM (
            SELECT *, row_number() OVER (
              PARTITION BY try_cast("统计日期" AS DATE), cast("店铺名称" AS VARCHAR)
              ORDER BY "_source_mtime_ns" DESC, "_source_path" DESC
            ) AS _snapshot_rank
            FROM {base_view}
            WHERE try_cast("统计日期" AS DATE) BETWEEN ? AND ?
          ) WHERE _snapshot_rank = 1
        )
        SELECT
          try_cast("统计日期" AS DATE) AS date,
          sum(coalesce(try_cast("访客数" AS DOUBLE), 0)) AS visitors,
          sum(coalesce(try_cast("商品访客数" AS DOUBLE), 0)) AS productVisitors,
          sum(coalesce(try_cast("加购人数" AS DOUBLE), 0)) AS addToCart,
          sum(coalesce(try_cast("支付买家数" AS DOUBLE), 0)) AS payBuyers,
          sum(coalesce(try_cast("支付金额" AS DOUBLE), 0)) AS payAmount,
          sum(coalesce(try_cast("成功退款金额" AS DOUBLE), 0)) AS refund,
          sum(coalesce(try_cast("全站推广花费" AS DOUBLE), 0)) AS fullSiteSpend,
          sum(coalesce(try_cast("关键词推广花费" AS DOUBLE), 0)) AS keywordSpend,
          sum(coalesce(try_cast("精准人群推广花费" AS DOUBLE), 0)) AS audienceSpend,
          sum(coalesce(try_cast("淘宝客佣金" AS DOUBLE), 0)) AS taokeSpend,
          sum(coalesce(try_cast("新访客数" AS DOUBLE), 0)) AS newVisitors,
          sum(coalesce(try_cast("老访客数" AS DOUBLE), 0)) AS returningVisitors,
          avg(try_cast("平均停留时长" AS DOUBLE)) AS avgStaySeconds,
          avg(try_cast("跳失率" AS DOUBLE)) AS bounceRate
        FROM dedup
        GROUP BY 1 ORDER BY 1
        """,
        [period_start, period_end],
    )

    # 对齐 PBIX「天猫旗舰店整体数据 -> 每天核心数据」矩阵。
    # 字段来源和 DAX 口径：07 商品表 + 08 推广表；店铺排名由 00 原始表仅字段补充。
    daily_core = _records(
        connection,
        f"""
        WITH product_dedup AS (
          SELECT * EXCLUDE (_snapshot_rank) FROM (
            SELECT *, row_number() OVER (
              PARTITION BY try_cast("日期" AS DATE), cast("商品ID" AS VARCHAR)
              ORDER BY "_source_mtime_ns" DESC, "_source_path" DESC
            ) AS _snapshot_rank
            FROM {product_view}
            WHERE try_cast("日期" AS DATE) BETWEEN ? AND ? AND "商品ID" IS NOT NULL
          ) WHERE _snapshot_rank = 1
        ), product_by_date AS (
          SELECT
            try_cast("日期" AS DATE) AS date,
            sum(coalesce(try_cast("商品访客数" AS DOUBLE), 0)) AS productVisitors,
            sum(coalesce(try_cast("加购人数" AS DOUBLE), 0)) AS addToCart,
            sum(coalesce(try_cast("支付买家数" AS DOUBLE), 0)) AS payBuyers,
            sum(coalesce(try_cast("支付金额" AS DOUBLE), 0)) AS payAmount,
            sum(coalesce(try_cast("退款金额" AS DOUBLE), 0)) AS refundAmount,
            sum(
              CASE WHEN strpos(coalesce(cast("商品名称" AS VARCHAR), ''), '差价') = 0
                THEN coalesce(try_cast("商品支付件数" AS DOUBLE), 0)
                ELSE 0
              END
            ) AS paidUnits
          FROM product_dedup
          GROUP BY 1
        ), promotion_dedup AS (
          SELECT * EXCLUDE (_snapshot_rank) FROM (
            SELECT *, row_number() OVER (
              PARTITION BY
                try_cast("日期" AS DATE),
                coalesce(cast("场景ID" AS VARCHAR), ''),
                coalesce(cast("计划ID" AS VARCHAR), ''),
                coalesce(cast("商品ID" AS VARCHAR), ''),
                coalesce(cast("主体名称" AS VARCHAR), ''),
                coalesce(cast("_source_sheet" AS VARCHAR), '')
              ORDER BY "_source_mtime_ns" DESC, "_source_path" DESC
            ) AS _snapshot_rank
            FROM {promotion_view}
            WHERE try_cast("日期" AS DATE) BETWEEN ? AND ?
          ) WHERE _snapshot_rank = 1
        ), promotion_by_date AS (
          SELECT
            try_cast("日期" AS DATE) AS date,
            sum(coalesce(try_cast("花费（未含达人）" AS DOUBLE), try_cast("花费" AS DOUBLE), 0)) AS spend,
            sum(coalesce(try_cast("总购物车数" AS DOUBLE), 0)) AS promotionCarts
          FROM promotion_dedup
          GROUP BY 1
        ), available_dates AS (
          SELECT date FROM product_by_date
          UNION
          SELECT date FROM promotion_by_date
        )
        SELECT
          dates.date AS date,
          strftime(dates.date, '%Y') AS year,
          strftime(dates.date, '%m') || '月' AS month,
          strftime(dates.date, '%d') AS day,
          coalesce(product.productVisitors, 0) AS productVisitors,
          coalesce(product.addToCart, 0) AS addToCart,
          coalesce(product.payBuyers, 0) AS payBuyers,
          coalesce(promotion.promotionCarts, 0) AS promotionCarts,
          product.addToCart / nullif(product.productVisitors, 0) AS addToCartRate,
          promotion.spend / nullif(promotion.promotionCarts, 0) AS addToCartCost,
          coalesce(product.payAmount, 0) AS payAmount,
          coalesce(product.paidUnits, 0) AS paidUnits,
          product.payBuyers / nullif(product.productVisitors, 0) AS conversionRate,
          coalesce(product.refundAmount, 0) AS refundAmount,
          product.refundAmount / nullif(product.payAmount, 0) AS refundRate,
          coalesce(promotion.spend, 0) AS spend,
          (coalesce(product.payAmount, 0) - coalesce(product.refundAmount, 0)) * 0.85 AS subsidizedAmount,
          promotion.spend / nullif(
            (coalesce(product.payAmount, 0) - coalesce(product.refundAmount, 0)) * 0.85,
            0
          ) AS subsidizedFeeRate,
          cast(NULL AS VARCHAR) AS storeRank
        FROM available_dates AS dates
        LEFT JOIN product_by_date AS product ON product.date = dates.date
        LEFT JOIN promotion_by_date AS promotion ON promotion.date = dates.date
        ORDER BY dates.date
        """,
        [
            period_start,
            period_end,
            period_start,
            period_end,
        ],
    )
    for row in daily_core:
        row["storeRank"] = (store_rank_daily or {}).get(str(row["date"]))

    product_daily = _records(
        connection,
        f"""
        WITH dedup AS (
          SELECT * EXCLUDE (_snapshot_rank) FROM (
            SELECT *, row_number() OVER (
              PARTITION BY try_cast("日期" AS DATE), cast("商品ID" AS VARCHAR)
              ORDER BY "_source_mtime_ns" DESC, "_source_path" DESC
            ) AS _snapshot_rank
            FROM {product_view}
            WHERE try_cast("日期" AS DATE) BETWEEN ? AND ? AND "商品ID" IS NOT NULL
          ) WHERE _snapshot_rank = 1
        ), ranked AS (
          SELECT cast("商品ID" AS VARCHAR) AS productId,
                 sum(coalesce(try_cast("商品访客数" AS DOUBLE), 0)) AS visitors
          FROM dedup
          GROUP BY 1 ORDER BY visitors DESC LIMIT 60
        )
        SELECT
          try_cast(data."日期" AS DATE) AS date,
          cast(data."商品ID" AS VARCHAR) AS productId,
          any_value(cast(data."商品名称" AS VARCHAR)) AS productName,
          sum(coalesce(try_cast(data."商品访客数" AS DOUBLE), 0)) AS visitors,
          sum(coalesce(try_cast(data."加购人数" AS DOUBLE), 0)) AS addToCart,
          sum(coalesce(try_cast(data."支付买家数" AS DOUBLE), 0)) AS payBuyers,
          sum(coalesce(try_cast(data."支付金额" AS DOUBLE), 0)) AS payAmount,
          sum(coalesce(try_cast(data."退款金额" AS DOUBLE), 0)) AS refund,
          sum(coalesce(try_cast(data."商品支付件数" AS DOUBLE), 0)) AS paidUnits
        FROM dedup AS data
        INNER JOIN ranked ON ranked.productId = cast(data."商品ID" AS VARCHAR)
        GROUP BY 1, 2 ORDER BY 1, visitors DESC
        """,
        [period_start, period_end],
    )

    # 去年同期商品级聚合，用于「国补后金额同比」（对齐 .pbix DATEADD(-365, DAY)）
    prior_year_start = period_start - timedelta(days=365)
    prior_year_end = period_end - timedelta(days=365)
    product_daily_prior_year = _records(
        connection,
        f"""
        WITH dedup AS (
          SELECT * EXCLUDE (_snapshot_rank) FROM (
            SELECT *, row_number() OVER (
              PARTITION BY try_cast("日期" AS DATE), cast("商品ID" AS VARCHAR)
              ORDER BY "_source_mtime_ns" DESC, "_source_path" DESC
            ) AS _snapshot_rank
            FROM {product_view}
            WHERE try_cast("日期" AS DATE) BETWEEN ? AND ? AND "商品ID" IS NOT NULL
          ) WHERE _snapshot_rank = 1
        )
        SELECT
          cast("商品ID" AS VARCHAR) AS productId,
          sum(coalesce(try_cast("支付金额" AS DOUBLE), 0)) AS payAmount,
          sum(coalesce(try_cast("退款金额" AS DOUBLE), 0)) AS refund
        FROM dedup
        GROUP BY 1
        """,
        [prior_year_start, prior_year_end],
    )

    promotion_scene_daily = _records(
        connection,
        f"""
        WITH dedup AS (
          SELECT * EXCLUDE (_snapshot_rank) FROM (
            SELECT *, row_number() OVER (
              PARTITION BY
                try_cast("日期" AS DATE),
                coalesce(cast("场景ID" AS VARCHAR), ''),
                coalesce(cast("计划ID" AS VARCHAR), ''),
                coalesce(cast("商品ID" AS VARCHAR), ''),
                coalesce(cast("主体名称" AS VARCHAR), ''),
                coalesce(cast("_source_sheet" AS VARCHAR), '')
              ORDER BY "_source_mtime_ns" DESC, "_source_path" DESC
            ) AS _snapshot_rank
            FROM {promotion_view}
            WHERE try_cast("日期" AS DATE) BETWEEN ? AND ?
          ) WHERE _snapshot_rank = 1
        )
        SELECT
          try_cast("日期" AS DATE) AS date,
          coalesce(nullif(cast("场景名字" AS VARCHAR), ''), '未分类场景') AS scene,
          sum(coalesce(try_cast("展现量" AS DOUBLE), 0)) AS impressions,
          sum(coalesce(try_cast("点击量" AS DOUBLE), 0)) AS clicks,
          sum(coalesce(try_cast("花费（未含达人）" AS DOUBLE), try_cast("花费" AS DOUBLE), 0)) AS spend,
          sum(coalesce(try_cast("总成交金额" AS DOUBLE), 0)) AS revenue,
          sum(coalesce(try_cast("总购物车数" AS DOUBLE), 0)) AS carts,
          sum(coalesce(try_cast("直接购物车数" AS DOUBLE), 0)) AS directCarts,
          sum(coalesce(try_cast("旺旺咨询量" AS DOUBLE), 0)) AS consultations
        FROM dedup
        GROUP BY 1, 2 ORDER BY 1, spend DESC
        """,
        [period_start, period_end],
    )

    promotion_product_daily = _records(
        connection,
        f"""
        WITH dedup AS (
          SELECT * EXCLUDE (_snapshot_rank) FROM (
            SELECT *, row_number() OVER (
              PARTITION BY
                try_cast("日期" AS DATE),
                coalesce(cast("场景ID" AS VARCHAR), ''),
                coalesce(cast("计划ID" AS VARCHAR), ''),
                coalesce(cast("商品ID" AS VARCHAR), ''),
                coalesce(cast("主体名称" AS VARCHAR), ''),
                coalesce(cast("_source_sheet" AS VARCHAR), '')
              ORDER BY "_source_mtime_ns" DESC, "_source_path" DESC
            ) AS _snapshot_rank
            FROM {promotion_view}
            WHERE try_cast("日期" AS DATE) BETWEEN ? AND ? AND "商品ID" IS NOT NULL
          ) WHERE _snapshot_rank = 1
        ), ranked AS (
          SELECT cast("商品ID" AS VARCHAR) AS productId,
                 sum(coalesce(try_cast("花费（未含达人）" AS DOUBLE), try_cast("花费" AS DOUBLE), 0)) AS spend
          FROM dedup
          GROUP BY 1 ORDER BY spend DESC LIMIT 60
        )
        SELECT
          try_cast(data."日期" AS DATE) AS date,
          cast(data."商品ID" AS VARCHAR) AS productId,
          coalesce(nullif(cast(data."场景名字" AS VARCHAR), ''), '未分类场景') AS scene,
          sum(coalesce(try_cast(data."展现量" AS DOUBLE), 0)) AS impressions,
          sum(coalesce(try_cast(data."点击量" AS DOUBLE), 0)) AS clicks,
          sum(coalesce(try_cast(data."花费（未含达人）" AS DOUBLE), try_cast(data."花费" AS DOUBLE), 0)) AS spend,
          sum(coalesce(try_cast(data."总成交金额" AS DOUBLE), 0)) AS revenue,
          sum(coalesce(try_cast(data."总购物车数" AS DOUBLE), 0)) AS carts,
          sum(coalesce(try_cast(data."直接购物车数" AS DOUBLE), 0)) AS directCarts,
          sum(coalesce(try_cast(data."旺旺咨询量" AS DOUBLE), 0)) AS consultations
        FROM dedup AS data
        INNER JOIN ranked ON ranked.productId = cast(data."商品ID" AS VARCHAR)
        GROUP BY 1, 2, 3 ORDER BY 1, spend DESC
        """,
        [period_start, period_end],
    )

    product_ids = sorted(
        {str(item["productId"]) for item in product_daily + promotion_product_daily if item.get("productId")}
    )
    products: list[dict[str, Any]] = []
    if product_ids:
        placeholders = ", ".join("?" for _ in product_ids)
        products = _records(
            connection,
            f"""
            SELECT cast("商品ID" AS VARCHAR) AS productId,
                   any_value(cast("商品名称" AS VARCHAR)) AS productName,
                   any_value(cast("商家编码" AS VARCHAR)) AS merchantCode,
                   any_value(nullif(trim(cast("商品图片" AS VARCHAR)), '')) AS imageUrl,
                   max(coalesce(try_cast("30日销量" AS DOUBLE), 0)) AS sales30d,
                   max(coalesce(try_cast("累计销量" AS DOUBLE), 0)) AS cumulativeSales
            FROM {catalog_view}
            WHERE cast("商品ID" AS VARCHAR) IN ({placeholders})
            GROUP BY 1 ORDER BY sales30d DESC
            """,
            product_ids,
        )
        products = [
            {**item, "imageUrl": _safe_product_image(item.get("imageUrl"))}
            for item in products
        ]

    return {
        "source": "powerbi_local_logic",
        "period": {"start": period_start, "end": period_end},
        "overallDaily": overall_daily,
        "dailyCore": daily_core,
        "productDaily": product_daily,
        "productDailyPriorYear": product_daily_prior_year,
        "promotionSceneDaily": promotion_scene_daily,
        "promotionProductDaily": promotion_product_daily,
        "products": products,
        "privacy": {"rawRowsExposed": False, "sourcePathsExposed": False, "remoteImagesExposed": True},
    }


def _build_product_management_pages(
    connection: duckdb.DuckDBPyConnection,
    start: str | None = None,
    end: str | None = None,
    statuses: list[str] | None = None,
    channels: list[str] | None = None,
    store_short_names: list[str] | None = None,
) -> dict[str, Any]:
    """聚水潭商品数据看板聚合：商品级销量/毛利/退货 + 床垫类别/渠道交叉矩阵 + 趋势 + 月环比。

    用复刻 PBIX ``Table.Distinct`` 的 model 视图聚合。转换层保留订单唯一键，模型层再移除
    快照元数据后去重，既与 PBIX 的最终订单行集合一致，也不会折叠不同订单。
    start/end（YYYY-MM-DD）为切片器日期范围；statuses、channels、store_short_names 为
    订单状态、渠道平台、店铺简称的多选切片器值（IN 过滤）。传入任一后创建临时过滤视图，
    所有聚合自动联动；可选项始终取自未过滤 base_view。
    """
    try:
        base_view = _model_view(connection, "15-聚水潭商品数据")
    except ValueError:
        return {
            "source": "jushuitan_local_logic",
            "period": None,
            "kpis": {},
            "productOverview": [],
            "productNameOverview": [],
            "dailyTrend": [],
            "monthlyTrend": [],
            "storeBreakdown": [],
            "channelBreakdown": [],
            "darenBreakdown": [],
            "categoryBreakdown": [],
            "mattressCategoryBreakdown": [],
            "returnRanking": [],
            "returnChannelBreakdown": [],
            "returnStoreBreakdown": [],
            "returnDarenBreakdown": [],
            "returnCategoryBreakdown": [],
            "fulfillmentByProduct": [],
            "monthlyComparison": None,
            "categoryChannelMatrix": {"columns": [], "rows": []},
            "warehouseStatusMatrix": {"columns": [], "rows": []},
            "dailyChannelMatrix": {"columns": [], "rows": []},
            "dailyStatusMatrix": {"columns": [], "rows": []},
            "productChannelMatrix": {"columns": [], "rows": []},
            "productStatusMatrix": {"columns": [], "rows": []},
            "availableStatuses": [],
            "availableChannels": [],
            "availableStoreShortNames": [],
            "privacy": {"rawRowsExposed": False, "sourcePathsExposed": False},
            "priceStructure": empty_price_structure(),
            "sizeStructure": empty_size_structure(),
            "spuSalesTrend": empty_spu_sales_trend(),
            "customizationStructure": empty_customization_structure(),
        }

    # 可选切片器值始终取自未过滤 base_view，避免联动后把其余可选项隐藏。
    import re as _re

    source_columns = {row[0] for row in connection.execute(f"DESCRIBE {base_view}").fetchall()}
    store_short_column = "店铺简称" if "店铺简称" in source_columns else "店铺" if "店铺" in source_columns else None

    def _dimension_expression(column: str) -> str:
        return f"coalesce(nullif(trim(cast(\"{column}\" AS VARCHAR)), ''), '(未设定)')"

    def _available_dimension_values(column: str | None) -> list[str]:
        if not column:
            return []
        return [
            str(row[0])
            for row in connection.execute(
                f"SELECT DISTINCT {_dimension_expression(column)} FROM {base_view} ORDER BY 1"
            ).fetchall()
            if row[0]
        ]

    def _in_filter(column: str, values: list[str]) -> str | None:
        escaped = ",".join("'" + value.replace("'", "''") + "'" for value in values if value)
        return f"{_dimension_expression(column)} IN ({escaped})" if escaped else None

    available_statuses = [
        row[0]
        for row in connection.execute(
            f'SELECT DISTINCT "订单状态明细" FROM {base_view} WHERE "订单状态明细" IS NOT NULL ORDER BY 1'
        ).fetchall()
        if row[0]
    ]
    available_channels = _available_dimension_values("渠道平台" if "渠道平台" in source_columns else None)
    available_store_short_names = _available_dimension_values(store_short_column)

    # 切片器过滤：日期范围 + 订单状态 + 渠道平台 + 店铺简称，创建临时视图替换 base_view。
    date_filter = None
    conds: list[str] = []
    if start and end and _re.fullmatch(r"\d{4}-\d{2}-\d{2}", start) and _re.fullmatch(r"\d{4}-\d{2}-\d{2}", end):
        conds.append(f'"订单日期" >= DATE \'{start}\' AND "订单日期" <= DATE \'{end}\'')
        date_filter = (start, end)
    if statuses:
        escaped = ",".join("'" + s.replace("'", "''") + "'" for s in statuses if s)
        if escaped:
            conds.append(f'"订单状态明细" IN ({escaped})')
    if channels and "渠道平台" in source_columns:
        channel_filter = _in_filter("渠道平台", channels)
        if channel_filter:
            conds.append(channel_filter)
    if store_short_names and store_short_column:
        store_filter = _in_filter(store_short_column, store_short_names)
        if store_filter:
            conds.append(store_filter)
    if conds:
        connection.execute(
            f'CREATE OR REPLACE TEMP VIEW _jt_filtered AS SELECT * FROM {base_view} WHERE {" AND ".join(conds)}'
        )
        view = "_jt_filtered"
    else:
        view = base_view

    if date_filter:
        period = (start, end)
    else:
        period = connection.execute(
            f'SELECT min("订单日期"), max("订单日期") FROM {view} WHERE "订单日期" IS NOT NULL'
        ).fetchone()

    # 产品主表（提供产品名称、成本、床垫类别），join 聚水潭计算毛利率与各产品分析。
    try:
        pm_view = _model_view(connection, "product-master")
        has_master = True
    except ValueError:
        pm_view = None
        has_master = False

    master_columns = (
        {row[0] for row in connection.execute(f"DESCRIBE {pm_view}").fetchall()}
        if has_master and pm_view
        else set()
    )
    # 辅4-床垫编码（q18）提供 SPU/尺寸/厚度/是否折叠等富维度，仅作 supplemental join。
    try:
        q18_view = _model_view(connection, "辅4-床垫编码")
        q18_columns = {row[0] for row in connection.execute(f"DESCRIBE {q18_view}").fetchall()}
    except ValueError:
        q18_view = None
        q18_columns = set()
    jd_master_view = _source_view(connection, "product-master") if has_master else None
    jd_master_columns = (
        {row[0] for row in connection.execute(f"DESCRIBE {jd_master_view}").fetchall()}
        if jd_master_view
        else set()
    )
    pm_join = f"LEFT JOIN {pm_view} pm ON s.\"商品编码\" = pm.\"商品编码\"" if has_master else ""
    # PBIX 对京东自营先以“店铺商品编码 → 商品ID”找回商家规编，再关联产品主数据。
    # 用未按商品编码去重的自营源映射保留全部 商品ID，直接补一条唯一产品名称映射，避免订单行放大。
    has_jd_self_mapping = (
        has_master
        and {"商品ID", "产品名称"}.issubset(jd_master_columns)
        and {"店铺", "店铺商品编码"}.issubset(source_columns)
    )
    if has_jd_self_mapping:
        jd_source_filter = (
            "AND cast(\"_source_path\" AS VARCHAR) LIKE '%自营商品表.xlsx'"
            if "_source_path" in jd_master_columns
            else ""
        )
        pm_join += f"""
        LEFT JOIN (
          SELECT cast("商品ID" AS VARCHAR) AS product_id,
                 any_value(nullif(trim(cast("产品名称" AS VARCHAR)), '')) AS product_name
          FROM {jd_master_view}
          WHERE "商品ID" IS NOT NULL AND trim(cast("商品ID" AS VARCHAR)) <> ''
            {jd_source_filter}
          GROUP BY 1
        ) jd_pm
          ON s."店铺" = '麻大师床垫京东自营旗舰店-龚敢-京5'
         AND cast(s."店铺商品编码" AS VARCHAR) = jd_pm.product_id
        """

    def _nonempty_text(alias: str, column: str) -> str:
        return f"nullif(trim(cast({alias}.\"{column}\" AS VARCHAR)), '')"

    source_product_name_parts = [
        _nonempty_text("s", column)
        for column in ("产品名称", "商品简称", "线上商品名")
        if column in source_columns
    ]
    source_product_name = (
        f"coalesce({', '.join(source_product_name_parts)}, '(未命名)')"
        if source_product_name_parts
        else "'(未命名)'"
    )
    master_product_name_parts = (
        [_nonempty_text("pm", "产品名称")]
        if "产品名称" in master_columns
        else []
    )
    if has_jd_self_mapping:
        master_product_name_parts.append("jd_pm.product_name")
    product_name_expr = (
        f"coalesce({', '.join(master_product_name_parts)}, {source_product_name})"
        if master_product_name_parts
        else source_product_name
    )
    order_id_parts = [
        _nonempty_text("s", column)
        for column in ("线上订单号", "内部订单号", "线上子订单编号")
        if column in source_columns
    ]
    order_id_expr = (
        order_id_parts[0]
        if len(order_id_parts) == 1
        else f"coalesce({', '.join(order_id_parts)})"
        if order_id_parts
        else "NULL"
    )
    order_date_expr = 'try_cast(s."订单日期" AS DATE)' if "订单日期" in source_columns else "CAST(NULL AS DATE)"
    ship_date_expr = 'try_cast(s."发货日期" AS DATE)' if "发货日期" in source_columns else "CAST(NULL AS DATE)"
    channel_expr = (
        f"coalesce({_nonempty_text('s', '渠道平台')}, '(未设定)')"
        if "渠道平台" in source_columns
        else "'(未设定)'"
    )
    store_short_expr = (
        f"coalesce({_nonempty_text('s', '店铺简称')}, '(未设定)')"
        if "店铺简称" in source_columns
        else (
            f"coalesce({_nonempty_text('s', '店铺')}, '(未设定)')"
            if "店铺" in source_columns
            else "'(未设定)'"
        )
    )

    # 毛利：毛利额 = 商家实收 - 成本 × 销售数量（与 PBIX 15 查询口径一致）。
    gross_profit = 0.0
    matched_received = 0.0
    matched_codes = 0
    if has_master:
        margin = connection.execute(
            f"""
            SELECT
              sum(CASE WHEN pm."成本" IS NOT NULL
                       THEN coalesce(try_cast(s."商家实收" AS DOUBLE),0)
                            - coalesce(try_cast(pm."成本" AS DOUBLE),0) * coalesce(try_cast(s."销售数量" AS DOUBLE),0)
                       ELSE 0 END) AS gross_profit,
              sum(CASE WHEN pm."成本" IS NOT NULL THEN coalesce(try_cast(s."商家实收" AS DOUBLE),0) ELSE 0 END) AS matched_received,
              count(DISTINCT CASE WHEN pm."成本" IS NOT NULL THEN s."商品编码" END) AS matched_codes
            FROM {view} s LEFT JOIN {pm_view} pm ON s."商品编码" = pm."商品编码"
            """
        ).fetchone()
        gross_profit = float(margin[0] or 0)
        matched_received = float(margin[1] or 0)
        matched_codes = int(margin[2] or 0)

    def _total(column: str) -> float:
        return float(
            connection.execute(
                f'SELECT sum(coalesce(try_cast("{column}" AS DOUBLE), 0)) FROM {view}'
            ).fetchone()[0]
            or 0
        )

    total_sales = _total("销售金额")
    total_refund = _total("退货金额")
    total_received = _total("商家实收")
    total_sales_units = _total("销售数量")
    product_count = connection.execute(
        f'SELECT count(DISTINCT "商品编码") FROM {view} WHERE "商品编码" IS NOT NULL'
    ).fetchone()[0] or 0
    order_lines = connection.execute(f"SELECT count(*) FROM {view}").fetchone()[0] or 0
    # 商品管理统一使用商家实收作为金额口径；回款率 = 商家实收 / 销售金额。
    # 0.01 链接、礼品袋等已在转换层按 PBIX M 规则置零并过滤，销售数量可安全用于销量口径。
    kpis = {
        "productCount": int(product_count),
        "orderLines": int(order_lines),
        "totalSalesAmount": total_sales,
        "totalNetSales": total_sales - total_refund,  # 销售减退金额（参考看板口径，≈商家实收）
        "collectionRate": round(total_received / total_sales, 4) if total_sales else None,
        "totalRefundAmount": total_refund,
        "refundRate": round(total_refund / total_received, 4) if total_received else None,
        "totalSalesUnits": total_sales_units,
        "avgUnitPrice": round(total_received / total_sales_units, 2) if total_sales_units else None,  # 件单价 = 商家实收/销售数量
        "totalPaidAmount": _total("买家实付"),
        "totalReceivedAmount": total_received,
        "totalSubsidyAmount": _total("平台补贴金额"),
        "totalGrossProfit": gross_profit if has_master else None,
        "grossMargin": round(gross_profit / matched_received, 4) if has_master and matched_received else None,
        "matchedProductCount": matched_codes if has_master else None,
    }

    product_overview = _records(
        connection,
        f"""
        SELECT s."商品编码" AS productCode,
               any_value({product_name_expr}) AS productName,
               any_value(s."产品分类") AS category,
               any_value(s."品牌") AS brand,
               sum(coalesce(try_cast(s."销售数量" AS DOUBLE),0)) AS salesUnits,
               sum(coalesce(try_cast(s."商家实收" AS DOUBLE),0)) AS receivedAmount,
               sum(coalesce(try_cast(s."销售金额" AS DOUBLE),0)) AS salesAmount,
               sum(coalesce(try_cast(s."退货金额" AS DOUBLE),0)) AS refundAmount,
               count(*) AS orderLines
        FROM {view} s {pm_join}
        WHERE s."商品编码" IS NOT NULL
        GROUP BY 1 ORDER BY receivedAmount DESC NULLS LAST LIMIT 500000
        """,
    )
    for row in product_overview:
        sales = row.get("salesAmount") or 0
        received = row.get("receivedAmount") or 0
        row["collectionRate"] = round(received / sales, 4) if sales else None
        row["refundRate"] = round(row["refundAmount"] / received, 4) if received else None

    daily_trend = _records(
        connection,
        f"""
        SELECT "订单日期" AS date,
               sum(coalesce(try_cast("商家实收" AS DOUBLE),0)) AS receivedAmount,
               sum(coalesce(try_cast("销售数量" AS DOUBLE),0)) AS salesUnits,
               sum(coalesce(try_cast("销售金额" AS DOUBLE),0)) AS salesAmount,
               sum(coalesce(try_cast("退货金额" AS DOUBLE),0)) AS refundAmount,
               count(*) AS orderLines
        FROM {view}
        WHERE "订单日期" IS NOT NULL
          AND "订单日期" >= (SELECT max("订单日期") - INTERVAL 400 DAY FROM {view})
        GROUP BY 1 ORDER BY 1
        """,
    )

    store_breakdown = _records(
        connection,
        f"""
        SELECT {store_short_expr} AS store,
               sum(coalesce(try_cast("商家实收" AS DOUBLE),0)) AS receivedAmount,
               sum(coalesce(try_cast("销售数量" AS DOUBLE),0)) AS salesUnits,
               sum(coalesce(try_cast("销售金额" AS DOUBLE),0)) AS salesAmount,
               sum(coalesce(try_cast("退货金额" AS DOUBLE),0)) AS refundAmount,
               count(*) AS orderLines
        FROM {view} s
        GROUP BY 1 ORDER BY receivedAmount DESC NULLS LAST LIMIT 5000
        """,
    )

    daren_breakdown = _records(
        connection,
        f"""
        SELECT "达人名称" AS daren,
               sum(coalesce(try_cast("商家实收" AS DOUBLE),0)) AS receivedAmount,
               sum(coalesce(try_cast("销售数量" AS DOUBLE),0)) AS salesUnits,
               sum(coalesce(try_cast("销售金额" AS DOUBLE),0)) AS salesAmount,
               count(*) AS orderLines
        FROM {view}
        WHERE "达人名称" IS NOT NULL AND trim(cast("达人名称" AS VARCHAR)) <> ''
        GROUP BY 1 ORDER BY receivedAmount DESC NULLS LAST LIMIT 5000
        """,
    )

    category_breakdown = _records(
        connection,
        f"""
        SELECT "产品分类" AS category,
               sum(coalesce(try_cast("商家实收" AS DOUBLE),0)) AS receivedAmount,
               sum(coalesce(try_cast("销售数量" AS DOUBLE),0)) AS salesUnits,
               sum(coalesce(try_cast("销售金额" AS DOUBLE),0)) AS salesAmount,
               sum(coalesce(try_cast("退货金额" AS DOUBLE),0)) AS refundAmount,
               count(*) AS orderLines
        FROM {view}
        WHERE "产品分类" IS NOT NULL AND trim(cast("产品分类" AS VARCHAR)) <> ''
        GROUP BY 1 ORDER BY receivedAmount DESC NULLS LAST LIMIT 5000
        """,
    )

    return_ranking = _records(
        connection,
        f"""
        SELECT s."商品编码" AS productCode,
               any_value({product_name_expr}) AS productName,
               sum(coalesce(try_cast(s."退货数量" AS DOUBLE),0)) AS refundUnits,
               sum(coalesce(try_cast(s."退货金额" AS DOUBLE),0)) AS refundAmount,
               sum(coalesce(try_cast(s."商家实收" AS DOUBLE),0)) AS receivedAmount,
               sum(CASE WHEN cast(s."订单状态明细" AS VARCHAR) LIKE '%交易关闭%' THEN 1 ELSE 0 END) AS refundOrderCount,
               count(*) AS orderLines
        FROM {view} s {pm_join}
        WHERE s."商品编码" IS NOT NULL
        GROUP BY 1 ORDER BY refundAmount DESC NULLS LAST LIMIT 5000
        """,
    )
    for row in return_ranking:
        received = row.get("receivedAmount") or 0
        order_lines = row.get("orderLines") or 0
        row["refundRate"] = round(row["refundAmount"] / received, 4) if received else None
        row["refundOrderShare"] = round(row["refundOrderCount"] / order_lines, 4) if order_lines else None

    # 退货维度拆分：渠道/店铺/达人/床垫类别。退款订单 = 订单状态明细含「交易关闭」
    # （仅退款 + 退货退款两个子类，合计贡献 100% 退货金额）。
    # 退货率 = 退货金额/商家实收；退款订单占比 = 交易关闭订单数/订单行。
    def _return_breakdown(dim_expr: str, where: str, join: str = "", limit: int = 50) -> list[dict]:
        rows = _records(
            connection,
            f"""
            SELECT {dim_expr} AS dim,
                   sum(coalesce(try_cast(s."退货金额" AS DOUBLE),0)) AS refundAmount,
                   sum(coalesce(try_cast(s."退货数量" AS DOUBLE),0)) AS refundUnits,
                   sum(CASE WHEN cast(s."订单状态明细" AS VARCHAR) LIKE '%交易关闭%' THEN 1 ELSE 0 END) AS refundOrderCount,
                   sum(coalesce(try_cast(s."商家实收" AS DOUBLE),0)) AS receivedAmount,
                   count(*) AS orderLines
            FROM {view} s {join}
            WHERE {where}
            GROUP BY 1 ORDER BY refundAmount DESC NULLS LAST LIMIT {limit}
            """,
        )
        for row in rows:
            received = row.get("receivedAmount") or 0
            order_lines = row.get("orderLines") or 0
            row["refundRate"] = round(row["refundAmount"] / received, 4) if received else None
            row["refundOrderShare"] = round(row["refundOrderCount"] / order_lines, 4) if order_lines else None
        return rows

    daren_dim_expr = f"coalesce({_nonempty_text('s', '达人名称')}, '(无达人)')"
    category_dim_expr = f"coalesce({_nonempty_text('pm', '床垫类别')}, '(未分类)')"
    return_channel_breakdown = _return_breakdown(channel_expr, "TRUE", "")
    return_store_breakdown = _return_breakdown(store_short_expr, "TRUE", "")
    return_daren_breakdown = _return_breakdown(
        daren_dim_expr,
        "s.\"达人名称\" IS NOT NULL AND trim(cast(s.\"达人名称\" AS VARCHAR)) <> ''",
        "",
    )
    return_category_breakdown = _return_breakdown(
        category_dim_expr,
        "pm.\"床垫类别\" IS NOT NULL AND trim(cast(pm.\"床垫类别\" AS VARCHAR)) <> ''",
        pm_join,
    ) if has_master else []

    # 仓配履约：同一产品名称内按订单去重，时效为发货日期 - 订单日期的自然日差。
    # 第 N 天为日期差恰好 N 天；15 天内为 0～15 天累计。订单量为全部订单分母，
    # 平均时效仅计算有有效发货日期的订单，未发货订单不会被误记为 0 天。
    fulfillment_by_product = _records(
        connection,
        f"""
        WITH product_orders AS (
          SELECT
            {product_name_expr} AS productName,
            {order_id_expr} AS orderId,
            min({order_date_expr}) AS orderDate,
            min({ship_date_expr}) AS shipDate
          FROM {view} s {pm_join}
          WHERE {product_name_expr} <> '(未命名)'
            AND {order_id_expr} IS NOT NULL
          GROUP BY 1, 2
        ), shipping_durations AS (
          SELECT
            productName,
            CASE WHEN shipDate >= orderDate THEN datediff('day', orderDate, shipDate) END AS shippingDays
          FROM product_orders
        )
        SELECT
          productName,
          count(*) AS orderCount,
          count(shippingDays) AS shippedOrderCount,
          round(avg(shippingDays), 2) AS avgShippingDays,
          cast(sum(CASE WHEN shippingDays = 3 THEN 1 ELSE 0 END) AS DOUBLE) / count(*) AS day3Share,
          cast(sum(CASE WHEN shippingDays = 5 THEN 1 ELSE 0 END) AS DOUBLE) / count(*) AS day5Share,
          cast(sum(CASE WHEN shippingDays = 7 THEN 1 ELSE 0 END) AS DOUBLE) / count(*) AS day7Share,
          cast(sum(CASE WHEN shippingDays = 10 THEN 1 ELSE 0 END) AS DOUBLE) / count(*) AS day10Share,
          cast(sum(CASE WHEN shippingDays BETWEEN 0 AND 15 THEN 1 ELSE 0 END) AS DOUBLE) / count(*) AS within15DayShare
        FROM shipping_durations
        GROUP BY 1
        ORDER BY orderCount DESC, avgShippingDays DESC NULLS LAST, productName
        LIMIT 5000
        """,
    )

    # 单品明细分析表按产品主数据的产品名称聚合；未匹配时才回退到订单商品简称。
    margin_select = (
        "sum(CASE WHEN pm.\"成本\" IS NOT NULL THEN coalesce(try_cast(s.\"商家实收\" AS DOUBLE),0) "
        "- coalesce(try_cast(pm.\"成本\" AS DOUBLE),0)*coalesce(try_cast(s.\"销售数量\" AS DOUBLE),0) ELSE 0 END) AS grossProfit, "
        "sum(CASE WHEN pm.\"成本\" IS NOT NULL THEN coalesce(try_cast(s.\"商家实收\" AS DOUBLE),0) ELSE 0 END) AS matchedReceived, "
        if has_master else "0 AS grossProfit, 0 AS matchedReceived, "
    )
    product_name_overview = _records(
        connection,
        f"""
        SELECT {product_name_expr} AS productName,
               any_value(s."产品分类") AS category,
               sum(coalesce(try_cast(s."销售数量" AS DOUBLE),0)) AS salesUnits,
               sum(coalesce(try_cast(s."销售金额" AS DOUBLE),0)) AS salesAmount,
               sum(coalesce(try_cast(s."退货金额" AS DOUBLE),0)) AS refundAmount,
               sum(coalesce(try_cast(s."商家实收" AS DOUBLE),0)) AS receivedAmount,
               {margin_select}
               count(*) AS orderLines
        FROM {view} s {pm_join}
        WHERE {product_name_expr} <> '(未命名)'
        GROUP BY 1 ORDER BY receivedAmount DESC NULLS LAST LIMIT 500000
        """,
    )
    name_total = sum((row.get("receivedAmount") or 0) for row in product_name_overview) or 1
    for row in product_name_overview:
        units = row.get("salesUnits") or 0
        received = row.get("receivedAmount") or 0
        matched = row.get("matchedReceived") or 0
        row["amountShare"] = round(received / name_total, 4)
        row["avgUnitPrice"] = round(row["receivedAmount"] / units, 2) if units else None  # 件单件
        row["refundRate"] = round(row["refundAmount"] / received, 4) if received else None
        row["grossMargin"] = round(row["grossProfit"] / matched, 4) if matched else None  # 毛利率

    # 渠道销售明细表直接使用 PBIX 从商店站点标准化后的渠道平台。
    channel_breakdown = _records(
        connection,
        f"""
        SELECT
          {channel_expr} AS channel,
          sum(coalesce(try_cast(s."销售数量" AS DOUBLE),0)) AS salesUnits,
          sum(coalesce(try_cast(s."商家实收" AS DOUBLE),0)) AS receivedAmount,
          sum(coalesce(try_cast(s."退货金额" AS DOUBLE),0)) AS refundAmount,
          {margin_select}
          count(*) AS orderLines
        FROM {view} s {pm_join}
        GROUP BY 1 ORDER BY receivedAmount DESC NULLS LAST
        """,
    )
    channel_total = sum((row.get("receivedAmount") or 0) for row in channel_breakdown) or 1
    for row in channel_breakdown:
        units = row.get("salesUnits") or 0
        matched = row.get("matchedReceived") or 0
        row["amountShare"] = round(row["receivedAmount"] / channel_total, 4)
        row["avgUnitPrice"] = round(row["receivedAmount"] / units, 2) if units else None
        row["refundRate"] = round(row["refundAmount"] / (row.get("receivedAmount") or 0), 4) if row.get("receivedAmount") else None
        row["grossMargin"] = round(row["grossProfit"] / matched, 4) if matched else None

    # 月度趋势（对齐参考看板「月度销售额趋势」）
    monthly_trend = _records(
        connection,
        f"""
        SELECT strftime('%Y-%m', "订单日期") AS month,
               sum(coalesce(try_cast("商家实收" AS DOUBLE),0)) AS receivedAmount,
               sum(coalesce(try_cast("销售数量" AS DOUBLE),0)) AS salesUnits,
               sum(coalesce(try_cast("销售金额" AS DOUBLE),0)) AS salesAmount,
               sum(coalesce(try_cast("退货金额" AS DOUBLE),0)) AS refundAmount,
               count(*) AS orderLines
        FROM {view} WHERE "订单日期" IS NOT NULL
        GROUP BY 1 ORDER BY 1
        """,
    )

    # 床垫类别销售分析表（join 产品主表，对齐参考看板「床垫类别销售分析表」）
    if has_master:
        mattress_category_breakdown = _records(
            connection,
            f"""
            SELECT pm."床垫类别" AS category,
                   sum(coalesce(try_cast(s."商家实收" AS DOUBLE),0)) AS receivedAmount,
                   sum(coalesce(try_cast(s."销售数量" AS DOUBLE),0)) AS salesUnits,
                   sum(coalesce(try_cast(s."销售金额" AS DOUBLE),0)) AS salesAmount,
                   sum(coalesce(try_cast(s."退货金额" AS DOUBLE),0)) AS refundAmount,
                   {margin_select}
                   count(*) AS orderLines
            FROM {view} s {pm_join}
            WHERE pm."床垫类别" IS NOT NULL AND trim(cast(pm."床垫类别" AS VARCHAR)) <> ''
            GROUP BY 1 ORDER BY receivedAmount DESC NULLS LAST
            """,
        )
        cat_total = sum((row.get("receivedAmount") or 0) for row in mattress_category_breakdown) or 1
        for row in mattress_category_breakdown:
            matched = row.get("matchedReceived") or 0
            received = row.get("receivedAmount") or 0
            row["amountShare"] = round(received / cat_total, 4)
            row["refundRate"] = round(row["refundAmount"] / received, 4) if received else None
            row["grossMargin"] = round(row["grossProfit"] / matched, 4) if matched else None
    else:
        mattress_category_breakdown = []

    # 月环比（对齐参考看板「整体经营总览」：本月 vs 上月）
    months = connection.execute(
        f"""SELECT strftime('%Y-%m', "订单日期") AS month FROM {view}
           WHERE "订单日期" IS NOT NULL GROUP BY 1 ORDER BY 1 DESC LIMIT 2"""
    ).fetchall()
    monthly_comparison = None
    if len(months) >= 1:
        cur_m, prev_m = months[0][0], (months[1][0] if len(months) >= 2 else None)

        def _month_totals(month: str | None) -> dict[str, Any]:
            if not month:
                return {}
            row = connection.execute(
                f"""
                SELECT
                  sum(coalesce(try_cast(s."商家实收" AS DOUBLE),0)) AS receivedAmount,
                  sum(coalesce(try_cast(s."销售金额" AS DOUBLE),0)) AS salesAmount,
                  sum(coalesce(try_cast(s."退货金额" AS DOUBLE),0)) AS refundAmount,
                  count(*) AS orderLines
                FROM {view} s WHERE strftime('%Y-%m', s."订单日期") = ?
                """,
                [month],
            ).fetchone()
            return {"receivedAmount": float(row[0] or 0), "salesAmount": float(row[1] or 0),
                    "refundAmount": float(row[2] or 0), "orderLines": int(row[3] or 0)}

        cur = _month_totals(cur_m)
        prev = _month_totals(prev_m)
        if cur:
            def _delta(key: str) -> float | None:
                if not prev or not prev.get(key) or prev[key] == 0:
                    return None
                return round((cur[key] - prev[key]) / prev[key], 4)
            monthly_comparison = {
                "currentMonth": cur_m, "previousMonth": prev_m,
                "current": cur, "previous": prev,
                "deltas": {k: _delta(k) for k in cur},
            }

    # 交叉矩阵统一使用已清洗的销售数量。
    if has_master:
        category_channel_matrix = _matrix(
            connection,
            f"""
            PIVOT (
              SELECT pm."床垫类别" AS row, {channel_expr} AS channel,
                     coalesce(try_cast(s."销售数量" AS DOUBLE),0) AS units
              FROM {view} s {pm_join}
              WHERE pm."床垫类别" IS NOT NULL AND trim(cast(pm."床垫类别" AS VARCHAR)) <> ''
            ) ON channel USING sum(units) ORDER BY row
            """,
            "row",
        )
    else:
        category_channel_matrix = {"columns": [], "rows": []}

    warehouse_status_matrix = _matrix(
        connection,
        f"""
        PIVOT (
          SELECT coalesce(cast(s."发货仓" AS VARCHAR), '(未设定)') AS row,
                 coalesce(cast(s."订单状态明细" AS VARCHAR), '(未知)') AS status,
                 coalesce(try_cast(s."销售数量" AS DOUBLE),0) AS units
          FROM {view} s
          WHERE s."发货仓" IS NOT NULL OR s."订单状态" IS NOT NULL
        ) ON status USING sum(units) ORDER BY row
        """,
        "row",
    )

    daily_window = "" if date_filter else f"AND s.\"订单日期\" >= (SELECT max(\"订单日期\") - INTERVAL 30 DAY FROM {view})"
    daily_channel_matrix = _matrix(
        connection,
        f"""
        PIVOT (
          SELECT cast(s."订单日期" AS VARCHAR) AS row, {channel_expr} AS channel,
                 coalesce(try_cast(s."销售数量" AS DOUBLE),0) AS units
          FROM {view} s
          WHERE s."订单日期" IS NOT NULL
            {daily_window}
        ) ON channel USING sum(units) ORDER BY row
        """,
        "row",
    )

    # 每日订单状态分布（对齐参考看板「每天订单状态分布」）
    daily_status_matrix = _matrix(
        connection,
        f"""
        PIVOT (
          SELECT cast(s."订单日期" AS VARCHAR) AS row,
                 coalesce(cast(s."订单状态明细" AS VARCHAR), '(未知)') AS status,
                 coalesce(try_cast(s."销售数量" AS DOUBLE),0) AS units
          FROM {view} s
          WHERE s."订单日期" IS NOT NULL
            {daily_window}
        ) ON status USING sum(units) ORDER BY row
        """,
        "row",
    )

    # 产品名称 × 渠道销量（产品主数据口径，Top 30）
    product_channel_matrix = _matrix(
        connection,
        f"""
        PIVOT (
          SELECT {product_name_expr} AS row, {channel_expr} AS channel,
                 coalesce(try_cast(s."销售数量" AS DOUBLE),0) AS units
          FROM {view} s {pm_join}
          WHERE {product_name_expr} IN (
            SELECT {product_name_expr} FROM {view} s {pm_join}
            WHERE {product_name_expr} <> '(未命名)'
            GROUP BY 1 ORDER BY sum(coalesce(try_cast("销售数量" AS DOUBLE),0)) DESC LIMIT 30
          )
        ) ON channel USING sum(units) ORDER BY row
        """,
        "row",
    )

    # 产品名称 × 订单状态（产品主数据口径，Top 30）
    product_status_matrix = _matrix(
        connection,
        f"""
        PIVOT (
          SELECT {product_name_expr} AS row,
                 coalesce(cast(s."订单状态明细" AS VARCHAR), '(未知)') AS status,
                 coalesce(try_cast(s."销售数量" AS DOUBLE),0) AS units
          FROM {view} s {pm_join}
          WHERE {product_name_expr} IN (
            SELECT {product_name_expr} FROM {view} s {pm_join}
            WHERE {product_name_expr} <> '(未命名)'
            GROUP BY 1 ORDER BY sum(coalesce(try_cast("销售数量" AS DOUBLE),0)) DESC LIMIT 30
          )
        ) ON status USING sum(units) ORDER BY row
        """,
        "row",
    )

    return {
        "source": "jushuitan_local_logic",
        "period": {"start": period[0], "end": period[1]} if period and period[0] else None,
        "kpis": kpis,
        "productOverview": product_overview,
        "productNameOverview": product_name_overview,
        "dailyTrend": daily_trend,
        "monthlyTrend": monthly_trend,
        "storeBreakdown": store_breakdown,
        "channelBreakdown": channel_breakdown,
        "darenBreakdown": daren_breakdown,
        "categoryBreakdown": category_breakdown,
        "mattressCategoryBreakdown": mattress_category_breakdown,
        "returnRanking": return_ranking,
        "returnChannelBreakdown": return_channel_breakdown,
        "returnStoreBreakdown": return_store_breakdown,
        "returnDarenBreakdown": return_daren_breakdown,
        "returnCategoryBreakdown": return_category_breakdown,
        "fulfillmentByProduct": fulfillment_by_product,
        "monthlyComparison": monthly_comparison,
        "categoryChannelMatrix": category_channel_matrix,
        "warehouseStatusMatrix": warehouse_status_matrix,
        "dailyChannelMatrix": daily_channel_matrix,
        "dailyStatusMatrix": daily_status_matrix,
        "productChannelMatrix": product_channel_matrix,
        "productStatusMatrix": product_status_matrix,
        "availableStatuses": available_statuses,
        "availableChannels": available_channels,
        "availableStoreShortNames": available_store_short_names,
        "privacy": {"rawRowsExposed": False, "sourcePathsExposed": False},
        **build_product_structure_modules(
            connection, view, base_view, pm_view if has_master else None, master_columns,
            q18_view, q18_columns
        ),
    }


def _build_unique_snapshot(
    connection: duckdb.DuckDBPyConnection,
    paths: WarehousePaths,
    query_results: list[dict[str, Any]],
) -> dict[str, Any]:
    failures = sum(item.get("failed", 0) for item in query_results)
    rows = sum(int(item.get("rows", 0)) for item in query_results)
    result_by_query = {item["query"]: item for item in query_results}
    powerbi_pages = _build_powerbi_pages(connection, _load_pbix_store_rank_daily(paths))
    product_management_pages = _build_product_management_pages(connection)
    snapshot = {
        "source": "local_warehouse",
        "scope": "powerbi_unique_only",
        "engine": {"transform": "Polars", "storage": "Parquet", "query": "DuckDB"},
        "refreshedAt": datetime.now().astimezone().isoformat(),
        "period": None,
        "totals": {},
        "daily": [],
        "platforms": [],
        "stores": [],
        "uniqueDomains": unique_domain_catalog(result_by_query),
        "powerbiPages": powerbi_pages,
        "productManagement": product_management_pages,
        "recordCount": rows,
        "overlapPolicy": {
            "authority": "dingtalk",
            "excludedQueries": [
                {"query": name, **policy} for name, policy in DINGTALK_COVERED_QUERIES.items()
            ],
            "partialOverlap": [
                {"query": name, **policy} for name, policy in PARTIAL_OVERLAP_QUERIES.items()
            ],
        },
        "quality": {
            "status": "empty" if rows == 0 else "healthy" if failures == 0 else "partial",
            "queryCount": len(query_results),
            "excludedQueryCount": len(DINGTALK_COVERED_QUERIES),
            "failedFiles": failures,
            "queries": query_results,
        },
        "privacy": {
            "webExposure": "domain_inventory_only",
            "rawCustomerServiceRowsExposed": False,
            "sourcePathsExposed": False,
        },
    }
    _write_json_atomic(paths.snapshot, snapshot)
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS analytics_snapshots (
          refreshed_at TIMESTAMPTZ,
          period_start DATE,
          period_end DATE,
          record_count BIGINT,
          snapshot_json JSON
        )
        """
    )
    connection.execute(
        "INSERT INTO analytics_snapshots VALUES (current_timestamp, ?, ?, ?, ?)",
        [None, None, rows, json.dumps(snapshot, ensure_ascii=False, default=_json_value)],
    )
    return snapshot


def _write_migration_status(
    paths: WarehousePaths,
    results: list[dict[str, Any]],
    excluded_specs: list[QuerySpec],
) -> dict[str, Any]:
    output_root = paths.project_root / "migration" / "power-query-m"
    output_root.mkdir(parents=True, exist_ok=True)
    rows = []
    completed = 0
    for item in results:
        is_complete = item["files"] == item["activePartitions"] and item["failed"] == 0
        if is_complete:
            completed += 1
        rows.append(
            {
                "query": item["query"],
                "files": item["files"],
                "partitions": item["activePartitions"],
                "rows": item["rows"],
                "failedFiles": item["failed"],
                "status": "migrated" if is_complete else "partial",
            }
        )
    payload = {
        "generatedAt": datetime.now().astimezone().isoformat(),
        "queryCount": len(rows),
        "completedQueries": completed,
        "sourceFileCount": sum(item["files"] for item in rows),
        "parquetPartitionCount": sum(item["partitions"] for item in rows),
        "rowCount": sum(item["rows"] for item in rows),
        "scope": "powerbi_unique_only",
        "excludedQueryCount": len(excluded_specs),
        "excludedQueries": [
            {"query": spec.name, **DINGTALK_COVERED_QUERIES[spec.name]}
            for spec in excluded_specs
        ],
        "queries": rows,
    }
    _write_json_atomic(output_root / "migration-status.json", payload)
    table = "\n".join(
        f"| {item['query']} | {item['files']} | {item['partitions']} | {item['rows']} | {item['failedFiles']} | {'已迁移' if item['status'] == 'migrated' else '部分迁移'} |"
        for item in rows
    )
    excluded_table = "\n".join(
        f"| {spec.name} | {DINGTALK_COVERED_QUERIES[spec.name]['authority']} | {DINGTALK_COVERED_QUERIES[spec.name]['grain']} |"
        for spec in excluded_specs
    )
    report = f"""# Power Query 开源迁移状态

- 生成日期：{datetime.now().date().isoformat()}
- 查询完成：{completed}/{len(rows)}
- 源文件：{payload['sourceFileCount']}
- Parquet 分区：{payload['parquetPartitionCount']}
- 可查询行：{payload['rowCount']}

## M 到开源实现映射

| Power Query M | 本地实现 |
|---|---|
| `Folder.Files` / `File.Contents` | Python `pathlib` 增量文件发现与签名 |
| `Excel.Workbook` | Pandas + openpyxl/xlrd，兼容 XLSX、XLS 与 HTML 表格导出 |
| `Csv.Document` | Polars CSV 读取，GB18030 回退到 Pandas |
| `Table.PromoteHeaders` | 显式表头提升并隔离来源元数据列 |
| `Table.TransformColumnTypes` | Polars 严格列契约、数值、百分比和 Excel 日期转换 |
| `Table.SelectRows` / `RemoveColumns` / `RenameColumns` | Polars filter/drop/rename |
| `Table.Distinct` | 分区内 Polars unique + 模型视图 DuckDB DISTINCT |
| `Table.UnpivotOtherColumns` | Polars unpivot，用于渠道月目标 |
| `Table.Combine` | DuckDB `UNION ALL BY NAME` 复合模型视图 |
| `Table.FuzzyNestedJoin` | DuckDB Jaro-Winkler 相似度侧向连接 |

## 查询结果

| 查询 | 源文件 | Parquet | 行数 | 失败 | 状态 |
|---|---:|---:|---:|---:|---|
{table}

## 与钉钉重叠的排除项

| Power Query | 权威来源 | 重叠粒度 |
|---|---|---|
{excluded_table}

## 数据边界

- 钉钉负责全渠道日经营汇总和月度销售目标，本地同步不再复制这两个口径。
- 网站 API 当前只读取 `analytics-snapshot.json` 中的独有领域目录与质量摘要。
- 客服、商品和投放明细只保留在本机 Parquet/DuckDB，不通过前端接口返回。
- PBIX 和 Power BI Desktop 不再是网站同步依赖。
"""
    (output_root / "MIGRATION_STATUS.md").write_text(report, encoding="utf-8")
    return payload


def sync_warehouse(
    options: SyncOptions | None = None,
    progress: ProgressCallback | None = None,
) -> dict[str, Any]:
    options = options or SyncOptions()
    paths = WarehousePaths.discover()
    paths.ensure()
    manifest, specs = load_catalog(paths.manifest)
    if options.query_names:
        unknown = options.query_names - {spec.name for spec in specs}
        if unknown:
            raise ValueError(f"未知查询：{', '.join(sorted(unknown))}")
    active_specs, excluded_specs = select_sync_specs(specs)
    selected_specs, requested_exclusions = select_sync_specs(specs, options.query_names)

    state = _read_state(paths.state_file)
    results = []
    started = time.perf_counter()
    for spec in selected_specs:
        results.append(_sync_query(paths, spec, state, options, progress))
        state["updatedAt"] = datetime.now().astimezone().isoformat()
        _write_json_atomic(paths.state_file, state)

    cached_results = {item["query"]: item for item in results}
    for spec in active_specs:
        if spec.name in cached_results:
            continue
        active = [
            item
            for item in state["files"].values()
            if item.get("query") == spec.name and item.get("parquet") and Path(item["parquet"]).exists()
        ]
        cached_results[spec.name] = {
            "query": spec.name,
            "key": spec.key,
            "files": len(discover_files(spec.source_paths)),
            "activePartitions": len(active),
            "processed": 0,
            "reused": len(active),
            "failed": sum(1 for item in active if item.get("error")),
            "rows": sum(int(item.get("rows", 0)) for item in active),
            "columns": max((int(item.get("columns", 0)) for item in active), default=0),
            "errors": [],
            "durationSeconds": 0,
            "status": "cached" if active else "empty",
        }

    ordered_results = [cached_results[spec.name] for spec in active_specs]
    connection = duckdb.connect(str(paths.database))
    try:
        _deactivate_dingtalk_overlap(connection, paths, excluded_specs)
        _create_source_views(connection, paths, active_specs, cached_results)
        _create_composite_views(connection, active_specs)
        snapshot = _build_unique_snapshot(connection, paths, ordered_results)
    finally:
        connection.close()

    migration = _write_migration_status(paths, ordered_results, excluded_specs)
    summary = {
        "ok": snapshot.get("recordCount", 0) > 0,
        "manifestQueries": manifest["queryCount"],
        "selectedQueries": len(selected_specs),
        "activeQueries": len(active_specs),
        "excludedQueries": [spec.name for spec in excluded_specs],
        "requestedExclusions": [spec.name for spec in requested_exclusions],
        "processedFiles": sum(item["processed"] for item in results),
        "reusedFiles": sum(item["reused"] for item in results),
        "failedFiles": sum(item["failed"] for item in results),
        "factRows": snapshot.get("recordCount", 0),
        "period": snapshot.get("period"),
        "database": str(paths.database),
        "snapshot": str(paths.snapshot),
        "migration": {"completedQueries": migration["completedQueries"], "queryCount": migration["queryCount"]},
        "durationSeconds": round(time.perf_counter() - started, 3),
        "queries": results,
    }
    _emit(progress, {"event": "sync_finished", **{key: value for key, value in summary.items() if key != "queries"}})
    return summary


def warehouse_status() -> dict[str, Any]:
    paths = WarehousePaths.discover()
    state = _read_state(paths.state_file)
    snapshot = json.loads(paths.snapshot.read_text(encoding="utf-8")) if paths.snapshot.exists() else None
    active_files = [
        item for item in state["files"].values()
        if item.get("query") not in DINGTALK_COVERED_QUERIES
    ]
    return {
        "configured": paths.manifest.exists(),
        "databaseExists": paths.database.exists(),
        "snapshotExists": paths.snapshot.exists(),
        "partitionCount": sum(1 for item in active_files if item.get("parquet") and Path(item["parquet"]).exists()),
        "failedPartitionCount": sum(1 for item in active_files if item.get("error")),
        "updatedAt": state.get("updatedAt"),
        "snapshot": snapshot,
    }
