from __future__ import annotations

import hashlib
import json
import os
import re
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
from .mds_source import (
    JST_WEB_QUERY,
    TMALL_ITEM_PROMOTION_QUERY,
    TMALL_PRODUCT_DAILY_QUERY,
    TMALL_SCENE_DAILY_QUERY,
    TMALL_SHOP_SUMMARY_QUERY,
    MdsSourceError,
    fetch_jst_order_item_web,
    fetch_tmall_item_promotion_daily,
    fetch_tmall_product_daily,
    fetch_tmall_scene_daily,
    fetch_tmall_shop_daily,
)
from .readers import QuarantinedSourceError, discover_files, read_source_file
from .source_policy import (
    DINGTALK_COVERED_QUERIES,
    PARTIAL_OVERLAP_QUERIES,
    select_sync_specs,
    unique_domain_catalog,
)
from .transforms import (
    JUSHUITAN_ERP_MAPPING_RELATIVE_PATH,
    JUSHUITAN_OFFLINE_RELATIVE_DIR,
    transform_source_file,
)

ProgressCallback = Callable[[dict[str, Any]], None]
POWERBI_PAGE_WINDOW_DAYS = 60
# analytics_snapshots 审计留痕保留份数（每日 3 次同步约 2 天的历史）
ANALYTICS_SNAPSHOT_KEEP = 7


@dataclass(frozen=True)
class SyncOptions:
    query_names: frozenset[str] | None = None
    max_files_per_query: int | None = None
    force: bool = False


# 文件解析规则变更时递增对应查询的版本号，触发历史分区重建
PARSE_VERSIONS = {"07-旗舰店商品销售数据": 2}

# 辅助源依赖：不进入 manifest 的 sourcePaths，但转换结果会读取它们。
# 相对路径以主源文件的上两级目录（天猫旗舰店根）为基准。
# 签名必须覆盖这些文件，否则主源未变时会复用旧分区，辅助表更新永远不生效。
AUXILIARY_DEPENDENCIES: dict[str, tuple[Path, ...]] = {
    "15-聚水潭商品数据": (
        JUSHUITAN_OFFLINE_RELATIVE_DIR,
        JUSHUITAN_ERP_MAPPING_RELATIVE_PATH,
    ),
}


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


def _auxiliary_signature(path: Path, spec: QuerySpec | None) -> str:
    """主源之外、但会影响转换结果的辅助文件签名。

    只按「文件名 + 大小 + mtime」做摘要，和主源签名同一口径：辅助表重新导出、
    追加行或更新单元格都会改变签名，触发对应分区重建。目录不存在时返回空串，
    保持旧签名格式，不影响没有辅助依赖的查询。
    """

    if spec is None:
        return ""
    relatives = AUXILIARY_DEPENDENCIES.get(spec.name)
    if not relatives:
        return ""
    root = path.parent.parent
    entries: list[str] = []
    for relative in relatives:
        for item in discover_files((root / relative,)):
            try:
                metadata = item.stat()
            except OSError:
                # 辅助表可能正被 Excel/WPS 重写，跳过瞬时不可读文件；
                # 下一轮同步签名会再次探测，不会永久漏掉。
                continue
            try:
                relative_name = item.relative_to(root).as_posix()
            except ValueError:
                relative_name = item.name
            entries.append(f"{relative_name}:{metadata.st_size}:{metadata.st_mtime_ns}")
    if not entries:
        return ""
    return hashlib.sha1("|".join(entries).encode("utf-8")).hexdigest()[:16]


def _file_signature(path: Path, spec: QuerySpec | None = None) -> str:
    metadata = path.stat()
    base = f"{metadata.st_size}:{metadata.st_mtime_ns}"
    auxiliary = _auxiliary_signature(path, spec)
    if auxiliary:
        base = f"{base}:a{auxiliary}"
    # 解析规则变更后重建对应查询的历史分区；签名带版本避免脏分区被增量同步复用
    version = PARSE_VERSIONS.get(spec.name, 0) if spec else 0
    return f"{base}:v{version}" if version else base


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
    quarantined: list[dict[str, str]] = []

    _emit(progress, {"event": "query_started", "query": spec.name, "files": len(selected), "totalFiles": len(all_files)})
    for index, source in enumerate(selected, start=1):
        key = _state_key(source)
        signature = _file_signature(source, spec)
        destination = _partition_path(paths.staging_root, spec, source)
        previous = state["files"].get(key)
        if not options.force and previous and previous.get("query") == spec.name and previous.get("signature") == signature:
            if previous.get("quarantined"):
                # 置信度隔离结论随文件签名缓存：文件不变则不重复判定，仍计入本次报告
                quarantined.append({"file": source.name, "reason": previous["quarantined"]})
                continue
            if destination.exists():
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
        except QuarantinedSourceError as error:
            # 置信度不足：不写分区、不算失败，记入 quarantined 待人工确认
            quarantined.append({"file": source.name, "reason": error.reason})
            state["files"][key] = {
                "query": spec.name,
                "signature": signature,
                "source": str(source),
                "parquet": None,
                "rows": 0,
                "columns": 0,
                "updatedAt": datetime.now().astimezone().isoformat(),
                "error": None,
                "quarantined": error.reason,
            }
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
        "quarantined": quarantined,
        "rows": sum(int(item.get("rows", 0)) for item in active),
        "columns": max((int(item.get("columns", 0)) for item in active), default=0),
        "errors": errors[:20],
        "durationSeconds": round(time.perf_counter() - started, 3),
        "status": "success" if failed == 0 else "partial" if active else "failed",
    }
    _emit(progress, {"event": "query_finished", **{key: value for key, value in result.items() if key != "errors"}})
    return result


