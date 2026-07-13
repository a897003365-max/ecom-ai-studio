from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecom_pipeline.warehouse import POWERBI_PAGE_WINDOW_DAYS, _build_powerbi_pages  # noqa: E402


class PowerBiPageContractTests(unittest.TestCase):
    def test_replica_uses_a_bounded_daily_window(self) -> None:
        self.assertEqual(POWERBI_PAGE_WINDOW_DAYS, 60)

    def test_replica_builder_is_callable(self) -> None:
        self.assertTrue(callable(_build_powerbi_pages))


if __name__ == "__main__":
    unittest.main()
