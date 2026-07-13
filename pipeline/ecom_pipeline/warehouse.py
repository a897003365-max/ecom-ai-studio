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


def _model_view(connection: duckdb.DuckDBPyConnection, query_name: str) -> str:
    row = connection.execute(
        "SELECT model_view FROM warehouse_query_catalog WHERE query_name = ?",
        [query_name],
    ).fetchone()
    if not row:
        raise ValueError(f"未找到 PowerBI 查询模型：{query_name}")
    return _quote_identifier(row[0])


def _build_powerbi_pages(connection: duckdb.DuckDBPyConnection) -> dict[str, Any]:
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
            "productDaily": [],
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
          sum(coalesce(try_cast("新访客数" AS DOUBLE), 0)) AS newVisitors,
          sum(coalesce(try_cast("老访客数" AS DOUBLE), 0)) AS returningVisitors,
          avg(try_cast("平均停留时长" AS DOUBLE)) AS avgStaySeconds,
          avg(try_cast("跳失率" AS DOUBLE)) AS bounceRate
        FROM dedup
        GROUP BY 1 ORDER BY 1
        """,
        [period_start, period_end],
    )

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
                   max(coalesce(try_cast("30日销量" AS DOUBLE), 0)) AS sales30d,
                   max(coalesce(try_cast("累计销量" AS DOUBLE), 0)) AS cumulativeSales
            FROM {catalog_view}
            WHERE cast("商品ID" AS VARCHAR) IN ({placeholders})
            GROUP BY 1 ORDER BY sales30d DESC
            """,
            product_ids,
        )

    return {
        "source": "powerbi_local_logic",
        "period": {"start": period_start, "end": period_end},
        "overallDaily": overall_daily,
        "productDaily": product_daily,
        "promotionSceneDaily": promotion_scene_daily,
        "promotionProductDaily": promotion_product_daily,
        "products": products,
        "privacy": {"rawRowsExposed": False, "sourcePathsExposed": False, "remoteImagesExposed": False},
    }


def _build_unique_snapshot(
    connection: duckdb.DuckDBPyConnection,
    paths: WarehousePaths,
    query_results: list[dict[str, Any]],
) -> dict[str, Any]:
    failures = sum(item.get("failed", 0) for item in query_results)
    rows = sum(int(item.get("rows", 0)) for item in query_results)
    result_by_query = {item["query"]: item for item in query_results}
    powerbi_pages = _build_powerbi_pages(connection)
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