def _sync_postgres_query(
    paths: WarehousePaths,
    spec: QuerySpec,
    state: dict[str, Any],
    options: SyncOptions,
    progress: ProgressCallback | None,
) -> dict[str, Any]:
    """数据库类源（source_kind=postgres）：整表全量刷新为单个 parquet 分区。

    数据量为 1 行/天，不做增量签名，每次同步全量重写。故障隔离是硬要求：
    远程库不可达/凭据缺失/查询异常只允许本查询失败并保留上次有效分区，
    绝不让异常冒出到 sync_warehouse 主循环（那里对查询级异常没有兜底）。
    """
    started = time.perf_counter()
    state_key = f"postgres://{spec.name}"
    destination = paths.staging_root / spec.key / "snapshot.parquet"
    _emit(progress, {"event": "query_started", "query": spec.name, "files": 1, "totalFiles": 1})
    previous = state["files"].get(state_key)
    try:
        # 每次调用时现取，保证单测 mock.patch 模块属性即生效
        fetchers = {
            TMALL_SHOP_SUMMARY_QUERY: fetch_tmall_shop_daily,
            TMALL_PRODUCT_DAILY_QUERY: fetch_tmall_product_daily,
            TMALL_SCENE_DAILY_QUERY: fetch_tmall_scene_daily,
            TMALL_ITEM_PROMOTION_QUERY: fetch_tmall_item_promotion_daily,
            JST_WEB_QUERY: fetch_jst_order_item_web,
        }
        fetcher = fetchers.get(spec.name)
        if fetcher is None:
            raise MdsSourceError(f"未实现的 postgres 源查询：{spec.name}")
        frame = fetcher()
        destination.parent.mkdir(parents=True, exist_ok=True)
        # postgres 源是整表全量：清掉该查询目录下旧的文件链分区，避免
        # read_parquet('*.parquet') 把旧 Excel 分区与 snapshot 叠加。
        for stale in destination.parent.glob("*.parquet"):
            if stale.resolve() != destination.resolve():
                stale.unlink()
        temporary = destination.with_suffix(".parquet.tmp")
        frame.write_parquet(temporary, compression="zstd", statistics=True)
        os.replace(temporary, destination)
        state["files"][state_key] = {
            "query": spec.name,
            "signature": f"rows:{frame.height}:cols:{frame.width}",
            "source": state_key,
            "parquet": str(destination),
            "rows": frame.height,
            "columns": frame.width,
            "updatedAt": datetime.now().astimezone().isoformat(),
            "error": None,
        }
        result = {
            "query": spec.name,
            "key": spec.key,
            "files": 1,
            "activePartitions": 1,
            "processed": 1,
            "reused": 0,
            "failed": 0,
            "quarantined": [],
            "rows": frame.height,
            "columns": frame.width,
            "errors": [],
            "durationSeconds": round(time.perf_counter() - started, 3),
            "status": "success",
        }
    except Exception as error:  # 含 MdsSourceError；任何意外都只降级本查询
        message = str(error).replace("\r", " ").replace("\n", " ")[:500]
        keep = bool(previous and previous.get("parquet") and Path(previous["parquet"]).exists())
        if previous:
            previous["error"] = message
            previous["failedAt"] = datetime.now().astimezone().isoformat()
        result = {
            "query": spec.name,
            "key": spec.key,
            "files": 1,
            "activePartitions": 1 if keep else 0,
            "processed": 0,
            "reused": 1 if keep else 0,
            "failed": 1,
            "quarantined": [],
            "rows": int(previous.get("rows", 0)) if keep else 0,
            "columns": int(previous.get("columns", 0)) if keep else 0,
            "errors": [{"file": state_key, "error": message}],
            "durationSeconds": round(time.perf_counter() - started, 3),
            "status": "partial" if keep else "failed",
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
        # 接待数据同时并入 10-3：京东pop 日报单文件自带营销列（售前接待/促成下单人数/金额），
        # 其店铺=京东POP 标签随行进视图，与自营绩效数据按店铺区分，不会混口径。
        "10-3京东客服绩效数据": ["10-3京东客服绩效数据", "营销数据", "营销数据改版", "接待数据"],
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


def _product_status_hierarchy(
    connection: duckdb.DuckDBPyConnection,
    view: str,
    pm_join: str,
    product_name_expr: str,
    has_master: bool,
    master_columns: set[str],
) -> dict[str, Any]:
    """产品名称 × 子名称 × 订单状态（销售数量）的层级矩阵。

    父节点 = 产品名称（合计 = 子名称之和，与 productStatusMatrix 对齐），
    子节点 = 子名称（来自商品主数据 pm.子名称）。无子名称的产品作为单行叶子。
    列按全表总计降序排列。
    """
    sub_name_expr = (
        'coalesce(nullif(trim(cast(pm."子名称" AS VARCHAR)), \'\'), \'\')'
        if has_master and "子名称" in master_columns
        else "\'\'"
    )
    top_products_sql = (
        f"SELECT {product_name_expr} AS pname FROM {view} s {pm_join} "
        f"WHERE {product_name_expr} <> '(未命名)' "
        f"GROUP BY 1 ORDER BY sum(coalesce(try_cast(s.\"销售数量\" AS DOUBLE),0)) DESC"
    )
    sql = f"""
        PIVOT (
          SELECT {product_name_expr} AS pname,
                 {sub_name_expr} AS subName,
                 coalesce(cast(s."订单状态明细" AS VARCHAR), '(未知)') AS status,
                 coalesce(try_cast(s."销售数量" AS DOUBLE),0) AS units
          FROM {view} s {pm_join}
          WHERE {product_name_expr} IN ({top_products_sql})
            AND {product_name_expr} <> '(未命名)'
        ) ON status USING sum(units)
    """
    rows = _records(connection, sql)
    if not rows:
        return {"columns": [], "rows": []}
    col_keys = [k for k in rows[0].keys() if k not in ("pname", "subName")]
    col_totals: dict[str, float] = {k: 0.0 for k in col_keys}
    tree: dict[str, dict[str, dict[str, float]]] = {}
    for record in rows:
        pname = str(record["pname"]) if record["pname"] is not None else "(未命名)"
        sub = str(record["subName"]) if record["subName"] else ""
        values = {k: float(record.get(k) or 0) for k in col_keys}
        for k in col_keys:
            col_totals[k] += values[k]
        tree.setdefault(pname, {})[sub] = values
    columns = sorted(col_keys, key=lambda k: col_totals[k], reverse=True)
    hierarchy_rows: list[dict[str, Any]] = []
    for pname, subs in tree.items():
        children = []
        parent_values = {k: 0.0 for k in col_keys}
        for sub, values in subs.items():
            for k in col_keys:
                parent_values[k] += values.get(k, 0.0) or 0.0
            children.append({
                "subName": sub,
                "values": values,
                "total": sum(values.values()),
            })
        children.sort(key=lambda c: (c["total"] or 0), reverse=True)
        hierarchy_rows.append({
            "productName": pname,
            "values": parent_values,
            "total": sum(parent_values.values()),
            "children": children,
            # 多子名称、或唯一子名称非空 → 可展开；仅一个空子名称 → 单行叶子
            "hasChildren": len(children) > 1 or any(c["subName"] for c in children),
        })
    hierarchy_rows.sort(key=lambda r: (r["total"] or 0), reverse=True)
    return {"columns": columns, "rows": hierarchy_rows}


def _fulfillment_hierarchy(
    connection: duckdb.DuckDBPyConnection,
    view: str,
    pm_join: str,
    product_name_expr: str,
    order_id_expr: str,
    order_date_expr: str,
    ship_date_expr: str,
    has_master: bool,
    master_columns: set[str],
    fulfillment_by_product: list[dict[str, Any]],
) -> dict[str, Any]:
    """产品名称 × 子名称 × 发货时效指标的层级矩阵。

    父节点 = 产品名称（指标沿用现有 fulfillmentByProduct 的合计，保证与卡面原值一致），
    子节点 = 子名称（来自商品主数据 pm.子名称），在 (产品名称, 子名称) 粒度重算订单量、
    平均发货时效与各天发货占比。无子名称的产品作为单行叶子。
    """
    sub_name_expr = (
        'coalesce(nullif(trim(cast(pm."子名称" AS VARCHAR)), \'\'), \'\')'
        if has_master and "子名称" in master_columns
        else "\'\'"
    )
    sql = f"""
        WITH order_sub AS (
          SELECT
            {product_name_expr} AS productName,
            {order_id_expr} AS orderId,
            max({sub_name_expr}) AS subName,
            min({order_date_expr}) AS orderDate,
            min({ship_date_expr}) AS shipDate
          FROM {view} s {pm_join}
          WHERE {product_name_expr} <> '(未命名)'
            AND {order_id_expr} IS NOT NULL
          GROUP BY 1, 2
        ), shipping_durations AS (
          SELECT
            productName,
            subName,
            CASE WHEN shipDate >= orderDate THEN datediff('day', orderDate, shipDate) END AS shippingDays
          FROM order_sub
        )
        SELECT
          productName,
          subName,
          count(*) AS orderCount,
          count(shippingDays) AS shippedOrderCount,
          round(avg(shippingDays), 2) AS avgShippingDays,
          cast(sum(CASE WHEN shippingDays = 3 THEN 1 ELSE 0 END) AS DOUBLE) / count(*) AS day3Share,
          cast(sum(CASE WHEN shippingDays = 5 THEN 1 ELSE 0 END) AS DOUBLE) / count(*) AS day5Share,
          cast(sum(CASE WHEN shippingDays = 7 THEN 1 ELSE 0 END) AS DOUBLE) / count(*) AS day7Share,
          cast(sum(CASE WHEN shippingDays = 10 THEN 1 ELSE 0 END) AS DOUBLE) / count(*) AS day10Share,
          cast(sum(CASE WHEN shippingDays BETWEEN 0 AND 15 THEN 1 ELSE 0 END) AS DOUBLE) / count(*) AS within15DayShare
        FROM shipping_durations
        GROUP BY 1, 2
    """
    rows = _records(connection, sql)
    children_by_product: dict[str, list[dict[str, Any]]] = {}
    sub_nonempty_by_product: dict[str, bool] = {}
    for rec in rows:
        pname = str(rec["productName"])
        sub = str(rec["subName"]) if rec["subName"] else ""
        if sub:
            sub_nonempty_by_product[pname] = True
        child = {
            "key": f"{pname}|{sub}" if sub else pname,
            "name": sub if sub else pname,
            "orderCount": rec["orderCount"],
            "shippedOrderCount": rec["shippedOrderCount"],
            "avgShippingDays": rec["avgShippingDays"],
            "day3Share": rec["day3Share"],
            "day5Share": rec["day5Share"],
            "day7Share": rec["day7Share"],
            "day10Share": rec["day10Share"],
            "within15DayShare": rec["within15DayShare"],
        }
        children_by_product.setdefault(pname, []).append(child)
    hierarchy_rows: list[dict[str, Any]] = []
    for parent in fulfillment_by_product:
        pname = parent["productName"]
        children = children_by_product.get(pname, [])
        children.sort(key=lambda c: c["orderCount"], reverse=True)
        has_children = len(children) > 1 or bool(sub_nonempty_by_product.get(pname, False))
        hierarchy_rows.append({
            "key": pname,
            "name": pname,
            "orderCount": parent["orderCount"],
            "shippedOrderCount": parent["shippedOrderCount"],
            "avgShippingDays": parent["avgShippingDays"],
            "day3Share": parent["day3Share"],
            "day5Share": parent["day5Share"],
            "day7Share": parent["day7Share"],
            "day10Share": parent["day10Share"],
            "within15DayShare": parent["within15DayShare"],
            "hasChildren": has_children,
            "children": children,
        })
    return {"rows": hierarchy_rows}


def _safe_product_image(value: Any) -> str | None:
    """Allow only the catalog image CDN in the public PowerBI snapshot."""

    text = str(value or "").strip()
    allowed_prefixes = (
        "https://img.alicdn.com/",
        "https://img.pddpic.com/",
        "https://h2.appsimg.com/",
    )
    return text if text.lower().startswith(allowed_prefixes) else None


def _has_cjk(text: str) -> bool:
    """是否包含中文字符（用于区分中文名称核心词与其他匹配）。"""
    return any("一" <= ch <= "鿿" for ch in text)


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


_COMPETITOR_PERIOD_DATE_PATTERN = re.compile(r"(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日")


def _competitor_period_sort_key(label: str) -> tuple[date, str]:
    """时间段标签按起始日期排序。

    数据区间为 2025-12 至 2026-08：仅 '2025年12月29日-2026年01月01日' 带显式年份，
    其余 'MM月DD日-MM月DD日' 默认落在 2026 年。无日期的标签排在最后。
    """

    match = _COMPETITOR_PERIOD_DATE_PATTERN.search(label)
    if match:
        year = int(match.group(1)) if match.group(1) else 2026
        try:
            return (date(year, int(match.group(2)), int(match.group(3))), label)
        except ValueError:
            pass
    return (date(9999, 12, 31), label)


def _build_competitor_daily(connection: duckdb.DuckDBPyConnection) -> list[dict[str, Any]]:
    """PBIX「竞品推广数据」页行级数据：品牌×渠道×时间段 + 派生指标。

    度量口径对齐 migration/powerbi-tmdl/tables/14-推广竞品数据.tmdl：
    - 消耗/展现量/点击量/成交金额（万）= SUM(列) / 10000；
    - ROI（公式）= 成交金额 / 消耗；点击率（竞品）= 点击量 / 展现量；
    - 消耗占比 = SUM(消耗) / CALCULATE(SUM(消耗), ALL(渠道))，即同时间段同品牌各渠道合计。
    四个人群成本列在 PBIX 视觉中按 Sum 聚合，这里保留行级原值供前端按相同口径求和。
    时间段为空的 4 个单日快照文件用 Source.Name（去 .xlsx）作为时间段标签。
    """

    try:
        view = _model_view(connection, "14-推广竞品数据")
    except ValueError:
        return []
    rows = _records(
        connection,
        f"""
        WITH base AS (
          SELECT * EXCLUDE (_snapshot_rank) FROM (
            SELECT
              coalesce(
                nullif(trim(cast("时间段" AS VARCHAR)), ''),
                regexp_replace(coalesce(cast("Source.Name" AS VARCHAR), ''), '\\.xlsx$', '')
              ) AS period,
              trim(cast("品牌" AS VARCHAR)) AS brand,
              trim(cast("渠道" AS VARCHAR)) AS channel,
              coalesce(try_cast("消耗" AS DOUBLE), 0) AS spend,
              coalesce(try_cast("展现量" AS DOUBLE), 0) AS impressions,
              coalesce(try_cast("点击量" AS DOUBLE), 0) AS clicks,
              coalesce(try_cast("收藏加购量" AS DOUBLE), 0) AS cartCount,
              coalesce(try_cast("成交量" AS DOUBLE), 0) AS orders,
              coalesce(try_cast("成交金额" AS DOUBLE), 0) AS revenue,
              try_cast("新增单个访问人群成本" AS DOUBLE) AS visitCost,
              try_cast("新增单个兴趣人群成本" AS DOUBLE) AS interestCost,
              try_cast("新增单个首购人群成本" AS DOUBLE) AS firstPurchaseCost,
              try_cast("新增单个复购人群成本" AS DOUBLE) AS repurchaseCost,
              try_cast("收藏加购率" AS DOUBLE) AS cartRate,
              try_cast("成交转化率" AS DOUBLE) AS convRate,
              try_cast("单次点击成本" AS DOUBLE) AS cpc,
              try_cast("单次收加成本" AS DOUBLE) AS cartCost,
              -- 对齐 PBIX M 层 Table.Distinct(时间,品牌,渠道,时间段) 的去重语义：
              -- 同 (period,brand,channel) 重复源行保留最新一份（mtime 优先），再聚合。
              row_number() OVER (
                PARTITION BY
                  coalesce(
                    nullif(trim(cast("时间段" AS VARCHAR)), ''),
                    regexp_replace(coalesce(cast("Source.Name" AS VARCHAR), ''), '\\.xlsx$', '')
                  ),
                  trim(cast("品牌" AS VARCHAR)),
                  trim(cast("渠道" AS VARCHAR))
                ORDER BY "_source_mtime_ns" DESC, "_source_path" DESC
              ) AS _snapshot_rank
            FROM {view}
            WHERE coalesce(trim(cast("品牌" AS VARCHAR)), '') <> ''
              AND coalesce(trim(cast("渠道" AS VARCHAR)), '') <> ''
          ) WHERE _snapshot_rank = 1
        ), grouped AS (
          SELECT period, brand, channel,
                 sum(spend) AS spend,
                 sum(impressions) AS impressions,
                 sum(clicks) AS clicks,
                 sum(cartCount) AS cartCount,
                 sum(orders) AS orders,
                 sum(revenue) AS revenue,
                 any_value(visitCost) AS visitCost,
                 any_value(interestCost) AS interestCost,
                 any_value(firstPurchaseCost) AS firstPurchaseCost,
                 any_value(repurchaseCost) AS repurchaseCost,
                 any_value(cartRate) AS cartRate,
                 any_value(convRate) AS convRate,
                 any_value(cpc) AS cpc,
                 any_value(cartCost) AS cartCost
          FROM base
          GROUP BY 1, 2, 3
        )
        SELECT
          period, brand, channel,
          spend / 10000.0 AS spendWan,
          impressions / 10000.0 AS impressionsWan,
          clicks / 10000.0 AS clicksWan,
          revenue / 10000.0 AS revenueWan,
          revenue / nullif(spend, 0) AS roi,
          clicks / nullif(impressions, 0) AS ctr,
          spend / nullif(sum(spend) OVER (PARTITION BY period, brand), 0) AS spendShare,
          visitCost, interestCost, firstPurchaseCost, repurchaseCost,
          cartCount, orders, cartRate, convRate, cpc, cartCost
        FROM grouped
        """,
    )
    rows.sort(key=lambda row: (_competitor_period_sort_key(str(row["period"])), str(row["brand"]), str(row["channel"])))
    return rows


def _coerce_iso_date(value: "date | str") -> date:
    """接受 date 或 YYYY-MM-DD 字符串，统一为 date（按需区间参数入口）。"""
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def _source_coverage(
    connection: duckdb.DuckDBPyConnection,
    view: str,
    column: str,
    range_start: date,
    range_end: date,
) -> dict[str, Any]:
    """所选区间内某来源表的实际覆盖：min/max（区间内首末有数据日）、有数据天数、缺失天数（日历日口径）。"""
    row = connection.execute(
        f'SELECT min(try_cast("{column}" AS DATE)), max(try_cast("{column}" AS DATE)), '
        f'count(DISTINCT try_cast("{column}" AS DATE)) FROM {view} '
        f'WHERE try_cast("{column}" AS DATE) BETWEEN ? AND ?',
        [range_start, range_end],
    ).fetchone()
    minimum, maximum, days = row[0], row[1], int(row[2] or 0)
    total_days = (range_end - range_start).days + 1
    return {
        "min": minimum.isoformat() if minimum else None,
        "max": maximum.isoformat() if maximum else None,
        "days": days,
        "missingDays": max(total_days - days, 0),
    }


def _source_coverage_union(
    connection: duckdb.DuckDBPyConnection,
    parts: list[tuple[str | None, str]],
    range_start: date,
    range_end: date,
) -> dict[str, Any]:
    """多来源并集覆盖（文件链 + mds 补缺），与 builder 的缺口回填口径一致。

    parts 中 view 为 None 的来源（mds 未登记/未同步）自动跳过，退化为纯文件链口径。
    """
    active = [(view, column) for view, column in parts if view]
    selects = " UNION ALL ".join(
        f'SELECT try_cast("{column}" AS DATE) AS day FROM {view} '
        f'WHERE try_cast("{column}" AS DATE) BETWEEN ? AND ?'
        for view, column in active
    )
    params = [value for _view, _column in active for value in (range_start, range_end)]
    row = connection.execute(
        f"SELECT min(day), max(day), count(DISTINCT day) FROM ({selects})", params
    ).fetchone()
    minimum, maximum, days = row[0], row[1], int(row[2] or 0)
    total_days = (range_end - range_start).days + 1
    return {
        "min": minimum.isoformat() if minimum else None,
        "max": maximum.isoformat() if maximum else None,
        "days": days,
        "missingDays": max(total_days - days, 0),
    }


def _gap_fill_view(connection: duckdb.DuckDBPyConnection, query_name: str, required_column: str) -> str | None:
    """mds 补缺视图：未登记、未同步出分区（_empty 占位）或缺关键列时返回 None，
    调用方退回纯文件链口径，不拖垮快照构建。"""
    try:
        view = _model_view(connection, query_name)
    except ValueError:
        return None
    columns = {row[0] for row in connection.execute(f"DESCRIBE {view}").fetchall()}
    return view if required_column in columns else None


def _gap_union_cte(
    alias: str,
    dedup_name: str,
    mds_view: str,
    columns: list[tuple[str, str | None]],
    dedup_date_column: str = "日期",
) -> str:
    """生成「文件链 dedup UNION ALL mds 补缺日」CTE 片段（自带两个区间占位符）。

    columns 为 (输出列, mds 列) 对；mds 列为 None 时该列在 mds 侧置 NULL
    （如 item 表无直接购物车数）。两源重叠日恒以文件链为准（反连接按日剔除）。
    列类型由下游 try_cast 归一，混合类型在 UNION 中按 DuckDB 公共类型解析。
    dedup_date_column 须显式给出 dedup 侧真实日期列（04 为「统计日期」）——若子查询
    引用 dedup 不存在的列，DuckDB 会将其解析为外层 mds 行的相关列，反连接静默失效。
    """
    file_exprs = ", ".join(f'"{out}"' for out, _mds_col in columns)
    mds_exprs = ", ".join(
        ("NULL" if mds_col is None else f'"{mds_col}"') + f' AS "{out}"'
        for out, mds_col in columns
    )
    return (
        f", {alias} AS ("
        f"SELECT {file_exprs} FROM {dedup_name} "
        f"UNION ALL SELECT {mds_exprs} FROM {mds_view} "
        f'WHERE try_cast("日期" AS DATE) BETWEEN ? AND ? '
        f'AND try_cast("日期" AS DATE) NOT IN ('
        f'SELECT try_cast("{dedup_date_column}" AS DATE) FROM {dedup_name} '
        f'WHERE try_cast("{dedup_date_column}" AS DATE) IS NOT NULL'
        f"))"
    )


def _build_shop_summary_daily(
    connection: duckdb.DuckDBPyConnection,
    period_start: date,
    period_end: date,
) -> list[dict[str, Any]]:
    """mds 天猫店铺日汇总（与钉钉填表同一真值源）：店铺级日字段直读 mds 库。

    独立于生意参谋导出文件链，文件漏跑（如 2026-10-05）时该卡仍有数据。
    首次同步前/源故障时视图只有 _empty 占位列，列探测兜底返回 []，不拖垮快照构建。
    """
    try:
        view = _model_view(connection, TMALL_SHOP_SUMMARY_QUERY)
    except ValueError:
        return []
    columns = {row[0] for row in connection.execute(f"DESCRIBE {view}").fetchall()}
    if not {"日期", "GMV"}.issubset(columns):
        return []
    return _records(
        connection,
        f"""
        SELECT
          try_cast("日期" AS DATE) AS date,
          try_cast("浏览量" AS DOUBLE) AS pageViews,
          try_cast("店铺客户数" AS DOUBLE) AS shopCustomers,
          try_cast("GMV" AS DOUBLE) AS gmv,
          try_cast("成功退款金额" AS DOUBLE) AS refundAmount,
          try_cast("加购人数" AS DOUBLE) AS addToCart,
          try_cast("关键词推广" AS DOUBLE) AS keywordSpend,
          try_cast("精准人群推广" AS DOUBLE) AS audienceSpend,
          try_cast("全站推广" AS DOUBLE) AS fullSiteSpend,
          try_cast("淘客" AS DOUBLE) AS taokeCommission,
          try_cast("内容场景" AS DOUBLE) AS contentSceneSpend,
          cast("店铺排名" AS VARCHAR) AS storeRank
        FROM {view}
        WHERE try_cast("日期" AS DATE) BETWEEN ? AND ?
        ORDER BY 1
        """,
        [period_start, period_end],
    )


def _build_powerbi_pages(
    connection: duckdb.DuckDBPyConnection,
    store_rank_daily: dict[str, str] | None = None,
    period_start: "date | str | None" = None,
    period_end: "date | str | None" = None,
    include_customer_service: bool = True,
) -> dict[str, Any]:
    """Build compact daily aggregates for the three PBIX-derived website pages.

    默认产出滚动窗口快照（POWERBI_PAGE_WINDOW_DAYS 天，随最新数据日前移）；
    显式传入 period_start/period_end 时按所选区间重算（服务端 /api/analytics/powerbi-pages
    按需查询用），并在 coverage 中回报 04/07/08 来源表在该区间的实际覆盖，
    供前端「数仓缺口」标签区分「筛选了但没有数据」与「数据齐全」。
    include_customer_service=False 供按需路径跳过客服聚合（天猫明细工作区不渲染客服，
    客服 tab 固定读快照），省去 10-1~10-4 四张表的重算。"""

    base_view = _model_view(connection, "04-旗舰店基础数据")
    product_view = _model_view(connection, "07-旗舰店商品销售数据")
    promotion_view = _model_view(connection, "08-旗舰店推广花费")
    catalog_view = _model_view(connection, "05-旗舰店ID对照表")
    # mds 补缺源（钉钉填表同库）：文件链漏跑的日子由 mds 补齐，重叠日恒以文件链为准；
    # 未登记/未同步时为 None，自动退回纯文件链口径
    mds_product_view = _gap_fill_view(connection, TMALL_PRODUCT_DAILY_QUERY, "商品ID")
    mds_scene_view = _gap_fill_view(connection, TMALL_SCENE_DAILY_QUERY, "场景名字")
    mds_item_promo_view = _gap_fill_view(connection, TMALL_ITEM_PROMOTION_QUERY, "商品ID")
    # 04 基础数据补缺：要求扩列后的店铺汇总视图（含支付买家数）；旧 12 列分区自动不启用
    mds_base_view = _gap_fill_view(connection, TMALL_SHOP_SUMMARY_QUERY, "支付买家数")

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
    # 文件链连续漏跑时 mds 可能更新到更晚日期；纳入窗口端点，避免补缺数据被窗口截掉
    for mds_view in (mds_product_view, mds_scene_view, mds_item_promo_view, mds_base_view):
        if mds_view:
            latest_candidates.append(
                connection.execute(
                    f'SELECT max(try_cast("日期" AS DATE)) FROM {mds_view} '
                    'WHERE try_cast("日期" AS DATE) <= current_date'
                ).fetchone()[0]
            )
    latest_dates = [value for value in latest_candidates if value]
    if not latest_dates:
        return {
            "source": "powerbi_local_logic",
            "period": None,
            "coverage": None,
            "overallDaily": [],
            "dailyCore": [],
            "shopSummaryDaily": [],
            "productDaily": [],
            "productDailyPriorYear": [],
            "promotionSceneDaily": [],
            "promotionProductDaily": [],
            "competitorDaily": [],
            "products": [],
            "customerService": {"period": None, "tmall": None, "jd": None},
        }
    if period_end is not None:
        # 按需模式：调用方显式给定区间；只给 end 时 end 前推同样长度的滚动窗口
        period_end = _coerce_iso_date(period_end)
        period_start = _coerce_iso_date(period_start) if period_start is not None else (
            period_end - timedelta(days=POWERBI_PAGE_WINDOW_DAYS - 1)
        )
        if period_start > period_end:
            raise ValueError("period_start 不能晚于 period_end")
    else:
        period_end = max(latest_dates)
        period_start = period_end - timedelta(days=POWERBI_PAGE_WINDOW_DAYS - 1)

    # 04 基础数据同样做 mds 补缺：店铺汇总扩列后 14 字段与 04 逐项对平（2026-10-03~05 验证），
    # 重叠日恒以文件链为准
    overall_gap = ""
    overall_from = "dedup"
    overall_params: list[Any] = [period_start, period_end]
    if mds_base_view:
        overall_gap = _gap_union_cte(
            "unioned",
            "dedup",
            mds_base_view,
            [("统计日期", "日期"), ("访客数", "店铺客户数"), ("商品访客数", "商品访客数"),
             ("加购人数", "加购人数"), ("支付买家数", "支付买家数"), ("支付金额", "GMV"),
             ("成功退款金额", "成功退款金额"), ("全站推广花费", "全站推广"), ("关键词推广花费", "关键词推广"),
             ("精准人群推广花费", "精准人群推广"), ("淘宝客佣金", "淘客"), ("新访客数", "新访客数"),
             ("老访客数", "老访客数"), ("平均停留时长", "平均停留时长"), ("跳失率", "跳失率")],
            dedup_date_column="统计日期",
        )
        overall_from = "unioned"
        overall_params += [period_start, period_end]
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
        ){overall_gap}
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
        FROM {overall_from}
        GROUP BY 1 ORDER BY 1
        """,
        overall_params,
    )

    # 对齐 PBIX「天猫旗舰店整体数据 -> 每天核心数据」矩阵。
    # 字段来源和 DAX 口径：07 商品表 + 08 推广表；店铺排名由 00 原始表仅字段补充。
    # mds 缺口回填：与商品/场景明细同一对补缺视图，避免文件链漏跑日出现「推广有数、商品全 0」的半空行
    daily_core_product_gap = ""
    daily_core_product_from = "product_dedup"
    daily_core_params: list[Any] = [period_start, period_end]
    if mds_product_view:
        daily_core_product_gap = _gap_union_cte(
            "product_unioned",
            "product_dedup",
            mds_product_view,
            [("日期", "日期"), ("商品ID", "商品ID"), ("商品名称", "商品名称"),
             ("商品访客数", "商品访客数"), ("加购人数", "加购人数"), ("支付买家数", "支付买家数"),
             ("支付金额", "支付金额"), ("退款金额", "退款金额"), ("商品支付件数", "商品支付件数")],
        )
        daily_core_product_from = "product_unioned"
        daily_core_params += [period_start, period_end]
    daily_core_params += [period_start, period_end]
    daily_core_promotion_gap = ""
    daily_core_promotion_from = "promotion_dedup"
    if mds_scene_view:
        daily_core_promotion_gap = _gap_union_cte(
            "promotion_unioned",
            "promotion_dedup",
            mds_scene_view,
            [("日期", "日期"), ("花费（未含达人）", None), ("花费", "花费"), ("总购物车数", "总购物车数")],
        )
        daily_core_promotion_from = "promotion_unioned"
        daily_core_params += [period_start, period_end]
    daily_core = _records(
        connection,
        f"""
        WITH product_dedup AS (
          SELECT * EXCLUDE (_snapshot_rank) FROM (
            SELECT *, row_number() OVER (
              PARTITION BY try_cast("日期" AS DATE), cast("商品ID" AS VARCHAR)
              -- 同日期同商品兼有宽表（含访客数）与瘦导出（仅支付列）快照时，优先保留宽表
              ORDER BY (try_cast("商品访客数" AS DOUBLE) IS NOT NULL) DESC, "_source_mtime_ns" DESC, "_source_path" DESC
            ) AS _snapshot_rank
            FROM {product_view}
            WHERE try_cast("日期" AS DATE) BETWEEN ? AND ? AND "商品ID" IS NOT NULL
          ) WHERE _snapshot_rank = 1
        ){daily_core_product_gap}, product_by_date AS (
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
          FROM {daily_core_product_from}
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
        ){daily_core_promotion_gap}, promotion_by_date AS (
          SELECT
            try_cast("日期" AS DATE) AS date,
            sum(coalesce(try_cast("花费（未含达人）" AS DOUBLE), try_cast("花费" AS DOUBLE), 0)) AS spend,
            sum(coalesce(try_cast("总购物车数" AS DOUBLE), 0)) AS promotionCarts
          FROM {daily_core_promotion_from}
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
        daily_core_params,
    )
    for row in daily_core:
        row["storeRank"] = (store_rank_daily or {}).get(str(row["date"]))

    # mds 缺口回填：文件链整体缺失的日期由 mds（钉钉填表同库）补齐，重叠日恒以文件链为准；
    # ranked 只统计文件链，展示商品集合（访客前 60）不随补缺变化
    product_gap_cte = ""
    product_source = "dedup"
    product_params: list[Any] = [period_start, period_end]
    if mds_product_view:
        product_gap_cte = f""", unioned AS (
          SELECT try_cast("日期" AS DATE) AS "日期", cast("商品ID" AS VARCHAR) AS "商品ID",
                 cast("商品名称" AS VARCHAR) AS "商品名称",
                 try_cast("商品访客数" AS DOUBLE) AS "商品访客数", try_cast("加购人数" AS DOUBLE) AS "加购人数",
                 try_cast("支付买家数" AS DOUBLE) AS "支付买家数", try_cast("支付金额" AS DOUBLE) AS "支付金额",
                 try_cast("退款金额" AS DOUBLE) AS "退款金额", try_cast("商品支付件数" AS DOUBLE) AS "商品支付件数"
          FROM dedup
          UNION ALL
          SELECT try_cast("日期" AS DATE), cast("商品ID" AS VARCHAR), cast("商品名称" AS VARCHAR),
                 try_cast("商品访客数" AS DOUBLE), try_cast("加购人数" AS DOUBLE),
                 try_cast("支付买家数" AS DOUBLE), try_cast("支付金额" AS DOUBLE),
                 try_cast("退款金额" AS DOUBLE), try_cast("商品支付件数" AS DOUBLE)
          FROM {mds_product_view}
          WHERE try_cast("日期" AS DATE) BETWEEN ? AND ?
            AND try_cast("日期" AS DATE) NOT IN (
              SELECT try_cast("日期" AS DATE) FROM dedup WHERE try_cast("日期" AS DATE) IS NOT NULL
            )
        )"""
        product_source = "unioned"
        product_params += [period_start, period_end]
    product_daily = _records(
        connection,
        f"""
        WITH dedup AS (
          SELECT * EXCLUDE (_snapshot_rank) FROM (
            SELECT *, row_number() OVER (
              PARTITION BY try_cast("日期" AS DATE), cast("商品ID" AS VARCHAR)
              -- 同日期同商品兼有宽表（含访客数）与瘦导出（仅支付列）快照时，优先保留宽表
              ORDER BY (try_cast("商品访客数" AS DOUBLE) IS NOT NULL) DESC, "_source_mtime_ns" DESC, "_source_path" DESC
            ) AS _snapshot_rank
            FROM {product_view}
            WHERE try_cast("日期" AS DATE) BETWEEN ? AND ? AND "商品ID" IS NOT NULL
          ) WHERE _snapshot_rank = 1
        ){product_gap_cte}, ranked AS (
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
        FROM {product_source} AS data
        INNER JOIN ranked ON ranked.productId = cast(data."商品ID" AS VARCHAR)
        GROUP BY 1, 2 ORDER BY 1, visitors DESC
        """,
        product_params,
    )

    # 去年同期商品级聚合，用于「国补后金额同比」（对齐 .pbix DATEADD(-365, DAY)）
    # 文件链去年同期缺口同样由 mds 商品日明细补缺（同口径反连接）
    prior_year_start = period_start - timedelta(days=365)
    prior_year_end = period_end - timedelta(days=365)
    prior_year_gap = ""
    prior_year_from = "dedup"
    prior_year_params: list[Any] = [prior_year_start, prior_year_end]
    if mds_product_view:
        prior_year_gap = _gap_union_cte(
            "unioned",
            "dedup",
            mds_product_view,
            [("日期", "日期"), ("商品ID", "商品ID"), ("支付金额", "支付金额"), ("退款金额", "退款金额")],
        )
        prior_year_from = "unioned"
        prior_year_params += [prior_year_start, prior_year_end]
    product_daily_prior_year = _records(
        connection,
        f"""
        WITH dedup AS (
          SELECT * EXCLUDE (_snapshot_rank) FROM (
            SELECT *, row_number() OVER (
              PARTITION BY try_cast("日期" AS DATE), cast("商品ID" AS VARCHAR)
              -- 同日期同商品兼有宽表（含访客数）与瘦导出（仅支付列）快照时，优先保留宽表
              ORDER BY (try_cast("商品访客数" AS DOUBLE) IS NOT NULL) DESC, "_source_mtime_ns" DESC, "_source_path" DESC
            ) AS _snapshot_rank
            FROM {product_view}
            WHERE try_cast("日期" AS DATE) BETWEEN ? AND ? AND "商品ID" IS NOT NULL
          ) WHERE _snapshot_rank = 1
        ){prior_year_gap}
        SELECT
          cast("商品ID" AS VARCHAR) AS productId,
          sum(coalesce(try_cast("支付金额" AS DOUBLE), 0)) AS payAmount,
          sum(coalesce(try_cast("退款金额" AS DOUBLE), 0)) AS refund
        FROM {prior_year_from}
        GROUP BY 1
        """,
        prior_year_params,
    )

    # mds 缺口回填：与商品明细同规则（文件链优先，mds 只补缺日；花费列走
    # coalesce(花费（未含达人）, 花费)，mds 侧只提供「花费」即 charge_amount）
    scene_gap_cte = ""
    scene_source = "dedup"
    scene_params: list[Any] = [period_start, period_end]
    if mds_scene_view:
        scene_gap_cte = f""", unioned AS (
          SELECT try_cast("日期" AS DATE) AS "日期", cast("场景名字" AS VARCHAR) AS "场景名字",
                 try_cast("展现量" AS DOUBLE) AS "展现量", try_cast("点击量" AS DOUBLE) AS "点击量",
                 try_cast("花费（未含达人）" AS DOUBLE) AS "花费（未含达人）", try_cast("花费" AS DOUBLE) AS "花费",
                 try_cast("总成交金额" AS DOUBLE) AS "总成交金额", try_cast("总购物车数" AS DOUBLE) AS "总购物车数",
                 try_cast("直接购物车数" AS DOUBLE) AS "直接购物车数", try_cast("旺旺咨询量" AS DOUBLE) AS "旺旺咨询量"
          FROM dedup
          UNION ALL
          SELECT try_cast("日期" AS DATE), cast("场景名字" AS VARCHAR),
                 try_cast("展现量" AS DOUBLE), try_cast("点击量" AS DOUBLE),
                 NULL, try_cast("花费" AS DOUBLE),
                 try_cast("总成交金额" AS DOUBLE), try_cast("总购物车数" AS DOUBLE),
                 try_cast("直接购物车数" AS DOUBLE), try_cast("旺旺咨询量" AS DOUBLE)
          FROM {mds_scene_view}
          WHERE try_cast("日期" AS DATE) BETWEEN ? AND ?
            AND try_cast("日期" AS DATE) NOT IN (
              SELECT try_cast("日期" AS DATE) FROM dedup WHERE try_cast("日期" AS DATE) IS NOT NULL
            )
        )"""
        scene_source = "unioned"
        scene_params += [period_start, period_end]
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
        ){scene_gap_cte}
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
        FROM {scene_source}
        GROUP BY 1, 2 ORDER BY 1, spend DESC
        """,
        scene_params,
    )

    # mds 商品×场景补缺（taobao_item_promotion_daily）：item 表无直接购物车数，回填日该列为 0
    promo_product_gap = ""
    promo_product_from = "dedup"
    promo_product_params: list[Any] = [period_start, period_end]
    if mds_item_promo_view:
        promo_product_gap = _gap_union_cte(
            "unioned",
            "dedup",
            mds_item_promo_view,
            [("日期", "日期"), ("商品ID", "商品ID"), ("主体名称", "主体名称"), ("场景名字", "场景名字"),
             ("展现量", "展现量"), ("点击量", "点击量"), ("花费（未含达人）", None), ("花费", "花费"),
             ("总成交金额", "总成交金额"), ("总购物车数", "总购物车数"), ("直接购物车数", None), ("旺旺咨询量", "旺旺咨询量")],
        )
        promo_product_from = "unioned"
        promo_product_params += [period_start, period_end]
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
        ){promo_product_gap}, ranked AS (
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
        FROM {promo_product_from} AS data
        INNER JOIN ranked ON ranked.productId = cast(data."商品ID" AS VARCHAR)
        GROUP BY 1, 2, 3 ORDER BY 1, spend DESC
        """,
        promo_product_params,
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

    shop_summary_daily = _build_shop_summary_daily(connection, period_start, period_end)

    return {
        "source": "powerbi_local_logic",
        "period": {"start": period_start, "end": period_end},
        "coverage": {
            "range": {"start": period_start.isoformat(), "end": period_end.isoformat()},
            "base": _source_coverage_union(
                connection,
                [(base_view, "统计日期"), (mds_base_view, "日期")],
                period_start,
                period_end,
            ),
            "product": _source_coverage_union(
                connection,
                [(product_view, "日期"), (mds_product_view, "日期")],
                period_start,
                period_end,
            ),
            "promotion": _source_coverage_union(
                connection,
                [(promotion_view, "日期"), (mds_scene_view, "日期")],
                period_start,
                period_end,
            ),
        },
        "overallDaily": overall_daily,
        "dailyCore": daily_core,
        "shopSummaryDaily": shop_summary_daily,
        "productDaily": product_daily,
        "productDailyPriorYear": product_daily_prior_year,
        "promotionSceneDaily": promotion_scene_daily,
        "promotionProductDaily": promotion_product_daily,
        "competitorDaily": _build_competitor_daily(connection),
        "products": products,
        "customerService": _build_customer_service(connection, period_start, period_end) if include_customer_service else None,
        "privacy": {
            "rawRowsExposed": False,
            "sourcePathsExposed": False,
            "remoteImagesExposed": True,
            # 客服每日看板按用户要求复刻：customerService 暴露按 (日期, 客服) 聚合的效能指标
            # （客服昵称/销售额/响应时长/评价），不含买家 ID/手机号/订单明细等买家隐私。
            # 满意率口径：天梯按"有效接待人数"加权（率 × 接待 / 接待），京东按"好评量 / 评价量"计算。
            "customerServiceRowsExposed": True,
        },
    }


