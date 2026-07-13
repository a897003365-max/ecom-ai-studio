from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ColumnSpec:
    name: str
    m_type: str


@dataclass(frozen=True)
class QuerySpec:
    index: int
    name: str
    m_file: str
    source_kind: str
    source_paths: tuple[Path, ...]
    sheet_name: str | None
    promote_headers: bool
    schema: tuple[ColumnSpec, ...]
    operations: tuple[str, ...]

    @property
    def key(self) -> str:
        digest = hashlib.sha1(self.name.encode("utf-8")).hexdigest()[:10]
        return f"q{self.index:02d}_{digest}"

    @property
    def view_name(self) -> str:
        return f"source_{self.key}"


def load_catalog(path: Path) -> tuple[dict[str, Any], list[QuerySpec]]:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    queries = []
    for index, item in enumerate(manifest["queries"], start=1):
        queries.append(
            QuerySpec(
                index=index,
                name=item["name"],
                m_file=item["mFile"],
                source_kind=item["sourceKind"],
                source_paths=tuple(Path(value) for value in item["sourcePaths"]),
                sheet_name=item.get("sheetName"),
                promote_headers=bool(item.get("promoteHeaders")),
                schema=tuple(ColumnSpec(value["column"], value["mType"]) for value in item.get("schema", [])),
                operations=tuple(item.get("operations", [])),
            )
        )
    return manifest, queries
