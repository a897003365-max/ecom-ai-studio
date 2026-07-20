from __future__ import annotations

import argparse
import json
import sys

import duckdb

from .config import WarehousePaths
from .warehouse import SyncOptions, _build_product_management_pages, sync_warehouse, warehouse_status


def _progress(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=False, default=str), file=sys.stderr, flush=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Ecom AI Studio local warehouse")
    subparsers = parser.add_subparsers(dest="command", required=True)
    sync = subparsers.add_parser("sync", help="Incrementally synchronize local files")
    sync.add_argument("--query", action="append", dest="queries", help="Only synchronize one named M query; repeatable")
    sync.add_argument("--max-files-per-query", type=int, default=None, help="Use newest N source files for a bounded validation run")
    sync.add_argument("--force", action="store_true", help="Rebuild unchanged partitions")
    subparsers.add_parser("status", help="Show warehouse state")
    qp = subparsers.add_parser("query-products", help="Query product management dashboard aggregations (on-demand date filter)")
    qp.add_argument("--start", default=None, help="Start date YYYY-MM-DD (inclusive)")
    qp.add_argument("--end", default=None, help="End date YYYY-MM-DD (inclusive)")
    qp.add_argument("--status", action="append", dest="statuses", default=None, help="订单状态筛选（可重复）")
    qp.add_argument("--channel", action="append", dest="channels", default=None, help="渠道平台筛选（可重复）")
    qp.add_argument("--store-short-name", action="append", dest="store_short_names", default=None, help="店铺简称筛选（可重复）")
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    if arguments.command == "status":
        print(json.dumps(warehouse_status(), ensure_ascii=False, indent=2, default=str))
        return 0
    if arguments.command == "query-products":
        paths = WarehousePaths.discover()
        connection = duckdb.connect(str(paths.database), read_only=True)
        try:
            pages = _build_product_management_pages(
                connection,
                start=arguments.start,
                end=arguments.end,
                statuses=arguments.statuses,
                channels=arguments.channels,
                store_short_names=arguments.store_short_names,
            )
        finally:
            connection.close()
        sys.stdout.buffer.write(json.dumps({"productManagement": pages}, ensure_ascii=False, default=str).encode("utf-8"))
        return 0
    options = SyncOptions(
        query_names=frozenset(arguments.queries) if arguments.queries else None,
        max_files_per_query=arguments.max_files_per_query,
        force=arguments.force,
    )
    result = sync_warehouse(options, progress=_progress)
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