def _build_customer_service(
    connection: duckdb.DuckDBPyConnection,
    period_start: date,
    period_end: date,
) -> dict[str, Any]:
    """PBIX「天猫每日客服数据」「京东每日客服数据」两页聚合数据。

    口径对齐 migration/powerbi-tmdl/tables/10-*.tmdl 的 DAX 度量与报表投影：
    - 数值卡 = SUM；响应时长/答问比卡 = AVERAGE；净销售额（万）= SUM / 10000；
    - 询单转化率 = 1 - SUM(询单流失人数) / SUM(当日询单人数)；
    - 客单价（客服）= SUM(促成下单商品金额) / SUM(促成下单人数)；
    - 转化率京东客服 = SUM(促成下单人数) / SUM(售前接待人数)；
    - 京东答问比 = SUM(客服总消息数) / SUM(客户总消息数)。
    京东侧带 store 维度：京东自营（工作量/绩效/日报文件夹）与 京东POP（接待数据
    文件夹的 京东pop 高置信日报）分行输出，另用 GROUPING SETS 产出 store=全部
    的合计行，比率类指标在合计行按 SUM/SUM 重算而非简单平均。
    环比由前端对排序后的 daily 数组相邻天相减得到：PBIX 用 DATEADD(-1 day)
    （前一天无数据时返回 0），这里取「上一个有数据的日期」——日期缺口时两者
    口径不同，属于有意取舍，前端以此为准。
    """
    start_iso, end_iso = period_start.isoformat(), period_end.isoformat()
    # 客服三源(天猫/京东/抖音)快照均承载各自全量历史(合计仅数万行,体量小),
    # 不受 POWERBI_PAGE_WINDOW_DAYS=60 滚动窗口限制:period.start 放宽到各源最早数据日,
    # 前端全局筛选即可查到任意历史日(2026-09-10 起,应运营要求)。
    source_queries = {
        "tmall": ("10-1淘宝客服绩效明细",),
        "jd": ("10-2京东客服营销明细", "10-3京东客服绩效数据", "10-4客服员工日报统计"),
        "douyin": ("16-抖音每日客服",),
    }
    # start 取窗口与各源最早数据日的较小者;end 取窗口与各源最晚数据日的较大者——
    # 客服(尤其抖音 T-1 早 8 点导出)可能领先其他来源一天,不能因为生意参谋还没更新
    # 就把客服最新一天挡在快照外(2026-09-11 实测:飞鸽 09-10 已入库但全局 period_end=09-09)。
    bounds: dict[str, tuple[str, str]] = {}
    for key, names in source_queries.items():
        spans = [_customer_source_date_span(connection, name) for name in names]
        lows = [lo for lo, _ in spans if lo and lo < start_iso]
        highs = [hi for _, hi in spans if hi and hi > end_iso]
        bounds[key] = (min(lows) if lows else start_iso, max(highs) if highs else end_iso)
    tmall = _build_tmall_customer_service(connection, *bounds["tmall"])
    jd = _build_jd_customer_service(connection, *bounds["jd"])
    douyin = _build_douyin_customer_service(connection, *bounds["douyin"])
    return {
        "period": {"start": min(b[0] for b in bounds.values()), "end": max(b[1] for b in bounds.values())},
        "tmall": tmall,
        "jd": jd,
        "douyin": douyin,
    }


