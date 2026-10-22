from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecom_pipeline.warehouse import (  # noqa: E402
    ANALYTICS_SNAPSHOT_KEEP,
    _prune_analytics_snapshots,
)


class AnalyticsSnapshotRetentionTests(unittest.TestCase):
    def _connection_with_snapshots(self, count: int) -> duckdb.DuckDBPyConnection:
        connection = duckdb.connect()
        connection.execute(
            """
            CREATE TABLE analytics_snapshots (
              refreshed_at TIMESTAMPTZ,
              period_start DATE,
              period_end DATE,
              record_count BIGINT,
              snapshot_json JSON
            )
            """
        )
        base = datetime(2026, 9, 1, 11, 0, 0, tzinfo=timezone.utc)
        for index in range(count):
            connection.execute(
                "INSERT INTO analytics_snapshots VALUES (?, NULL, NULL, 1, ?)",
                [base + timedelta(hours=index), f'{{"seq": {index}}}'],
            )
        return connection

    def test_prune_keeps_only_recent_snapshots(self) -> None:
        connection = self._connection_with_snapshots(ANALYTICS_SNAPSHOT_KEEP + 5)
        _prune_analytics_snapshots(connection)
        remaining = connection.execute(
            "SELECT snapshot_json::VARCHAR FROM analytics_snapshots ORDER BY refreshed_at"
        ).fetchall()
        self.assertEqual(len(remaining), ANALYTICS_SNAPSHOT_KEEP)
        # 保留的是最新 ANALYTICS_SNAPSHOT_KEEP 份（seq 5-11），最旧的 5 份被清理
        self.assertEqual([int(row[0].split(":")[1].rstrip("}")) for row in remaining], list(range(5, 12)))
        connection.close()

    def test_prune_is_noop_when_under_limit(self) -> None:
        connection = self._connection_with_snapshots(ANALYTICS_SNAPSHOT_KEEP - 1)
        _prune_analytics_snapshots(connection)
        count = connection.execute("SELECT COUNT(*) FROM analytics_snapshots").fetchone()[0]
        self.assertEqual(count, ANALYTICS_SNAPSHOT_KEEP - 1)
        connection.close()


if __name__ == "__main__":
    unittest.main()
