from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Iterable

import pandas as pd
import polars as pl

from .catalog import QuerySpec

SUPPORTED_SUFFIXES = {".csv", ".xls", ".xlsx"}
HEADERLESS_QUERIES = {"03-1-各渠道目标金额"}
ALL_SHEETS_QUERIES = {"07-旗舰店商品销售数据"}


class SourceReadError(RuntimeError):
    """Raised when a local source file cannot be decoded."""


def discover_files(paths: Iterable[Path]) -> list[Path]:
    files: list[Path] = []
    for source in paths:
        if source.is_file() and source.suffix.lower() in SUPPORTED_SUFFIXES:
            files.append(source)
            continue
        if not source.exists():
            continue
        files.extend(
            path
            for path in source.rglob("*")
            if path.is_file()
            and path.suffix.lower() in SUPPORTED_SUFFIXES
            and not path.name.startswith(("~$", "."))
        )
    return sorted(set(files), key=lambda path: str(path).lower())


def _detect_text_encoding(path: Path) -> str:
    sample = path.read_bytes()[:65536]
    if sample.startswith((b"\xff\xfe", b"\xfe\xff")):
        return "utf-16"
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            sample.decode(encoding)
            return encoding
        except UnicodeDecodeError:
            continue
    return "gb18030"


def _detect_separator(path: Path, encoding: str) -> str:
    sample = path.read_bytes()[:16384].decode(encoding, errors="replace")
    try:
        return csv.Sniffer().sniff(sample, delimiters=",\t;|").delimiter
    except csv.Error:
        return "\t" if sample.count("\t") > sample.count(",") else ","


def _clean_column(value: object, index: int) -> str:
    text = str(value).strip().replace("\r\n", "#(lf)").replace("\n", "#(lf)").replace("\r", "#(lf)")
    if not text or text.lower().startswith("unnamed:") or re.fullmatch(r"\d+", text):
        return f"Column{index + 1}"
    return text


def _unique_columns(values: Iterable[object]) -> list[str]:
    counts: dict[str, int] = {}
    columns = []
    for index, value in enumerate(values):
        base = _clean_column(value, index)
        count = counts.get(base, 0)
        counts[base] = count + 1
        columns.append(base if count == 0 else f"{base}.{count}")
    return columns


def _pandas_to_polars(frame: pd.DataFrame) -> pl.DataFrame:
    frame = frame.where(pd.notna(frame), None)
    frame.columns = _unique_columns(frame.columns)
    try:
        return pl.from_pandas(frame, include_index=False, nan_to_null=True)
    except Exception:
        safe = frame.copy()
        for column in safe.columns:
            safe[column] = safe[column].map(lambda value: None if value is None else str(value))
        return pl.from_pandas(safe, include_index=False, nan_to_null=True)


def _read_csv(path: Path) -> pl.DataFrame:
    encoding = _detect_text_encoding(path)
    separator = _detect_separator(path, encoding)
    if encoding in {"utf-8", "utf-8-sig"}:
        try:
            frame = pl.read_csv(
                path,
                separator=separator,
                encoding="utf8-lossy",
                infer_schema_length=0,
                ignore_errors=True,
                truncate_ragged_lines=True,
                null_values=["", "null", "NULL", "--"],
            )
            frame.columns = _unique_columns(frame.columns)
            return frame
        except Exception:
            pass
    frame = pd.read_csv(
        path,
        sep=separator,
        encoding=encoding,
        dtype=object,
        on_bad_lines="skip",
        low_memory=False,
    )
    return _pandas_to_polars(frame)


def _looks_like_html(path: Path) -> bool:
    prefix = path.read_bytes()[:512].lstrip().lower()
    return prefix.startswith((b"<html", b"<!doctype", b"<table")) or b"<table" in prefix


def _read_excel(path: Path, spec: QuerySpec) -> list[tuple[str, pl.DataFrame]]:
    header = None if spec.name in HEADERLESS_QUERIES else 0
    if _looks_like_html(path):
        tables = pd.read_html(path, header=header, encoding=_detect_text_encoding(path))
        return [("Table1", _pandas_to_polars(frame)) for frame in tables[:1]]

    sheet_name: str | int | None = spec.sheet_name or 0
    if spec.name in ALL_SHEETS_QUERIES:
        sheet_name = None
    try:
        result = pd.read_excel(path, sheet_name=sheet_name, header=header, dtype=object)
    except Exception as error:
        raise SourceReadError(f"无法读取 {path.name}: {error}") from error
    if isinstance(result, dict):
        return [(name, _pandas_to_polars(frame)) for name, frame in result.items()]
    return [(str(sheet_name), _pandas_to_polars(result))]


def read_source_file(path: Path, spec: QuerySpec) -> pl.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        frames = [("CSV", _read_csv(path))]
    elif suffix in {".xls", ".xlsx"}:
        frames = _read_excel(path, spec)
    else:
        raise SourceReadError(f"不支持的文件类型：{suffix}")

    prepared = []
    for sheet, frame in frames:
        if frame.width == 0:
            continue
        prepared.append(
            frame.with_columns(
                pl.lit(path.name).alias("Source.Name"),
                pl.lit(sheet).alias("_source_sheet"),
            )
        )
    if not prepared:
        return pl.DataFrame({"Source.Name": [], "_source_sheet": []})
    return pl.concat(prepared, how="diagonal_relaxed")