def _customer_source_date_span(connection: duckdb.DuckDBPyConnection, query_name: str) -> tuple[str | None, str | None]:
    """客服来源表的实际(最早, 最晚)数据日(ISO);视图不存在或无数据返回 (None, None)。"""
    try:
        view = _model_view(connection, query_name)
    except ValueError:
        return None, None
    row = connection.execute(
        f'SELECT min(try_cast("日期" AS DATE)), max(try_cast("日期" AS DATE)) FROM {view}'
    ).fetchone()
    lo = row[0].isoformat() if row and row[0] else None
    hi = row[1].isoformat() if row and row[1] else None
    return lo, hi


def _customer_dedup_sql(view: str, start: str, end: str, keys: tuple[str, ...]) -> str:
    """客服表去重公共子查询：按 (日期, 客服键) 取最新快照行，可作 FROM 别名 dedup。"""
    partition = ", ".join(
        f'try_cast("日期" AS DATE), cast({key} AS VARCHAR)' for key in keys
    )
    return f"""
    (SELECT * EXCLUDE (_snapshot_rank) FROM (
      SELECT *, row_number() OVER (
        PARTITION BY {partition}
        ORDER BY "_source_mtime_ns" DESC, "_source_path" DESC
      ) AS _snapshot_rank
      FROM {view}
      WHERE try_cast("日期" AS DATE) BETWEEN '{start}' AND '{end}'
    ) WHERE _snapshot_rank = 1) AS dedup"""


_TMALL_STRICT_ATOMS = {"满意", "很满意", "收到评价数", "询单人数", "询单最终付款人数", "客服消息条数", "买家消息条数"}


def _build_tmall_customer_service(
    connection: duckdb.DuckDBPyConnection,
    start: str,
    end: str,
) -> dict[str, Any]:
    try:
        view = _model_view(connection, "10-1淘宝客服绩效明细")
    except ValueError:
        return {"daily": [], "byAgent": [], "groups": []}
    columns = _view_columns(connection, view.strip(chr(34)))
    # 新结构（2026-06-29 起）直接提供原子分子分母（询单最终付款人数/询单人数/满意/很满意/收到评价数/客服·买家消息条数），
    # 可严格按列名计算用户口径；旧结构只提供平台预制比率。列齐才走「新=严格 / 旧=预制 按日分叉」，
    # 否则整体回退预制口径并标记 metricsCaliber=precomputed（前端显示「预置口径」角标）。
    use_strict = not _TMALL_STRICT_ATOMS - set(columns)

    if use_strict:
        inquiry_rate = (
            'CASE WHEN max(try_cast("询单最终付款人数" AS DOUBLE)) IS NOT NULL\n'
            "     THEN sum(coalesce(try_cast(\"询单最终付款人数\" AS DOUBLE), 0))\n"
            "          / nullif(sum(coalesce(try_cast(\"询单人数\" AS DOUBLE), 0)), 0)\n"
            '     ELSE 1 - sum(coalesce(try_cast("询单流失人数" AS DOUBLE), 0))\n'
            "              / nullif(sum(coalesce(try_cast(\"当日询单人数\" AS DOUBLE), 0)), 0)\n"
            "     END"
        )
        satisfaction_rate = (
            'CASE WHEN max(try_cast("满意" AS DOUBLE)) IS NOT NULL\n'
            "     THEN (sum(coalesce(try_cast(\"满意\" AS DOUBLE), 0)) + sum(coalesce(try_cast(\"很满意\" AS DOUBLE), 0)))\n"
            "          / nullif(sum(coalesce(try_cast(\"收到评价数\" AS DOUBLE), 0)), 0)\n"
            '     ELSE sum(coalesce(try_cast("客户满意率" AS DOUBLE), 0)\n'
            '              * coalesce(try_cast("有效接待人数" AS DOUBLE), 0))\n'
            '          / nullif(sum(coalesce(try_cast("有效接待人数" AS DOUBLE), 0)), 0)\n'
            "     END"
        )
        answer_ratio = (
            'CASE WHEN max(try_cast("客服消息条数" AS DOUBLE)) IS NOT NULL\n'
            "     THEN sum(coalesce(try_cast(\"客服消息条数\" AS DOUBLE), 0))\n"
            "          / nullif(sum(coalesce(try_cast(\"买家消息条数\" AS DOUBLE), 0)), 0)\n"
            '     ELSE avg(try_cast("淘宝答问比" AS DOUBLE)) END'
        )
        caliber = (
            'CASE WHEN max(try_cast("询单最终付款人数" AS DOUBLE)) IS NOT NULL '
            "THEN 'strict' ELSE 'precomputed' END"
        )
        final_pay_expr = 'sum(coalesce(try_cast("询单最终付款人数" AS DOUBLE), 0)) AS finalPayCusNum'
        consult_expr = 'sum(coalesce(try_cast("询单人数" AS DOUBLE), 0)) AS consultNum'
        evaluation_expr = 'sum(coalesce(try_cast("收到评价数" AS DOUBLE), 0)) AS evaluationNum'
        satisfied_expr = 'sum(coalesce(try_cast("满意" AS DOUBLE), 0)) AS satisfiedNum'
        very_satisfied_expr = 'sum(coalesce(try_cast("很满意" AS DOUBLE), 0)) AS verySatisfiedNum'
        agent_msg_expr = 'sum(coalesce(try_cast("客服消息条数" AS DOUBLE), 0)) AS agentMsgNum'
        buyer_msg_expr = 'sum(coalesce(try_cast("买家消息条数" AS DOUBLE), 0)) AS buyerMsgNum'
    else:
        # 旧结构：保留既有聚合口径（1−流失/询单、接待量加权满意率、平均答问比），仅补齐 metricsCaliber 标记。
        inquiry_rate = "1 - sum(coalesce(try_cast(\"询单流失人数\" AS DOUBLE), 0)) / nullif(sum(coalesce(try_cast(\"当日询单人数\" AS DOUBLE), 0)), 0)"
        satisfaction_rate = (
            'sum(coalesce(try_cast("客户满意率" AS DOUBLE), 0)\n'
            '    * coalesce(try_cast("有效接待人数" AS DOUBLE), 0))\n'
            '  / nullif(sum(coalesce(try_cast("有效接待人数" AS DOUBLE), 0)), 0)'
        )
        answer_ratio = 'avg(try_cast("淘宝答问比" AS DOUBLE))'
        caliber = "'precomputed'"
        final_pay_expr = 'cast(NULL AS DOUBLE) AS finalPayCusNum'
        consult_expr = 'cast(NULL AS DOUBLE) AS consultNum'
        evaluation_expr = 'cast(NULL AS DOUBLE) AS evaluationNum'
        satisfied_expr = 'cast(NULL AS DOUBLE) AS satisfiedNum'
        very_satisfied_expr = 'cast(NULL AS DOUBLE) AS verySatisfiedNum'
        agent_msg_expr = 'cast(NULL AS DOUBLE) AS agentMsgNum'
        buyer_msg_expr = 'cast(NULL AS DOUBLE) AS buyerMsgNum'

    dedup = _customer_dedup_sql(view, start, end, ("旺旺昵称",))
    daily = _records(
        connection,
        f"""
        SELECT
          try_cast("日期" AS DATE) AS date,
          count(DISTINCT cast("旺旺昵称" AS VARCHAR)) AS agentCount,
          sum(coalesce(try_cast("有效接待人数" AS DOUBLE), 0)) AS effectiveReceived,
          sum(coalesce(try_cast("当日询单人数" AS DOUBLE), 0)) AS todayInquiry,
          sum(coalesce(try_cast("销售人数" AS DOUBLE), 0)) AS salesPeople,
          {final_pay_expr},
          {consult_expr},
          {evaluation_expr},
          {satisfied_expr},
          {very_satisfied_expr},
          {agent_msg_expr},
          {buyer_msg_expr},
          sum(coalesce(try_cast("净销售额" AS DOUBLE), 0)) AS netSales,
          avg(try_cast("客单价" AS DOUBLE)) AS unitPrice,
          {inquiry_rate} AS inquiryConversionRate,
          avg(try_cast("首次响应时长（秒)" AS DOUBLE)) AS firstResponse,
          avg(try_cast("平均响应时长（秒)" AS DOUBLE)) AS avgResponse,
          {answer_ratio} AS answerRatio,
          {satisfaction_rate} AS satisfactionRate,
          {caliber} AS metricsCaliber
        FROM {dedup}
        GROUP BY 1 ORDER BY 1
        """,
    )
    by_agent = _records(
        connection,
        f"""
        SELECT
          try_cast("日期" AS DATE) AS date,
          cast("旺旺昵称" AS VARCHAR) AS agent,
          max(cast("旺旺分组" AS VARCHAR)) AS groupName,
          sum(coalesce(try_cast("有效接待人数" AS DOUBLE), 0)) AS effectiveReceived,
          -- 与 daily.netSales 同源：统一用「净销售额」（已扣成功退款），不用毛额「销售额」，
          -- 否则 KPI 卡（净额）与明细表（毛额）在同一页出现两个口径的销售额合计。
          sum(coalesce(try_cast("净销售额" AS DOUBLE), 0)) / 10000 AS netSalesWan,
          {final_pay_expr},
          {consult_expr},
          {evaluation_expr},
          {satisfied_expr},
          {very_satisfied_expr},
          {agent_msg_expr},
          {buyer_msg_expr},
          sum(coalesce(try_cast("首次响应时长（秒)" AS DOUBLE), 0)) AS firstResponse,
          {answer_ratio} AS answerRatio,
          sum(coalesce(try_cast("平均响应时长（秒)" AS DOUBLE), 0)) AS avgResponse,
          sum(coalesce(try_cast("客单价" AS DOUBLE), 0)) AS unitPrice,
          {inquiry_rate} AS inquiryConvRate,
          {satisfaction_rate} AS satisfactionRate,
          {caliber} AS metricsCaliber
        FROM {dedup}
        GROUP BY 1, 2 ORDER BY 1, 2
        """,
    )
    groups = _records(
        connection,
        f"""
        SELECT DISTINCT cast("旺旺分组" AS VARCHAR) AS value
        FROM {view}
        WHERE try_cast("日期" AS DATE) BETWEEN '{start}' AND '{end}'
          AND trim(coalesce(cast("旺旺分组" AS VARCHAR), '')) <> ''
        ORDER BY 1
        """,
    )
    return {
        "daily": daily,
        "byAgent": by_agent,
        "groups": [row["value"] for row in groups],
    }


def _build_douyin_customer_service(
    connection: duckdb.DuckDBPyConnection,
    start: str,
    end: str,
) -> dict[str, Any]:
    """飞鸽「客服数据」导出(16-抖音每日客服):每文件一天,汇总行已在 transforms 剔除。

    时长列在 transforms 解析为秒(在线时长秒/平响秒[工作时间平响]/首响秒),百分比列已转 0-1 小数。
    询单转化率按 SUM(支付人数)/SUM(询单人数) 重算(不用导出列,与天猫口径一致);
    满意率按有效评价数加权;净销售额=退款后销售额(已扣退款),单位元。
    """
    try:
        view = _model_view(connection, "16-抖音每日客服")
    except ValueError:
        return {"daily": [], "byAgent": [], "groups": []}
    dedup = _customer_dedup_sql(view, start, end, ("客服昵称",))
    daily = _records(
        connection,
        f"""
        SELECT
          try_cast("日期" AS DATE) AS date,
          count(DISTINCT CASE WHEN coalesce("在线时长秒", 0) > 0
                THEN cast("客服昵称" AS VARCHAR) END) AS agentCount,
          sum(coalesce("接待会话量", 0)) AS received,
          sum(coalesce("在线时长秒", 0)) AS onlineSeconds,
          sum(coalesce("退款后销售额", 0)) AS netSales,
          sum(coalesce("支付人数", 0)) / nullif(sum(coalesce("询单人数", 0)), 0)
            AS inquiryConvRate,
          sum("全天满意率" * "有效评价数") FILTER (WHERE "全天满意率" IS NOT NULL)
            / nullif(sum("有效评价数") FILTER (WHERE "全天满意率" IS NOT NULL), 0)
            AS satisfactionRate,
          avg("首响秒") AS firstResponse,
          avg("平响秒") AS avgResponse
        FROM {dedup}
        GROUP BY 1 ORDER BY 1
        """,
    )
    by_agent = _records(
        connection,
        f"""
        SELECT
          try_cast("日期" AS DATE) AS date,
          cast("客服昵称" AS VARCHAR) AS agent,
          sum(coalesce("接待会话量", 0)) AS received,
          sum(coalesce("在线时长秒", 0)) AS onlineSeconds,
          sum(coalesce("退款后销售额", 0)) AS netSales,
          sum(coalesce("退款后销售额", 0)) / 10000 AS netSalesWan,
          sum(coalesce("询单人数", 0)) AS inquiryCount,
          sum(coalesce("支付人数", 0)) AS payCount,
          sum(coalesce("有效评价数", 0)) AS evalCount,
          sum(coalesce("支付人数", 0)) / nullif(sum(coalesce("询单人数", 0)), 0)
            AS inquiryConvRate,
          avg("全天满意率") AS satisfactionRate,
          avg("首响秒") AS firstResponse,
          avg("平响秒") AS avgResponse
        FROM {dedup}
        GROUP BY 1, 2 ORDER BY 1, 2
        """,
    )
    return {"daily": daily, "byAgent": by_agent, "groups": []}


