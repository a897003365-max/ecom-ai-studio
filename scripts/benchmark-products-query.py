"""Read-only product payload benchmark; local copied warehouse, no sync or API writes."""
from __future__ import annotations

import argparse
import cProfile
import importlib.util
import json
import inspect
from pathlib import Path
import pstats
import sys
import time

import duckdb


class TimedConnection:
    def __init__(self, connection):
        self.connection = connection
        self.queries = []

    def execute(self, sql, *args, **kwargs):
        caller = inspect.currentframe().f_back
        begin = time.perf_counter()
        result = self.connection.execute(sql, *args, **kwargs)
        self.queries.append({'seconds': time.perf_counter() - begin,
                             'file': Path(caller.f_code.co_filename).name,
                             'line': caller.f_lineno,
                             'sql': ' '.join(sql.split())[:500]})
        return result

    def __getattr__(self, name):
        return getattr(self.connection, name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, default=Path('pipeline/ecom_pipeline'))
    parser.add_argument('--warehouse', type=Path, default=Path('local-data/warehouse'))
    parser.add_argument('--source-warehouse', help='Original absolute warehouse path stored in copied Parquet views; only temporary view bindings are rewritten')
    parser.add_argument('--start')
    parser.add_argument('--end')
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--profile', action='store_true')
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('ecom_pipeline', args.package / '__init__.py', submodule_search_locations=[str(args.package.resolve())])
    package = importlib.util.module_from_spec(spec)
    sys.modules['ecom_pipeline'] = package
    spec.loader.exec_module(package)
    from ecom_pipeline.warehouse import _build_product_management_pages
    args.output.mkdir(parents=True, exist_ok=True)
    measurements = []
    for run in range(args.runs):
        with duckdb.connect(str(args.warehouse / 'ecom.duckdb'), read_only=True) as connection:
            # Stored views refer to the source machine's E: drive. Temporary views
            # bind the same SQL to this isolated copy without changing the database.
            views = connection.execute('SELECT view_name, sql FROM duckdb_views() WHERE NOT internal').fetchall()
            for name, sql in views:
                if 'read_parquet(' in sql:
                    sql = sql.replace('CREATE VIEW ', 'CREATE OR REPLACE TEMP VIEW ', 1)
                    if args.source_warehouse:
                        sql = sql.replace(args.source_warehouse.replace('\\', '/'), args.warehouse.resolve().as_posix())
                    connection.execute(sql)
            profile = cProfile.Profile()
            timed_connection = TimedConnection(connection)
            begin = time.perf_counter()
            if args.profile:
                profile.enable()
            payload = _build_product_management_pages(timed_connection, start=args.start, end=args.end)
            if args.profile:
                profile.disable()
            elapsed = time.perf_counter() - begin
            measurements.append(elapsed)
            (args.output / f'queries-{run + 1}.json').write_text(json.dumps(timed_connection.queries, ensure_ascii=False), encoding='utf-8')
            (args.output / f'payload-{run + 1}.json').write_text(json.dumps(payload, ensure_ascii=False, default=str), encoding='utf-8')
            if args.profile:
                with (args.output / f'profile-{run + 1}.txt').open('w', encoding='utf-8') as stream:
                    pstats.Stats(profile, stream=stream).sort_stats('cumulative').print_stats(50)
            print(json.dumps({'run': run + 1, 'seconds': elapsed}), flush=True)
    (args.output / 'timings.json').write_text(json.dumps(measurements), encoding='utf-8')


if __name__ == '__main__':
    main()