def _build_jd_customer_service(
    connection: duckdb.DuckDBPyConnection,
    start: str,
    end: str,
) -> dict[str, Any]:
    try:
        workload_view = _model_view(connection, "10-2京东客服营销明细")
        sales_view = _model_view(connection, "10-3京东客服绩效数据")
        staff_view = _model_view(connection, "10-4客服员工日报统计")
    except ValueError:
        return {"daily": [], "serviceDaily": [], "byAgent": [], "groups": []}
    # 京东pop 日报（接待数据文件夹新高置信格式）写入时带 店铺=京东POP，其余来源兜底京东自营。
    # 店铺列只在存在高置信 POP 分区后才出现在复合视图中，故按列存在性兜底，避免旧分区报错。
    # 注：_model_view 返回已引用的标识符，_view_columns 需要原始表名。
    workload_name = workload_view.strip('"').replace('""', '"')
    sales_name = sales_view.strip('"').replace('""', '"')
    workload_columns = _view_columns(connection, workload_name)
    workload_store = (
        "coalesce(nullif(trim(cast(\"店铺\" AS VARCHAR)), ''), '京东自营')"
        if "店铺" in workload_columns
        else "'京东自营'"
    )
    sales_store = (
        "coalesce(nullif(trim(cast(\"店铺\" AS VARCHAR)), ''), '京东自营')"
        if "店铺" in _view_columns(connection, sales_name)
        else "'京东自营'"
    )
    # POP 日报只有改名后的「新平均响应时间」，自营旧表只有「平均响应时间」；列存在性兜底避免旧分区报错。
    avg_response_expr = (
        'avg(coalesce(try_cast("平均响应时间" AS DOUBLE), try_cast("新平均响应时间" AS DOUBLE)))'
        if "新平均响应时间" in workload_columns
        else 'avg(try_cast("平均响应时间" AS DOUBLE))'
    )
    workload_dedup = _customer_dedup_sql(workload_view, start, end, ("客服",))
    sales_dedup = _customer_dedup_sql(sales_view, start, end, ("客服",))
    # 10-4 真实粒度是 (日期, UID, 技能组)：同一 UID 同日有售前/售后多行，各带独立消息与评价。
    # 去重键必须包含技能组，否则丢约一半消息/评价数据（transforms DEDUPE_KEYS 同口径）。
    staff_dedup = _customer_dedup_sql(staff_view, start, end, ("UID", "技能组"))
    daily = _records(
        connection,
        f"""
        WITH workload AS (
          SELECT
            try_cast("日期" AS DATE) AS date,
            coalesce({workload_store}, '全部') AS store,
            count(DISTINCT cast("客服" AS VARCHAR)) AS agentCount,
            sum(coalesce(try_cast("接待量" AS DOUBLE), 0)) AS received,
            avg(try_cast("首次平均响应时间" AS DOUBLE)) AS firstResponse,
            avg(try_cast("30s应答率" AS DOUBLE)) AS response30s
          FROM {workload_dedup}
          GROUP BY GROUPING SETS ((try_cast("日期" AS DATE), {workload_store}), (try_cast("日期" AS DATE)))
        ), sales AS (
          SELECT
            try_cast("日期" AS DATE) AS date,
            coalesce({sales_store}, '全部') AS store,
            sum(coalesce(try_cast("促成下单商品金额" AS DOUBLE), 0)) AS orderAmount,
            sum(coalesce(try_cast("促成下单人数" AS DOUBLE), 0))
              / nullif(sum(coalesce(try_cast("售前接待人数" AS DOUBLE), 0)), 0)
            AS conversionRate,
            sum(coalesce(try_cast("促成下单商品金额" AS DOUBLE), 0))
              / nullif(sum(coalesce(try_cast("促成下单人数" AS DOUBLE), 0)), 0)
            AS unitPrice
          FROM {sales_dedup}
          GROUP BY GROUPING SETS ((try_cast("日期" AS DATE), {sales_store}), (try_cast("日期" AS DATE)))
        ), staff AS (
          SELECT date, coalesce(store, '全部') AS store, goodReviews, badReviews, answerRatio, satisfactionRate
          FROM (
            SELECT
              try_cast("日期" AS DATE) AS date,
              '京东自营' AS store,
              sum(coalesce(try_cast("好评量" AS DOUBLE), 0)) AS goodReviews,
              sum(coalesce(try_cast("差评量" AS DOUBLE), 0)) AS badReviews,
              sum(coalesce(try_cast("客服总消息数" AS DOUBLE), 0))
                / nullif(sum(coalesce(try_cast("客户总消息数" AS DOUBLE), 0)), 0)
              AS answerRatio,
              sum(coalesce(try_cast("好评量" AS DOUBLE), 0))
                / nullif(
                    sum(coalesce(try_cast("好评量" AS DOUBLE), 0))
                    + sum(coalesce(try_cast("差评量" AS DOUBLE), 0)),
                    0
                  )
              AS satisfactionRate
            FROM {staff_dedup}
            GROUP BY GROUPING SETS ((try_cast("日期" AS DATE), '京东自营'), (try_cast("日期" AS DATE)))
          )
        )
        SELECT
          coalesce(w.date, s.date, st.date) AS date,
          coalesce(w.store, s.store, st.store) AS store,
          coalesce(w.agentCount, 0) AS agentCount,
          coalesce(w.received, 0) AS received,
          w.firstResponse,
          w.response30s,
          coalesce(s.orderAmount, 0) AS orderAmount,
          s.conversionRate, s.unitPrice,
          coalesce(st.goodReviews, 0) AS goodReviews,
          coalesce(st.badReviews, 0) AS badReviews,
          st.answerRatio,
          st.satisfactionRate
        FROM workload w
        FULL OUTER JOIN sales s ON w.date = s.date AND w.store = s.store
        FULL OUTER JOIN staff st ON coalesce(w.date, s.date) = st.date
            AND coalesce(w.store, s.store) = st.store
        ORDER BY 1, 2
        """,
    )
    service_daily = _records(
        connection,
        f"""
        SELECT date, coalesce(store, '全部') AS store, goodReviews, badReviews, answerRatio, satisfactionRate
        FROM (
          SELECT
            try_cast("日期" AS DATE) AS date,
            '京东自营' AS store,
            sum(coalesce(try_cast("好评量" AS DOUBLE), 0)) AS goodReviews,
            sum(coalesce(try_cast("差评量" AS DOUBLE), 0)) AS badReviews,
            sum(coalesce(try_cast("客服总消息数" AS DOUBLE), 0))
              / nullif(sum(coalesce(try_cast("客户总消息数" AS DOUBLE), 0)), 0)
            AS answerRatio,
            sum(coalesce(try_cast("好评量" AS DOUBLE), 0))
              / nullif(
                  sum(coalesce(try_cast("好评量" AS DOUBLE), 0))
                  + sum(coalesce(try_cast("差评量" AS DOUBLE), 0)),
                  0
                )
            AS satisfactionRate
          FROM {staff_dedup}
          GROUP BY GROUPING SETS ((try_cast("日期" AS DATE), '京东自营'), (try_cast("日期" AS DATE)))
        )
        ORDER BY 1, 2
        """,
    )
    by_agent = _records(
        connection,
        f"""
        WITH workload AS (
          SELECT
            try_cast("日期" AS DATE) AS date,
            {workload_store} AS store,
            replace(cast("客服" AS VARCHAR), '-', '') AS agent,
            sum(coalesce(try_cast("接待量" AS DOUBLE), 0)) AS received,
            max(try_cast("首次平均响应时间" AS DOUBLE)) AS firstResponse,
            {avg_response_expr} AS avgResponse
          FROM {workload_dedup}
          GROUP BY 1, 2, 3
        ), sales AS (
          SELECT
            try_cast("日期" AS DATE) AS date,
            {sales_store} AS store,
            replace(cast("客服" AS VARCHAR), '-', '') AS agent,
            sum(coalesce(try_cast("促成下单商品金额" AS DOUBLE), 0)) AS orderAmount,
            sum(coalesce(try_cast("促成下单人数" AS DOUBLE), 0))
              / nullif(sum(coalesce(try_cast("售前接待人数" AS DOUBLE), 0)), 0)
            AS conversionRate
          FROM {sales_dedup}
          GROUP BY 1, 2, 3
        ), staff AS (
          SELECT
            try_cast("日期" AS DATE) AS date,
            '京东自营' AS store,
            replace(cast("UID" AS VARCHAR), '-', '') AS agent,
            max(cast("技能组" AS VARCHAR)) AS skillGroup,
            sum(coalesce(try_cast("好评量" AS DOUBLE), 0)) AS goodReviews,
            sum(coalesce(try_cast("差评量" AS DOUBLE), 0)) AS badReviews,
            sum(coalesce(try_cast("客服总消息数" AS DOUBLE), 0))
              / nullif(sum(coalesce(try_cast("客户总消息数" AS DOUBLE), 0)), 0)
            AS answerRatio,
            sum(coalesce(try_cast("好评量" AS DOUBLE), 0))
              / nullif(
                  sum(coalesce(try_cast("好评量" AS DOUBLE), 0))
                  + sum(coalesce(try_cast("差评量" AS DOUBLE), 0)),
                  0
                )
            AS satisfactionRate
          FROM {staff_dedup}
          GROUP BY 1, 2, 3
        )
        SELECT
          coalesce(w.date, s.date, st.date) AS date,
          coalesce(w.store, s.store, st.store) AS store,
          coalesce(w.agent, s.agent, st.agent) AS agent,
          coalesce(st.skillGroup, '') AS skillGroup,
          coalesce(w.received, 0) AS received,
          coalesce(s.orderAmount, 0) AS orderAmount,
          w.firstResponse, w.avgResponse,
          s.conversionRate, st.answerRatio,
          coalesce(st.goodReviews, 0) AS goodReviews,
          coalesce(st.badReviews, 0) AS badReviews,
          coalesce(st.satisfactionRate, 0) AS satisfactionRate
        FROM workload w
        FULL OUTER JOIN sales s ON w.date = s.date AND w.agent = s.agent AND w.store = s.store
        FULL OUTER JOIN staff st ON coalesce(w.date, s.date) = st.date
            AND coalesce(w.agent, s.agent) = st.agent
            AND coalesce(w.store, s.store) = st.store
        ORDER BY 1, 2, 3
        """,
    )
    groups = _records(
        connection,
        f"""
        SELECT DISTINCT cast("技能组" AS VARCHAR) AS value
        FROM {staff_view}
        WHERE try_cast("日期" AS DATE) BETWEEN '{start}' AND '{end}'
          AND trim(coalesce(cast("技能组" AS VARCHAR), '')) <> ''
        ORDER BY 1
        """,
    )
    return {
        "daily": daily,
        "serviceDaily": service_daily,
        "byAgent": by_agent,
        "groups": [row["value"] for row in groups],
    }


def _month_to_range(month: str) -> tuple[str, str]:
    """自然月字符串 'YYYY-MM' -> (首日, 月末) ISO 日期元组。"""
    y, m = int(month[:4]), int(month[5:7])
    first = date(y, m, 1)
    last = date(y + (m // 12), (m % 12) + 1, 1) - timedelta(days=1)
    return (first.isoformat(), last.isoformat())


def _build_product_management_pages(
    connection: duckdb.DuckDBPyConnection,
    start: str | None = None,
    end: str | None = None,
    statuses: list[str] | None = None,
    channels: list[str] | None = None,
    store_short_names: list[str] | None = None,
    product_codes: list[str] | None = None,
    exclude_product_codes: list[str] | None = None,
    product_ids: list[str] | None = None,
    exclude_product_ids: list[str] | None = None,
) -> dict[str, Any]:
    """聚水潭商品数据看板聚合：商品级销量/毛利/退货 + 床垫类别/渠道交叉矩阵 + 趋势 + 月环比。

    用复刻 PBIX ``Table.Distinct`` 的 model 视图聚合。转换层保留订单唯一键，模型层再移除
    快照元数据后去重，既与 PBIX 的最终订单行集合一致，也不会折叠不同订单。
    start/end（YYYY-MM-DD）为切片器日期范围；statuses、channels、store_short_names 为
    订单状态、渠道平台、店铺简称的多选切片器值（IN 过滤）。product_codes / product_ids
    为商品编码、商品ID 的「仅保留」列表，exclude_* 为排除列表；商品ID 经产品主数据
    （商品编码 ↔ 商品ID）映射后按商品编码过滤。当前订单集合写入连接内临时表，
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
            "previousDailyTrend": [],
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
            "dailyWarehouseMatrix": {"columns": [], "rows": []},
            "dailyShipWarehouseMatrix": {"columns": [], "rows": []},
            "dailyCategoryMatrix": {"columns": [], "rows": []},
            "dailyChannelMarginMatrix": {"columns": [], "rows": []},
            "dailyStatusMatrix": {"columns": [], "rows": []},
            "productChannelMatrix": {"columns": [], "rows": []},
            "productStatusMatrix": {"columns": [], "rows": []},
            "productChannelRevenueMatrix": {"columns": [], "rows": []},
            "productChannelRefundMatrix": {"columns": [], "rows": []},
            "channelStatusMatrix": {"columns": [], "rows": []},
            "channelWarehouseMatrix": {"columns": [], "rows": []},
            "channelCategoryMatrix": {"columns": [], "rows": []},
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

    # 产品主表（提供产品名称、成本、床垫类别），join 聚水潭计算毛利率与各产品分析。
    # 提前到切片器过滤视图创建之前：商品ID 筛选需要先经产品主数据映射成商品编码。
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
    # 商品ID 映射必须用未去重的 source 视图：model 视图按商品编码只保留最新源文件的一行，
    # 同一编码在不同平台文件里的其它 商品ID 会被丢弃，导致按 ID 保留返回空、按 ID 排除静默失效。
    pm_source_view = None
    pm_source_columns: set[str] = set()
    if has_master:
        try:
            pm_source_view = _source_view(connection, "product-master")
            pm_source_columns = {
                row[0] for row in connection.execute(f"DESCRIBE {pm_source_view}").fetchall()
            }
        except ValueError:
            pm_source_view = pm_view
            pm_source_columns = master_columns

    # 日期筛选/聚合维度统一为「付款日期」，与聚水潭导出表 15-聚水潭商品数据 的付款日期口径一致。
    # 履约时效仍按「订单日期」计算（见下方 order_date_expr），发货量图表仍按「发货日期」口径。
    analysis_date = "付款日期" if "付款日期" in source_columns else "订单日期"

    # 切片器过滤：日期范围 + 订单状态 + 渠道平台 + 店铺简称 + 商品范围，
    # 当前集合准备为临时表。上期数据可能落在日期范围之外（如仅选本月时上月为上期），
    # 因此单独保留一份不带日期过滤、但保留其他维度过滤的视图 _jt_filtered_other，供上期查询使用。
    date_filter = None
    date_conds: list[str] = []
    other_conds: list[str] = []
    if start and end and _re.fullmatch(r"\d{4}-\d{2}-\d{2}", start) and _re.fullmatch(r"\d{4}-\d{2}-\d{2}", end):
        date_conds.append(f'"{analysis_date}" >= DATE \'{start}\' AND "{analysis_date}" <= DATE \'{end}\'')
        date_filter = (start, end)
    if statuses:
        escaped = ",".join("'" + s.replace("'", "''") + "'" for s in statuses if s)
        if escaped:
            other_conds.append(f'"订单状态明细" IN ({escaped})')
    if channels and "渠道平台" in source_columns:
        channel_filter = _in_filter("渠道平台", channels)
        if channel_filter:
            other_conds.append(channel_filter)
    if store_short_names and store_short_column:
        store_filter = _in_filter(store_short_column, store_short_names)
        if store_filter:
            other_conds.append(store_filter)

    # 商品范围筛选：商品编码直接过滤订单行；商品ID 先经产品主数据映射成商品编码。
    # 未匹配产品主数据的订单：会被「仅保留ID」筛掉（无法证明属于保留集），
    # 但不会被「排除ID」误删（无法证明属于排除集）。
    def _clean_filter_values(values: list[str] | None) -> list[str]:
        cleaned: list[str] = []
        seen: set[str] = set()
        for value in values or []:
            text = str(value).strip()
            if text and text not in seen:
                seen.add(text)
                cleaned.append(text)
        return cleaned

    def _codes_for_product_ids(values: list[str]) -> list[str] | None:
        """把商品ID 映射成商品编码；产品主数据不可用时返回 None。"""
        if not values:
            return []
        if not pm_source_view or not {"商品编码", "商品ID"}.issubset(pm_source_columns):
            return None
        escaped = ",".join("'" + value.replace("'", "''") + "'" for value in values)
        rows = connection.execute(
            f'SELECT DISTINCT cast("商品编码" AS VARCHAR) FROM {pm_source_view} '
            f"WHERE regexp_replace(trim(cast(\"商品ID\" AS VARCHAR)), '\\.0+$', '') IN ({escaped})"
        ).fetchall()
        return [str(row[0]).strip() for row in rows if row[0] is not None and str(row[0]).strip()]

    def _normalize_product_ids(values: list[str]) -> list[str]:
        # Excel 数值单元格可能把 1001 读成 1001.0；与主数据侧同样去掉末尾 .0。
        return [_re.sub(r"\.0+$", "", value) for value in values]

    scope_include_codes = _clean_filter_values(product_codes)
    scope_exclude_codes = _clean_filter_values(exclude_product_codes)
    scope_include_ids = _normalize_product_ids(_clean_filter_values(product_ids))
    scope_exclude_ids = _normalize_product_ids(_clean_filter_values(exclude_product_ids))

    if scope_include_codes:
        code_filter = _in_filter("商品编码", scope_include_codes) if "商品编码" in source_columns else None
        other_conds.append(code_filter or "FALSE")
    if scope_exclude_codes and "商品编码" in source_columns:
        code_filter = _in_filter("商品编码", scope_exclude_codes)
        if code_filter:
            other_conds.append(f"NOT ({code_filter})")
    if scope_include_ids:
        mapped_codes = _codes_for_product_ids(scope_include_ids)
        id_filter = _in_filter("商品编码", mapped_codes) if mapped_codes and "商品编码" in source_columns else None
        other_conds.append(id_filter or "FALSE")
    if scope_exclude_ids:
        mapped_codes = _codes_for_product_ids(scope_exclude_ids)
        if mapped_codes and "商品编码" in source_columns:
            id_filter = _in_filter("商品编码", mapped_codes)
            if id_filter:
                other_conds.append(f"NOT ({id_filter})")

    # 当前订单集合只准备一次，避免每个聚合重新执行模型去重和源文件扫描。
    # TEMP TABLE 只存在于本连接，read_only 数仓连接同样可用。
    all_conds = date_conds + other_conds
    current_where = f' WHERE {" AND ".join(all_conds)}' if all_conds else ''
    connection.execute(
        f'CREATE OR REPLACE TEMP TABLE _jt_filtered AS SELECT * FROM {base_view}{current_where}'
    )
    view = "_jt_filtered"

    if other_conds:
        connection.execute(
            f'CREATE OR REPLACE TEMP VIEW _jt_filtered_other AS SELECT * FROM {base_view} WHERE {" AND ".join(other_conds)}'
        )
        prev_view = "_jt_filtered_other"
    else:
        prev_view = base_view

    if date_filter:
        period = (start, end)
    else:
        period = connection.execute(
            f'SELECT min("{analysis_date}"), max("{analysis_date}") FROM {view} WHERE "{analysis_date}" IS NOT NULL'
        ).fetchone()
        # 商品范围过滤后可能没有任何订单：展示周期回退到未过滤数据，避免页面误报“尚未同步”。
        if not period or period[0] is None:
            period = connection.execute(
                f'SELECT min("{analysis_date}"), max("{analysis_date}") FROM {base_view} WHERE "{analysis_date}" IS NOT NULL'
            ).fetchone()

    # 期间对比窗口：当期 = 所选日期范围（x 天），上期 = 所选范围前一段等长窗口（x 天）。
    # 例：选 2026-07-01~07-31（31 天），上期 = 2026-05-31~06-30（31 天）。
    # 未选日期时回退到数据中最后两个自然月（首日~月末），保持默认看板行为。
    cur_range: tuple[str, str] | None = None
    prev_range: tuple[str, str] | None = None
    cur_label: str | None = None
    prev_label: str | None = None
    if date_filter:
        try:
            start_d = date.fromisoformat(start)
            end_d = date.fromisoformat(end)
            span = (end_d - start_d).days + 1  # 含首尾天数
            if span > 0:
                cur_range = (start, end)
                cur_label = f"{start_d.strftime('%m.%d')}-{end_d.strftime('%m.%d')}"
                prev_end_d = start_d - timedelta(days=1)
                prev_start_d = prev_end_d - timedelta(days=span - 1)
                prev_range = (prev_start_d.isoformat(), prev_end_d.isoformat())
                prev_label = f"{prev_start_d.strftime('%m.%d')}-{prev_end_d.strftime('%m.%d')}"
        except (ValueError, TypeError):
            cur_range = None
    if cur_range is None:
        months = connection.execute(
            f"""SELECT strftime('%Y-%m', "{analysis_date}") AS month FROM {view}
               WHERE "{analysis_date}" IS NOT NULL GROUP BY 1 ORDER BY 1 DESC LIMIT 3"""
        ).fetchall()
        if months:
            # 校验最新月份是否完整：若该月最大日期 < 月末，回退到上一个完整月
            cur_m = months[0][0]
            max_date_row = connection.execute(
                f'SELECT max("{analysis_date}") FROM {view} WHERE strftime(\'%Y-%m\', "{analysis_date}") = ?',
                [cur_m],
            ).fetchone()
            max_date = max_date_row[0] if max_date_row else None
            if max_date is not None:
                # 判断 max_date 是否是该月最后一天
                import calendar as _cal
                year, mon = map(int, cur_m.split("-"))
                last_day = _cal.monthrange(year, mon)[1]
                if hasattr(max_date, "day"):
                    max_day = max_date.day
                else:
                    max_day = int(str(max_date)[-2:])
                if max_day < last_day and len(months) >= 2:
                    cur_m = months[1][0]  # 回退到上一个完整月
            cur_range = _month_to_range(cur_m)
            cur_label = cur_m
            # 上期 = 当期前一个月
            prev_m_idx = 2 if len(months) > 1 and cur_m == months[1][0] else 1
            if len(months) > prev_m_idx:
                prev_m = months[prev_m_idx][0]
                prev_range = _month_to_range(prev_m)
                prev_label = prev_m

    # 辅4-床垫编码（q18）提供 SPU/尺寸/厚度/是否折叠等富维度，仅作 supplemental join。
    try:
        q18_view = _model_view(connection, "辅4-床垫编码")
        q18_columns = {row[0] for row in connection.execute(f"DESCRIBE {q18_view}").fetchall()}
    except ValueError:
        q18_view = None
        q18_columns = set()
    jd_master_view = pm_source_view
    jd_master_columns = pm_source_columns
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

    total_columns = ("销售金额", "退货金额", "商家实收", "销售数量", "买家实付", "平台补贴金额")
    total_select = ", ".join(
        f'sum(coalesce(try_cast("{column}" AS DOUBLE), 0))' for column in total_columns
    )
    custom_condition = 'coalesce(try_cast("是否定制" AS BOOLEAN), FALSE)' if "是否定制" in source_columns else "FALSE"
    totals = connection.execute(f"""
        SELECT {total_select}, count(DISTINCT "商品编码"), count(*),
               sum(CASE WHEN {custom_condition} THEN coalesce(try_cast("销售数量" AS DOUBLE), 0) ELSE 0 END),
               sum(CASE WHEN cast("订单状态明细" AS VARCHAR) LIKE '%待发货%'
                        THEN coalesce(try_cast("销售数量" AS DOUBLE), 0) ELSE 0 END)
        FROM {view}
    """).fetchone()
    total_values = dict(zip(total_columns, (float(value or 0) for value in totals[:6])))

    def _total(column: str) -> float:
        return total_values[column]

    total_sales = _total("销售金额")
    total_refund = _total("退货金额")
    total_received = _total("商家实收")
    total_sales_units = _total("销售数量")
    product_count = totals[6] or 0
    order_lines = totals[7] or 0
    # 定制率 = 定制销量 / 总销量（是否定制由 transforms.py 从卖家备注推导，对齐 PBI）。
    custom_rate = None
    if "是否定制" in source_columns and total_sales_units:
        custom_sales_units = float(totals[8] or 0)
        custom_rate = round(custom_sales_units / total_sales_units, 4)
    # 待发货件数 = 订单状态明细含「待发货」的销售数量合计（当前过滤期）。上期值在 prev_m 确定后回填。
    pending_units = float(totals[9] or 0)
    # 商品管理统一使用商家实收作为金额口径；回款率 = 商家实收 / 销售金额。
    # 礼品袋、链接等垃圾单已在转换层按 PBIX M 规则置零并过滤；0.01 过滤已于 2026-10-06 取消，0.01 链接订单计入销量口径。
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
        "customRate": custom_rate,
        "pendingUnits": int(pending_units) if pending_units else 0,
        "prevPendingUnits": None,
    }

    # 毛利列片段：毛利额 = 商家实收 - 成本 × 销售数量（与 PBIX 15 查询口径一致）。
    # SKU、趋势和各维度明细统一复用，保证汇总可以从 SKU 逐项复核。
    margin_select = (
        "sum(CASE WHEN pm.\"成本\" IS NOT NULL THEN coalesce(try_cast(s.\"商家实收\" AS DOUBLE),0) "
        "- coalesce(try_cast(pm.\"成本\" AS DOUBLE),0)*coalesce(try_cast(s.\"销售数量\" AS DOUBLE),0) ELSE 0 END) AS grossProfit, "
        "sum(CASE WHEN pm.\"成本\" IS NOT NULL THEN coalesce(try_cast(s.\"商家实收\" AS DOUBLE),0) ELSE 0 END) AS matchedReceived, "
        if has_master else "0 AS grossProfit, 0 AS matchedReceived, "
    )

    sub_name_select = (
        'any_value(coalesce(cast(pm."子名称" AS VARCHAR), \'\')) AS subName'
        if has_master and "子名称" in master_columns
        else "'' AS subName"
    )
    product_overview = _records(
        connection,
        f"""
        SELECT s."商品编码" AS productCode,
               any_value({product_name_expr}) AS productName,
               {sub_name_select},
               any_value(s."产品分类") AS category,
               any_value(s."品牌") AS brand,
               sum(coalesce(try_cast(s."销售数量" AS DOUBLE),0)) AS salesUnits,
               sum(coalesce(try_cast(s."商家实收" AS DOUBLE),0)) AS receivedAmount,
               sum(coalesce(try_cast(s."销售金额" AS DOUBLE),0)) AS salesAmount,
               sum(coalesce(try_cast(s."退货金额" AS DOUBLE),0)) AS refundAmount,
               {margin_select}
               count(*) AS orderLines
        FROM {view} s {pm_join}
        WHERE s."商品编码" IS NOT NULL
        GROUP BY 1 ORDER BY receivedAmount DESC NULLS LAST LIMIT 500000
        """,
    )
    for row in product_overview:
        sales = row.get("salesAmount") or 0
        received = row.get("receivedAmount") or 0
        matched = row.get("matchedReceived") or 0
        gross_profit_row = row.get("grossProfit") or 0
        row["collectionRate"] = round(received / sales, 4) if sales else None
        row["refundRate"] = round(row["refundAmount"] / received, 4) if received else None
        row["grossProfit"] = gross_profit_row if has_master else None
        row["matchedReceived"] = matched if has_master else None
        row["grossMargin"] = round(gross_profit_row / matched, 4) if (has_master and matched > 0) else None
        row["prevReceivedAmount"] = None

    daily_trend = _records(
        connection,
        f"""
        SELECT s."{analysis_date}" AS date,
               sum(coalesce(try_cast(s."商家实收" AS DOUBLE),0)) AS receivedAmount,
               sum(coalesce(try_cast(s."销售数量" AS DOUBLE),0)) AS salesUnits,
               sum(coalesce(try_cast(s."销售金额" AS DOUBLE),0)) AS salesAmount,
               sum(coalesce(try_cast(s."退货金额" AS DOUBLE),0)) AS refundAmount,
               {margin_select}
               count(*) AS orderLines
        FROM {view} s {pm_join}
        WHERE s."{analysis_date}" IS NOT NULL
          AND s."{analysis_date}" >= (SELECT max("{analysis_date}") - INTERVAL 400 DAY FROM {view})
        GROUP BY 1 ORDER BY 1
        """,
    )
    for _row in daily_trend:
        _matched = _row.get("matchedReceived") or 0
        _gp = _row.get("grossProfit") or 0
        _row["grossProfit"] = _gp if has_master else None
        _row["matchedReceived"] = _matched if has_master else None
        _row["grossMargin"] = round(_gp / _matched, 4) if (has_master and _matched > 0) else None

    # 上期每日趋势：取自不带日期过滤的 prev_view，限制到 prev_range，
    # 供总览趋势图按日序对齐上期（第 1 天对第 1 天）。
    if prev_range:
        previous_daily_trend = _records(
            connection,
            f"""
            SELECT s."{analysis_date}" AS date,
                   sum(coalesce(try_cast(s."商家实收" AS DOUBLE),0)) AS receivedAmount,
                   sum(coalesce(try_cast(s."销售数量" AS DOUBLE),0)) AS salesUnits,
                   sum(coalesce(try_cast(s."销售金额" AS DOUBLE),0)) AS salesAmount,
                   sum(coalesce(try_cast(s."退货金额" AS DOUBLE),0)) AS refundAmount,
                   {margin_select}
                   count(*) AS orderLines
            FROM {prev_view} s {pm_join}
            WHERE s."{analysis_date}" IS NOT NULL
              AND s."{analysis_date}" >= CAST(? AS DATE) AND s."{analysis_date}" <= CAST(? AS DATE)
            GROUP BY 1 ORDER BY 1
            """,
            [prev_range[0], prev_range[1]],
        )
        for _row in previous_daily_trend:
            _matched = _row.get("matchedReceived") or 0
            _gp = _row.get("grossProfit") or 0
            _row["grossProfit"] = _gp if has_master else None
            _row["matchedReceived"] = _matched if has_master else None
            _row["grossMargin"] = round(_gp / _matched, 4) if (has_master and _matched > 0) else None
    else:
        previous_daily_trend = []

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

    q18_join = (
        f' LEFT JOIN {q18_view} q18 ON s."商品编码" = q18."商家规编（后台）"'
        if q18_view and "SPU产品商编" in q18_columns and "商家规编（后台）" in q18_columns
        else ""
    )
    spu_expr = (
        "coalesce(nullif(trim(cast(q18.\"SPU产品商编\" AS VARCHAR)), ''), '未识别 SPU')"
        if q18_join
        else "'未识别 SPU'"
    )
    # 重点商品表用去重后的 SPU 子查询，避免 q18 一对多 JOIN 放大 product_name_overview 的金额汇总。
    q18_spu_join = (
        f' LEFT JOIN (SELECT "商家规编（后台）" AS _sku, any_value("SPU产品商编") AS _spu '
        f'FROM {q18_view} WHERE "商家规编（后台）" IS NOT NULL GROUP BY 1) q18s '
        f'ON s."商品编码" = q18s._sku'
        if q18_view and "SPU产品商编" in q18_columns and "商家规编（后台）" in q18_columns
        else ""
    )
    spu_col_expr = (
        "coalesce(nullif(trim(cast(q18s._spu AS VARCHAR)), ''), '未识别 SPU')"
        if q18_spu_join
        else "'未识别 SPU'"
    )
    return_ranking = _records(
        connection,
        f"""
        SELECT any_value({spu_expr}) AS spu,
               {product_name_expr} AS productName,
               sum(coalesce(try_cast(s."退货金额" AS DOUBLE),0)) AS refundAmount,
               sum(coalesce(try_cast(s."商家实收" AS DOUBLE),0)) AS receivedAmount,
               count(*) AS orderLines
        FROM {view} s {pm_join}{q18_join}
        WHERE {product_name_expr} IS NOT NULL
        GROUP BY 2 ORDER BY refundAmount DESC NULLS LAST LIMIT 5000
        """,
    )
    for row in return_ranking:
        received = row.get("receivedAmount") or 0
        row["refundRate"] = round(row["refundAmount"] / received, 4) if received else None

    # 退货维度拆分：渠道/店铺/达人/床垫类别。退款订单 = 订单状态明细含「交易关闭」
    # （仅退款 + 退货退款两个子类，合计贡献 100% 退货金额）。
    # 退货率 = 退货金额/商家实收；退款订单占比 = 交易关闭订单数/订单行。
    has_ship_date = "发货日期" in source_columns
    pre_ship_case = (
        "sum(CASE WHEN coalesce(try_cast(s.\"退货金额\" AS DOUBLE),0) > 0 AND s.\"发货日期\" IS NULL "
        "THEN coalesce(try_cast(s.\"销售数量\" AS DOUBLE),0) ELSE 0 END) AS preShipRefundUnits"
        if has_ship_date else "0 AS preShipRefundUnits"
    )
    def _return_breakdown(dim_expr: str, where: str, join: str = "", limit: int = 50) -> list[dict]:
        rows = _records(
            connection,
            f"""
            SELECT {dim_expr} AS dim,
                   sum(coalesce(try_cast(s."退货金额" AS DOUBLE),0)) AS refundAmount,
                   sum(coalesce(try_cast(s."退货数量" AS DOUBLE),0)) AS refundUnits,
                   sum(CASE WHEN cast(s."订单状态明细" AS VARCHAR) LIKE '%交易关闭%' THEN 1 ELSE 0 END) AS refundOrderCount,
                   sum(coalesce(try_cast(s."商家实收" AS DOUBLE),0)) AS receivedAmount,
                   sum(coalesce(try_cast(s."销售数量" AS DOUBLE),0)) AS salesUnits,
                   sum(CASE WHEN coalesce(try_cast(s."退货金额" AS DOUBLE),0) > 0
                            THEN coalesce(try_cast(s."销售数量" AS DOUBLE),0) ELSE 0 END) AS refundSalesUnits,
                   {pre_ship_case},
                   sum(CASE WHEN coalesce(try_cast(s."退货金额" AS DOUBLE),0) > 0
                            AND coalesce(try_cast(s."退货金额" AS DOUBLE),0) >= coalesce(try_cast(s."商家实收" AS DOUBLE),0)
                            THEN coalesce(try_cast(s."销售数量" AS DOUBLE),0) ELSE 0 END) AS fullRefundUnits,
                   count(*) AS orderLines
            FROM {view} s {join}
            WHERE {where}
            GROUP BY 1 ORDER BY refundAmount DESC NULLS LAST LIMIT {limit}
            """,
        )
        for row in rows:
            received = row.get("receivedAmount") or 0
            order_lines = row.get("orderLines") or 0
            refund_sales_units = row.get("refundSalesUnits") or 0
            row["refundRate"] = round(row["refundAmount"] / received, 4) if received else None
            row["refundOrderShare"] = round(row["refundOrderCount"] / order_lines, 4) if order_lines else None
            row["preShipRefundShare"] = round(row["preShipRefundUnits"] / refund_sales_units, 4) if refund_sales_units else None
            row["fullRefundShare"] = round(row["fullRefundUnits"] / refund_sales_units, 4) if refund_sales_units else None
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
    product_name_overview = _records(
        connection,
        f"""
        SELECT {product_name_expr} AS productName,
               any_value(s."商品编码") AS productCode,
               any_value({spu_col_expr}) AS spu,
               count(DISTINCT {spu_col_expr}) AS _spuCount,
               any_value(s."产品分类") AS category,
               sum(coalesce(try_cast(s."销售数量" AS DOUBLE),0)) AS salesUnits,
               sum(coalesce(try_cast(s."销售金额" AS DOUBLE),0)) AS salesAmount,
               sum(coalesce(try_cast(s."退货金额" AS DOUBLE),0)) AS refundAmount,
               sum(coalesce(try_cast(s."商家实收" AS DOUBLE),0)) AS receivedAmount,
               {margin_select}
               count(*) AS orderLines
        FROM {view} s {pm_join}{q18_spu_join}
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
        row["prevReceivedAmount"] = None  # 上期商家实收，在 prev_m 确定后回填
        row["imageUrl"] = None

    # 商品图匹配：从 05-旗舰店ID照表 按「商家编码」模糊匹配产品 SPU 或产品名称。
    # 匹配策略（按置信度降序）：
    #   1. SPU/产品名称完整精确匹配 (1.0)
    #   2. 分词段精确匹配 (0.95)
    #   3. 子串包含匹配 (0.82-0.92)，纯编码对之间跳过
    #   4. 最长公共子串匹配 (0.7 * 覆盖率)
    #   5. productCode 精确/分词/子串匹配 (0.82-0.95)
    #   5a. productCode 去末尾3位SKU序号提取SPU前缀精确匹配 (0.92)
    #   5b. productCode 长编码前缀匹配（catalog段>=5且剩余全数字）(0.82)
    #   catalog 段额外提取 [a-z]+\d+ 前缀（如 M19坚果 -> m19）
    # 多候选时取最高置信度，且需与次高拉开 >=0.1 差距才采纳。
    try:
        image_catalog_view = _model_view(connection, "05-旗舰店ID对照表")
        image_catalog_columns = {row[0] for row in connection.execute(f"DESCRIBE {image_catalog_view}").fetchall()}
    except ValueError:
        image_catalog_view = None
        image_catalog_columns = set()
    if image_catalog_view and {"商家编码", "商品图片"}.issubset(image_catalog_columns):
        image_rows = _records(
            connection,
            f"""
            SELECT cast("商家编码" AS VARCHAR) AS merchantCode,
                   cast("商品图片" AS VARCHAR) AS imageUrl
            FROM {image_catalog_view}
            WHERE "商家编码" IS NOT NULL AND "商品图片" IS NOT NULL
            """,
        )
        images_by_code: dict[str, set[str]] = {}
        all_segments: list[tuple[str, str]] = []  # (segment, url) 用于模糊匹配
        for image_row in image_rows:
            safe_url = _safe_product_image(image_row.get("imageUrl"))
            merchant_code = str(image_row.get("merchantCode") or "").strip()
            if not safe_url or not merchant_code:
                continue
            segments = {merchant_code.casefold()}
            segments.update(
                segment.strip().casefold()
                for segment in _re.split(r"[/\\|,，;；\s]+", merchant_code)
                if segment.strip()
            )
            # 从混合编码中提取字母+数字前缀（如 M19坚果 -> m19、L05调节枕 -> l05）
            # 使 SPU/分词段精确匹配能命中嵌入中文的编码
            for segment in list(segments):
                for m in _re.finditer(r'[a-z]+\d+', segment):
                    prefix = m.group()
                    if len(prefix) >= 2:
                        segments.add(prefix)
            for segment in segments:
                images_by_code.setdefault(segment, set()).add(safe_url)
                all_segments.append((segment, safe_url))

        def _lcs_len(a: str, b: str) -> int:
            """最长公共子串长度。"""
            if not a or not b:
                return 0
            prev = [0] * (len(b) + 1)
            best = 0
            for i in range(1, len(a) + 1):
                cur = [0] * (len(b) + 1)
                for j in range(1, len(b) + 1):
                    if a[i - 1] == b[j - 1]:
                        cur[j] = prev[j - 1] + 1
                        if cur[j] > best:
                            best = cur[j]
                prev = cur
            return best

        for row in product_name_overview:
            pn = str(row.get("productName") or "").strip().casefold()
            spu = str(row.get("spu") or "").strip().casefold()
            pcode = str(row.get("productCode") or "").strip().casefold()
            scored: dict[str, list[float]] = {}  # url -> [best confidence, match_len]

            def _add(url: str, conf: float, mlen: int = 0) -> None:
                cur = scored.get(url)
                if cur is None or conf > cur[0] or (conf == cur[0] and mlen > cur[1]):
                    scored[url] = [conf, mlen]

            # 1) SPU 精确匹配 (1.0)
            if row.get("_spuCount") == 1 and spu and spu != "未识别 spu":
                for url in images_by_code.get(spu, set()):
                    _add(url, 1.0, len(spu))
            # 1b) MD->M 前缀替换：纯编码产品名 MD5301 -> M5301
            if pn.startswith("md") and pn[2:].isdigit():
                m_variant = "m" + pn[2:]
                for url in images_by_code.get(m_variant, set()):
                    _add(url, 1.0, len(m_variant))
            # 2) 产品名称精确匹配 (1.0)
            if pn:
                for url in images_by_code.get(pn, set()):
                    _add(url, 1.0, len(pn))
                # 3) 分词段精确匹配 (0.95)
                for segment in _re.split(r"[/\\|,，;；\s]+", pn):
                    seg = segment.strip()
                    if not seg or len(seg) < 2:
                        continue
                    for url in images_by_code.get(seg, set()):
                        _add(url, 0.95, len(seg))
                # 4) 子串包含匹配
                #    商家编码段完全出现在产品名称中（seg in pn）：高置信度，不稀释
                #    产品名称完全出现在商家编码段中（pn in seg）：按长度比稀释
                #    当 seg 和 pn 都是纯编码标识符时跳过子串匹配（M521 ≠ M5212）
                _is_code = lambda s: bool(_re.fullmatch(r'[a-z]+\d+\+?', s))
                for seg, url in all_segments:
                    if len(seg) < 2:
                        continue
                    if _is_code(seg) and _is_code(pn):
                        continue  # 两个纯编码之间不做子串包含
                    if seg in pn:
                        # 商家编码段是产品名称的子串 -- 核心词匹配
                        conf = 0.92 if len(seg) >= 4 else 0.82
                        _add(url, conf, len(seg))
                    elif pn in seg:
                        ratio = len(pn) / max(len(seg), 1)
                        _add(url, 0.8 * ratio, len(pn))
                # 5) 最长公共子串匹配 (0.7 * 覆盖率)
                #    中文名称核心词：当产品名与商家编码段共享较长公共子串时，
                #    用「产品名覆盖率 pn_cov = lcs/len(pn)」+「短串覆盖率 core_cov = lcs/min_len」
                #    区分真匹配与泛化描述词。
                #    例：草本苦荞健康睡眠枕 与 草本苦荞枕 -> lc=4, pn_cov=0.44, core_cov=0.80 -> 0.85
                #    长名称（如 麻大师天然黄麻椰棕榈床垫...）pn_cov~0.1，不会命中泛化词。
                for seg, url in all_segments:
                    if len(seg) < 2 or len(pn) < 2:
                        continue
                    lcs = _lcs_len(seg, pn)
                    min_len = min(len(seg), len(pn))
                    if lcs >= max(2, min_len * 0.5):
                        if _has_cjk(pn) and _has_cjk(seg) and lcs >= 3:
                            pn_cov = lcs / max(len(pn), 1)
                            core_cov = lcs / max(min_len, 1)
                            if pn_cov >= 0.4 and core_cov >= 0.6:
                                _add(url, 0.85, lcs)
                            elif pn_cov >= 0.4 and core_cov >= 0.5:
                                _add(url, 0.75, lcs)
                        else:
                            coverage = lcs / max(len(seg), len(pn), 1)
                            _add(url, 0.7 * coverage, lcs)

                # 6) productCode 匹配：从商品编码提取 SPU/SKU 段做精确和子串匹配
                if pcode:
                    # 完整 productCode 精确匹配
                    for url in images_by_code.get(pcode, set()):
                        _add(url, 0.95, len(pcode))
                    # 从 productCode 提取编码段（字母前缀+数字，如 M521、S506）
                    code_segs = _re.findall(r'[a-z]+\d+', pcode)
                    for cs in code_segs:
                        if len(cs) < 2:
                            continue
                        # 精确匹配
                        for url in images_by_code.get(cs, set()):
                            _add(url, 0.92, len(cs))
                        # 6a) 提取 SPU 前缀：去掉数字部分末尾 3 位 SKU 序号
                        #     productCode 格式通常为 <SPU><3位SKU序号><字母><4位尺寸>
                        #     如 M121001A1508 -> SPU M121；M08009A1206 -> SPU M08
                        #     纯编码间靠精确匹配区分（M5213 ≠ M521），不会误匹配
                        m = _re.fullmatch(r'([a-z]+)(\d+)', cs)
                        if m and len(m.group(2)) > 3:
                            spu_from_code = m.group(1) + m.group(2)[:-3]
                            if len(spu_from_code) >= 2:
                                for url in images_by_code.get(spu_from_code, set()):
                                    _add(url, 0.92, len(spu_from_code))
                        # 6b) 长编码前缀匹配：当 catalog 段（纯编码、长度>=5）是 cs 的前缀，
                        #     且剩余部分全为数字时，以 0.82 置信度匹配。
                        #     适用于非标准 productCode 格式，如 JFC002180200 -> JFC002
                        #     长度>=5 确保不误匹配短编码（M521 ≠ M5213、M83 ≠ M831）
                        for seg, url in all_segments:
                            if len(seg) < 5:
                                continue
                            if not _re.fullmatch(r'[a-z]+\d+', seg):
                                continue
                            if cs.startswith(seg) and cs[len(seg):].isdigit():
                                _add(url, 0.82, len(seg))
                        # 子串匹配
                        for seg, url in all_segments:
                            if len(seg) < 2:
                                continue
                            if seg in cs or cs in seg:
                                ratio = min(len(seg), len(cs)) / max(len(seg), len(cs), 1)
                                _add(url, 0.82 * ratio, min(len(seg), len(cs)))

            # 选择最佳候选：按 (置信度, 匹配段长度) 降序排序
            # >=0.80 直接采纳（强匹配：SPU/产品名精确匹配，多候选时取首个）
            # >=0.65 且与次高差距 >=0.03 也采纳（弱匹配需明显领先避免误选）
            if scored:
                ranked = sorted(scored.items(), key=lambda x: (-x[1][0], -x[1][1]))
                if ranked[0][1][0] >= 0.80:
                    row["imageUrl"] = ranked[0][0]
                elif ranked[0][1][0] >= 0.65 and (len(ranked) == 1 or (ranked[0][1][0] - ranked[1][1][0]) >= 0.03):
                    row["imageUrl"] = ranked[0][0]
            row.pop("_spuCount", None)
    else:
        for row in product_name_overview:
            row.pop("_spuCount", None)

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
        SELECT strftime('%Y-%m', s."{analysis_date}") AS month,
               sum(coalesce(try_cast(s."商家实收" AS DOUBLE),0)) AS receivedAmount,
               sum(coalesce(try_cast(s."销售数量" AS DOUBLE),0)) AS salesUnits,
               sum(coalesce(try_cast(s."销售金额" AS DOUBLE),0)) AS salesAmount,
               sum(coalesce(try_cast(s."退货金额" AS DOUBLE),0)) AS refundAmount,
               {margin_select}
               count(*) AS orderLines
        FROM {view} s {pm_join}
        WHERE s."{analysis_date}" IS NOT NULL
        GROUP BY 1 ORDER BY 1
        """,
    )
    for row in monthly_trend:
        received = row.get("receivedAmount") or 0
        matched = row.get("matchedReceived") or 0
        gross_profit = row.get("grossProfit") or 0
        row["refundRate"] = round(row["refundAmount"] / received, 4) if received else None
        if has_master and matched:
            row["grossProfit"] = gross_profit
            row["grossMargin"] = round(gross_profit / matched, 4)
        else:
            row["grossProfit"] = None
            row["grossMargin"] = None

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
            row["prevReceivedAmount"] = None  # 上期商家实收，在 prev_m 确定后回填
    else:
        mattress_category_breakdown = []

    # 期间对比：当期 = cur_range（所选范围或最后完整月），上期 = prev_range（等长前序窗口）。
    # currentPeriod/previousPeriod 暴露精确日期，供前端趋势图按日序对齐。
    monthly_comparison = None
    if cur_range:

        has_is_custom_month = "是否定制" in source_columns
        custom_sales_col = (
            "sum(CASE WHEN coalesce(try_cast(s.\"是否定制\" AS BOOLEAN), FALSE) "
            "THEN coalesce(try_cast(s.\"销售数量\" AS DOUBLE),0) ELSE 0 END) AS customSales"
            if has_is_custom_month else "0 AS customSales"
        )
        def _range_totals(rng: tuple[str, str] | None, query_view: str) -> dict[str, Any]:
            if not rng:
                return {}
            if query_view == view and rng == date_filter:
                row = (
                    total_received, total_sales, total_refund, total_sales_units,
                    order_lines, margin[0] if has_master else 0,
                    margin[1] if has_master else 0, totals[8],
                )
            else:
                row = connection.execute(
                    f"""
                    SELECT
                      sum(coalesce(try_cast(s."商家实收" AS DOUBLE),0)) AS receivedAmount,
                      sum(coalesce(try_cast(s."销售金额" AS DOUBLE),0)) AS salesAmount,
                      sum(coalesce(try_cast(s."退货金额" AS DOUBLE),0)) AS refundAmount,
                      sum(coalesce(try_cast(s."销售数量" AS DOUBLE),0)) AS salesUnits,
                      count(*) AS orderLines,
                      {margin_select}
                      {custom_sales_col}
                    FROM {query_view} s {pm_join}
                    WHERE s."{analysis_date}" >= CAST(? AS DATE) AND s."{analysis_date}" <= CAST(? AS DATE)
                    """,
                    [rng[0], rng[1]],
                ).fetchone()
            received = float(row[0] or 0)
            refund = float(row[2] or 0)
            sales_units = float(row[3] or 0)
            gross_profit = float(row[5] or 0)
            matched = float(row[6] or 0)
            custom_sales = float(row[7] or 0)
            return {
                "receivedAmount": received,
                "salesAmount": float(row[1] or 0),
                "refundAmount": refund,
                "salesUnits": sales_units,
                "orderLines": int(row[4] or 0),
                "netSales": received - refund,
                "grossProfit": gross_profit if has_master else None,
                "grossMargin": round(gross_profit / matched, 4) if (has_master and matched > 0) else None,
                "avgUnitPrice": round(received / sales_units, 2) if sales_units > 0 else None,
                "customRate": round(custom_sales / sales_units, 4) if (has_is_custom_month and sales_units > 0) else None,
                "refundRate": round(refund / received, 4) if received > 0 else None,
            }

        cur = _range_totals(cur_range, view)
        prev = _range_totals(prev_range, prev_view)
        if cur:
            def _delta(key: str) -> float | None:
                if not prev or prev.get(key) is None or prev[key] == 0 or cur.get(key) is None:
                    return None
                return round((cur[key] - prev[key]) / prev[key], 4)
            monthly_comparison = {
                "currentMonth": cur_label, "previousMonth": prev_label,
                "currentPeriod": {"start": cur_range[0], "end": cur_range[1]},
                "previousPeriod": {"start": prev_range[0], "end": prev_range[1]} if prev_range else None,
                "current": cur, "previous": prev,
                "deltas": {k: _delta(k) for k in cur},
            }

    # 上期补充字段：待发货件数上期、床垫类别/重点商品的上期商家实收。
    # 复用 monthlyComparison 的 prev_range 等长窗口口径，保证筛选视图下上期同口径。
    if prev_range:
        prev_pending_row = connection.execute(
            f"""SELECT sum(coalesce(try_cast(s."销售数量" AS DOUBLE), 0)) AS pendingUnits
                FROM {prev_view} s
                WHERE cast(s."订单状态明细" AS VARCHAR) LIKE '%待发货%'
                  AND s."{analysis_date}" >= CAST(? AS DATE) AND s."{analysis_date}" <= CAST(? AS DATE)""",
            [prev_range[0], prev_range[1]],
        ).fetchone()
        prev_pending_val = float(prev_pending_row[0] or 0) if prev_pending_row else 0.0
        kpis["prevPendingUnits"] = int(prev_pending_val) if prev_pending_val else 0

        if product_overview:
            sku_prev_rows = _records(
                connection,
                f"""SELECT s."商品编码" AS productCode,
                       sum(coalesce(try_cast(s."商家实收" AS DOUBLE), 0)) AS prevReceivedAmount
                FROM {prev_view} s
                WHERE s."商品编码" IS NOT NULL
                  AND s."{analysis_date}" >= CAST(? AS DATE) AND s."{analysis_date}" <= CAST(? AS DATE)
                GROUP BY 1""",
                [prev_range[0], prev_range[1]],
            )
            sku_prev_map = {
                row["productCode"]: float(row.get("prevReceivedAmount") or 0)
                for row in sku_prev_rows
            }
            for row in product_overview:
                row["prevReceivedAmount"] = sku_prev_map.get(row["productCode"])

        if has_master and mattress_category_breakdown:
            cat_prev_rows = _records(
                connection,
                f"""SELECT pm."床垫类别" AS category,
                       sum(coalesce(try_cast(s."商家实收" AS DOUBLE), 0)) AS prevReceivedAmount
                FROM {prev_view} s {pm_join}
                WHERE pm."床垫类别" IS NOT NULL AND trim(cast(pm."床垫类别" AS VARCHAR)) <> ''
                  AND s."{analysis_date}" >= CAST(? AS DATE) AND s."{analysis_date}" <= CAST(? AS DATE)
                GROUP BY 1""",
                [prev_range[0], prev_range[1]],
            )
            cat_prev_map = {row["category"]: float(row.get("prevReceivedAmount") or 0) for row in cat_prev_rows}
            for row in mattress_category_breakdown:
                row["prevReceivedAmount"] = cat_prev_map.get(row["category"])

        if product_name_overview:
            name_prev_rows = _records(
                connection,
                f"""SELECT {product_name_expr} AS productName,
                       sum(coalesce(try_cast(s."商家实收" AS DOUBLE), 0)) AS prevReceivedAmount
                FROM {prev_view} s {pm_join}
                WHERE {product_name_expr} <> '(未命名)'
                  AND s."{analysis_date}" >= CAST(? AS DATE) AND s."{analysis_date}" <= CAST(? AS DATE)
                GROUP BY 1""",
                [prev_range[0], prev_range[1]],
            )
            name_prev_map = {row["productName"]: float(row.get("prevReceivedAmount") or 0) for row in name_prev_rows}
            for row in product_name_overview:
                row["prevReceivedAmount"] = name_prev_map.get(row["productName"])

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

    daily_window = "" if date_filter else f"AND s.\"{analysis_date}\" >= (SELECT max(\"{analysis_date}\") - INTERVAL 30 DAY FROM {view})"
    daily_channel_matrix = _matrix(
        connection,
        f"""
        PIVOT (
          SELECT cast(s."{analysis_date}" AS VARCHAR) AS row, {channel_expr} AS channel,
                 coalesce(try_cast(s."销售数量" AS DOUBLE),0) AS units
          FROM {view} s
          WHERE s."{analysis_date}" IS NOT NULL
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
          SELECT cast(s."{analysis_date}" AS VARCHAR) AS row,
                 coalesce(cast(s."订单状态明细" AS VARCHAR), '(未知)') AS status,
                 coalesce(try_cast(s."销售数量" AS DOUBLE),0) AS units
          FROM {view} s
          WHERE s."{analysis_date}" IS NOT NULL
            {daily_window}
        ) ON status USING sum(units) ORDER BY row
        """,
        "row",
    )

    # 每日 × 发货仓销量（用于每日经营趋势下方的折线图）
    if "发货仓" in source_columns:
        daily_warehouse_matrix = _matrix(
            connection,
            f"""
            PIVOT (
              SELECT cast(s."{analysis_date}" AS VARCHAR) AS row,
                      coalesce(cast(s."发货仓" AS VARCHAR), '(未设定)') AS warehouse,
                      coalesce(try_cast(s."销售数量" AS DOUBLE),0) AS units
              FROM {view} s
              WHERE s."{analysis_date}" IS NOT NULL
                {daily_window}
            ) ON warehouse USING sum(units) ORDER BY row
            """,
            "row",
        )
    else:
        daily_warehouse_matrix = {"columns": [], "rows": []}

    # 每日 × 发货仓发货量（纯发货日期口径，用于仓配履约折线图）。
    # 全局日期范围直接作用于发货日期：基于 prev_view（保留状态/渠道/店铺筛选、不带订单日期过滤），
    # 避免订单日期窗口把"下单早、发货晚"的长周期订单（如定制床架）截断；未发货订单（发货日期为空）不计入。
    if "发货仓" in source_columns and "发货日期" in source_columns:
        ship_date_cast = 'try_cast(s."发货日期" AS DATE)'
        if date_filter:
            ship_window = (
                f"AND {ship_date_cast} >= DATE '{date_filter[0]}' "
                f"AND {ship_date_cast} <= DATE '{date_filter[1]}'"
            )
        else:
            ship_window = (
                f"AND {ship_date_cast} >= "
                f"(SELECT max(try_cast(\"发货日期\" AS DATE)) - INTERVAL 30 DAY FROM {prev_view})"
            )
        daily_ship_warehouse_matrix = _matrix(
            connection,
            f"""
            PIVOT (
              SELECT cast({ship_date_cast} AS VARCHAR) AS row,
                      coalesce(cast(s."发货仓" AS VARCHAR), '(未设定)') AS warehouse,
                      coalesce(try_cast(s."销售数量" AS DOUBLE),0) AS units
              FROM {prev_view} s
              WHERE {ship_date_cast} IS NOT NULL
                {ship_window}
            ) ON warehouse USING sum(units) ORDER BY row
            """,
            "row",
        )
    else:
        daily_ship_warehouse_matrix = {"columns": [], "rows": []}

    # 每日 × 床垫类别销量（用于产品分类分布时间序列折线图，空白归"其他"）
    # 床垫类别取自辅4-床垫编码(q18)的大类（弹簧床垫/黄麻薄垫等），与 size_structure 优先级一致
    if q18_view and "床垫类别" in q18_columns:
        daily_category_matrix = _matrix(
            connection,
            f"""
            PIVOT (
              SELECT cast(s."{analysis_date}" AS VARCHAR) AS row,
                      coalesce(nullif(trim(cast(q18."床垫类别" AS VARCHAR)), ''), '其他') AS category,
                      coalesce(try_cast(s."销售数量" AS DOUBLE),0) AS units
              FROM {view} s LEFT JOIN {q18_view} q18 ON s."商品编码" = q18."商家规编（后台）"
              WHERE s."{analysis_date}" IS NOT NULL
                {daily_window}
            ) ON category USING sum(units) ORDER BY row
            """,
            "row",
        )
    else:
        daily_category_matrix = {"columns": [], "rows": []}

    # 每日 × 渠道毛利率（毛利额/匹配行商家实收，对齐 margin_select 口径）
    if has_master and "渠道平台" in source_columns:
        gp_matrix = _matrix(
            connection,
            f"""
            PIVOT (
              SELECT cast(s."{analysis_date}" AS VARCHAR) AS row, {channel_expr} AS channel,
                     CASE WHEN pm."成本" IS NOT NULL THEN coalesce(try_cast(s."商家实收" AS DOUBLE),0)
                          - coalesce(try_cast(pm."成本" AS DOUBLE),0)*coalesce(try_cast(s."销售数量" AS DOUBLE),0) ELSE 0 END AS v
              FROM {view} s {pm_join}
              WHERE s."{analysis_date}" IS NOT NULL {daily_window}
            ) ON channel USING sum(v) ORDER BY row
            """,
            "row",
        )
        mr_matrix = _matrix(
            connection,
            f"""
            PIVOT (
              SELECT cast(s."{analysis_date}" AS VARCHAR) AS row, {channel_expr} AS channel,
                     CASE WHEN pm."成本" IS NOT NULL THEN coalesce(try_cast(s."商家实收" AS DOUBLE),0) ELSE 0 END AS v
              FROM {view} s {pm_join}
              WHERE s."{analysis_date}" IS NOT NULL {daily_window}
            ) ON channel USING sum(v) ORDER BY row
            """,
            "row",
        )
        gp_by_row = {r["rowKey"]: r for r in gp_matrix["rows"]}
        margin_rows: list[dict[str, Any]] = []
        for mr_row in mr_matrix["rows"]:
            gp_row = gp_by_row.get(mr_row["rowKey"], {"values": {}, "total": 0})
            values: dict[str, Any] = {}
            for col in mr_matrix["columns"]:
                gp = gp_row["values"].get(col, 0)
                mr = mr_row["values"].get(col, 0)
                values[col] = round(gp / mr, 4) if mr > 0 else None
            total_gp = gp_row["total"]
            total_mr = mr_row["total"]
            margin_rows.append({
                "rowKey": mr_row["rowKey"],
                "values": values,
                "total": round(total_gp / total_mr, 4) if total_mr > 0 else None,
            })
        daily_channel_margin_matrix = {"columns": mr_matrix["columns"], "rows": margin_rows}
    else:
        daily_channel_margin_matrix = {"columns": [], "rows": []}

    # 产品 × 渠道只聚合一次，三个矩阵共用分组结果并各自保持原列排序。
    connection.execute(f"""
        CREATE OR REPLACE TEMP TABLE _jt_product_channel AS
        SELECT {product_name_expr} AS row, {channel_expr} AS channel,
               sum(coalesce(try_cast(s."销售数量" AS DOUBLE), 0)) AS units,
               sum(coalesce(try_cast(s."商家实收" AS DOUBLE), 0)) AS revenue,
               sum(coalesce(try_cast(s."退货金额" AS DOUBLE), 0)) AS refund
        FROM {view} s {pm_join}
        WHERE {product_name_expr} <> '(未命名)'
        GROUP BY 1, 2
    """)
    product_channel_matrix, product_channel_revenue_matrix, product_channel_refund_matrix = (
        _matrix(connection, f"PIVOT (SELECT row, channel, {metric} FROM _jt_product_channel) ON channel USING sum({metric}) ORDER BY row", "row")
        for metric in ("units", "revenue", "refund")
    )

    # 产品名称 × 订单状态（产品主数据口径，全量）
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
            GROUP BY 1 ORDER BY sum(coalesce(try_cast("销售数量" AS DOUBLE),0)) DESC
          )
        ) ON status USING sum(units) ORDER BY row
        """,
        "row",
    )

    # 渠道平台 × 订单状态明细（销售数量）
    if "渠道平台" in source_columns:
        channel_status_matrix = _matrix(
            connection,
            f"""
            PIVOT (
              SELECT {channel_expr} AS row,
                     coalesce(cast(s."订单状态明细" AS VARCHAR), '(未知)') AS status,
                     coalesce(try_cast(s."销售数量" AS DOUBLE),0) AS units
              FROM {view} s
              WHERE s."渠道平台" IS NOT NULL OR s."订单状态明细" IS NOT NULL
            ) ON status USING sum(units) ORDER BY row
            """,
            "row",
        )
    else:
        channel_status_matrix = {"columns": [], "rows": []}

    # 渠道平台 × 发货仓（销售数量）
    channel_warehouse_matrix = _matrix(
        connection,
        f"""
        PIVOT (
          SELECT {channel_expr} AS row,
                 coalesce(cast(s."发货仓" AS VARCHAR), '(未设定)') AS warehouse,
                 coalesce(try_cast(s."销售数量" AS DOUBLE),0) AS units
          FROM {view} s
          WHERE s."发货仓" IS NOT NULL
        ) ON warehouse USING sum(units) ORDER BY row
        """,
        "row",
    )

    # 渠道平台 × 床垫类别（销售数量，复用 product-master 口径）
    if has_master:
        channel_category_matrix = _matrix(
            connection,
            f"""
            PIVOT (
              SELECT {channel_expr} AS row,
                     pm."床垫类别" AS category,
                     coalesce(try_cast(s."销售数量" AS DOUBLE),0) AS units
              FROM {view} s {pm_join}
              WHERE pm."床垫类别" IS NOT NULL AND trim(cast(pm."床垫类别" AS VARCHAR)) <> ''
            ) ON category USING sum(units) ORDER BY row
            """,
            "row",
        )
    else:
        channel_category_matrix = {"columns": [], "rows": []}

    return {
        "source": "jushuitan_local_logic",
        "period": {"start": period[0], "end": period[1]} if period and period[0] else None,
        "kpis": kpis,
        "productOverview": product_overview,
        "productNameOverview": product_name_overview,
        "dailyTrend": daily_trend,
        "previousDailyTrend": previous_daily_trend,
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
        "fulfillmentByProductHierarchy": _fulfillment_hierarchy(
            connection, view, pm_join, product_name_expr, order_id_expr,
            order_date_expr, ship_date_expr, has_master, master_columns, fulfillment_by_product
        ),
        "monthlyComparison": monthly_comparison,
        "categoryChannelMatrix": category_channel_matrix,
        "warehouseStatusMatrix": warehouse_status_matrix,
        "dailyChannelMatrix": daily_channel_matrix,
        "dailyWarehouseMatrix": daily_warehouse_matrix,
        "dailyShipWarehouseMatrix": daily_ship_warehouse_matrix,
        "dailyCategoryMatrix": daily_category_matrix,
        "dailyChannelMarginMatrix": daily_channel_margin_matrix,
        "dailyStatusMatrix": daily_status_matrix,
        "productChannelMatrix": product_channel_matrix,
        "productStatusMatrix": product_status_matrix,
        "productStatusHierarchy": _product_status_hierarchy(
            connection, view, pm_join, product_name_expr, has_master, master_columns
        ),
        "productChannelRevenueMatrix": product_channel_revenue_matrix,
        "productChannelRefundMatrix": product_channel_refund_matrix,
        "channelStatusMatrix": channel_status_matrix,
        "channelWarehouseMatrix": channel_warehouse_matrix,
        "channelCategoryMatrix": channel_category_matrix,
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
            # 客服每日看板复刻后，powerbiPages.customerService 暴露按 (日期, 客服) 聚合的
            # 客服效能指标（昵称/绩效），不含买家隐私明细；原始客服源行仍不暴露。
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
    _prune_analytics_snapshots(connection)
    return snapshot


def _prune_analytics_snapshots(connection: duckdb.DuckDBPyConnection) -> None:
    """快照历史保留策略：服务端只读 analytics-snapshot.json，本表仅作审计留痕；
    单份 snapshot_json 约 10MB，逐次追加（每日 3 次同步）会让 duckdb 无限膨胀，
    因此只保留最近 ANALYTICS_SNAPSHOT_KEEP 份，超出的旧快照随每次同步清理。"""
    connection.execute(
        f"""
        DELETE FROM analytics_snapshots
        WHERE refreshed_at < (
          SELECT MIN(refreshed_at) FROM (
            SELECT refreshed_at FROM analytics_snapshots
            ORDER BY refreshed_at DESC LIMIT {ANALYTICS_SNAPSHOT_KEEP}
          )
        )
        """
    )


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
        if spec.source_kind == "postgres":
            results.append(_sync_postgres_query(paths, spec, state, options, progress))
        else:
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
        "quarantinedFiles": sum(len(item.get("quarantined", [])) for item in results),
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
