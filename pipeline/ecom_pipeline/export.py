"""每日 9:45 同步 + 导出聚水潭商品数据到 Excel。

设计目标
=========

* 一次原子操作：sync 失败 → 绝不写文件；export 失败 → 旧文件保持不变
* 输出文件固定名 ``15-聚水潭商品数据.xlsx``，每次覆盖
* 失败有可观察信号：``local-data/runtime/jushuitan-export-health.json``

注意
----

* 只导出 15-聚水潭商品数据这一个 query；其它 24 个 query 由既有的
  ``EcomAIStudio-Warehouse-Sync`` 任务（11:00 / 18:00）负责
* 这里 ``model_q26_9a71536c9f`` 是 Python 派生后的宽表（48 列，含 14
  个原 PBIX 没有的列：店铺简称、渠道平台、订单状态汇总、是否定制等）
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import duckdb
import xlsxwriter

from .config import WarehousePaths

# 与 ecom_pipeline.warehouse._model_view 中的命名保持一致
QUERY_NAME = "15-聚水潭商品数据"
MODEL_VIEW = "model_q26_9a71536c9f"
DEFAULT_TARGET = Path(r"D:\麻大师\日更数据\商品管理\15-聚水潭商品数据.xlsx")


@dataclass(frozen=True)
class ExportResult:
    ok: bool
    query: str
    target: str
    rows: int
    columns: int
    file_size: int
    duration_seconds: float
    error: str | None = None
    max_payment_date: str | None = None
    data_fresh: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _atomic_write_xlsx(target: Path, build_workbook: Callable[["xlsxwriter.Workbook"], None]) -> Path:
    """写出到 target，但只在 build_workbook 完整跑完后才替换旧文件。

    业务约束
    --------
    每天 9:45 覆盖一个固定文件。如果直接 ``target.write_bytes(...)``，中途崩溃会留下
    损坏的 Excel，下游打开就崩。必须做到：

    1. 写出过程使用 target 同目录下的临时文件 ``<target>.<pid>.tmp``
    2. build_workbook 抛出任何异常时，**清理临时文件并保留旧 target**
    3. build_workbook 正常返回后，**原子替换**（OS 级 rename，不能 truncate+write）

    build_workbook 签名
    -------------------
    ``build_workbook(xlsxwriter.Workbook) -> None`` — 调用方在传入的 wb 上 add_worksheet / write。

    返回
    ----
    最终落盘的 target 路径（让调用方能 stat 取大小）。
    """
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target.with_name(f"{target.name}.{os.getpid()}.tmp")
    try:
        # xlsxwriter 自身没有 atomic 模式，需要我们控制临时文件路径
        with xlsxwriter.Workbook(str(temp_path)) as workbook:
            build_workbook(workbook)
        # 原子替换：temp_path 与 target 同目录 → 同文件系统 → os.replace 是 OS 级原子操作
        os.replace(temp_path, target)
        return target
    except BaseException:
        # build_workbook 或 os.replace 失败 → 清掉临时文件，旧 target 保持不变
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass
        raise


def _write_dataframe(workbook: "xlsxwriter.Workbook", df) -> None:
    """把 polars DataFrame 写到 workbook 唯一一张工作表（query 名称）。

    日期列（Date/Datetime dtype）用 write_datetime + ``yyyy-mm-dd`` 数字格式写出，
    这样 WPS/Excel 打开显示短日期而不是序列号。
    """
    import datetime as _dt

    import pandas as pd

    worksheet = workbook.add_worksheet(QUERY_NAME)
    date_format = workbook.add_format({"num_format": "yyyy-mm-dd"})
    for column_index, column_name in enumerate(df.columns):
        worksheet.write(0, column_index, column_name)
    # 判断哪些列是日期（polars Date / Datetime）
    date_columns = {
        i for i, dtype in enumerate(df.dtypes) if str(dtype).startswith(("Date", "Datetime"))
    }
    # astype(object).where(notna, None) 是为了避开 xlsxwriter 对 NaT/NaN 的硬编码路径
    pandas_frame = df.to_pandas()
    nullable_frame = pandas_frame.astype(object).where(pd.notna(pandas_frame), None)
    for row_index, row in enumerate(nullable_frame.itertuples(index=False, name=None), start=1):
        for column_index, value in enumerate(row):
            if value is None:
                worksheet.write_blank(row_index, column_index, None)
            elif column_index in date_columns:
                # Date/datetime 值 → 短日期格式
                if isinstance(value, _dt.datetime):
                    worksheet.write_datetime(row_index, column_index, value, date_format)
                elif isinstance(value, _dt.date):
                    worksheet.write_datetime(
                        row_index, column_index,
                        _dt.datetime(value.year, value.month, value.day),
                        date_format,
                    )
                else:
                    worksheet.write(row_index, column_index, value)
            else:
                worksheet.write(row_index, column_index, value)


def _encrypt_xlsx_with_com(src: Path, dst: Path, open_password: str, write_password: str) -> None:
    """用 Excel/WPS COM 把无密码 src 加密另存到 dst（打开密码 + 编辑密码）。

    - 优先 Excel.Application；失败回退 WPS 表格 KET.Application
    - src 是无密码文件 → COM 打开不弹密码框（带打开密码的文件 COM 打开会卡死）
    - S4U 计划任务（session 0）下 COM 已验证可用（Visible=False 不可见运行）
    - dst 与 src 须在同一文件系统（后续 os.replace 需要原子性）
    """
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    last_error: Exception | None = None
    for progid in ("Excel.Application", "KET.Application"):
        app = None
        try:
            app = win32com.client.Dispatch(progid)
            app.Visible = False
            app.DisplayAlerts = False
            workbook = app.Workbooks.Open(str(src), ReadOnly=False)
            try:
                workbook.SaveAs(
                    str(dst),
                    FileFormat=51,  # xlOpenXMLWorkbook = .xlsx
                    Password=open_password,
                    WriteResPassword=write_password,
                )
            finally:
                workbook.Close(SaveChanges=False)
            return
        except Exception as error:  # noqa: PERF203
            last_error = error
        finally:
            if app is not None:
                try:
                    app.Quit()
                except Exception:
                    pass
    raise RuntimeError(f"COM 加密另存失败（Excel/WPS 均不可用）: {last_error}")


def export_jushuitan_to_xlsx(
    target: Path | str | None = None,
    *,
    open_password: str | None = None,
    write_password: str | None = None,
) -> ExportResult:
    """按 PBIX ``15-聚水潭商品数据`` 的 M 逻辑生成 39 列并导出到 target 路径。

    传 ``open_password`` / ``write_password`` 时输出带文档加密的 xlsx
    （打开密码 + 编辑密码），否则输出普通 xlsx。

    数据源改为 :func:`jushuitan39.build_jushuitan_39`（复现 PBIX M 的 39 列），
    不再使用旧的 DuckDB model_q26 48 列视图。
    """
    from .jushuitan39 import build_jushuitan_39

    target_path = Path(target) if target else DEFAULT_TARGET

    started = time.time()
    try:
        frame = build_jushuitan_39()
    except FileNotFoundError as error:
        return ExportResult(
            ok=False,
            query=QUERY_NAME,
            target=str(target_path),
            rows=0,
            columns=0,
            file_size=0,
            duration_seconds=time.time() - started,
            error=str(error),
        )

    if frame.height == 0:
        return ExportResult(
            ok=False,
            query=QUERY_NAME,
            target=str(target_path),
            rows=0,
            columns=frame.width,
            file_size=0,
            duration_seconds=time.time() - started,
            error="39 列转换结果为空，源文件无数据",
        )

    target_path.parent.mkdir(parents=True, exist_ok=True)
    if open_password:
        # 加密路径：明文临时 → COM 加密到临时2 → os.replace 原子替换
        plain_path = target_path.with_name(f"{target_path.name}.{os.getpid()}.plain")
        encrypted_path = target_path.with_name(f"{target_path.name}.{os.getpid()}.enc")
        try:
            _atomic_write_xlsx(plain_path, lambda workbook: _write_dataframe(workbook, frame))
            _encrypt_xlsx_with_com(plain_path, encrypted_path, open_password, write_password or "")
            os.replace(encrypted_path, target_path)
        except BaseException:
            for leftover in (plain_path, encrypted_path):
                try:
                    leftover.unlink()
                except FileNotFoundError:
                    pass
            raise
        finally:
            for leftover in (plain_path, encrypted_path):
                if leftover.exists():
                    leftover.unlink()
    else:
        _atomic_write_xlsx(target_path, lambda workbook: _write_dataframe(workbook, frame))

    duration = time.time() - started
    # 数据新鲜度：最新付款日期是否已到"昨天"（否则源文件/导出滞后，需通知）
    from datetime import date, timedelta

    max_payment, data_fresh = None, True
    if "付款日期" in frame.columns:
        max_value = frame["付款日期"].drop_nulls().max()
        if max_value is not None:
            max_payment = str(max_value)[:10]
            yesterday = date.today() - timedelta(days=1)
            data_fresh = max_value >= yesterday
    return ExportResult(
        ok=True,
        query=QUERY_NAME,
        target=str(target_path),
        rows=frame.height,
        columns=frame.width,
        file_size=target_path.stat().st_size,
        duration_seconds=duration,
        max_payment_date=max_payment,
        data_fresh=data_fresh,
    )


def write_health(result: ExportResult, health_path: Path) -> None:
    """把执行结果写到 health 文件，给 /api/health 暴露状态。"""
    health_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "status": "success" if result.ok else "failed",
        "query": result.query,
        "target": result.target,
        "rows": result.rows,
        "columns": result.columns,
        "fileSize": result.file_size,
        "durationSeconds": round(result.duration_seconds, 3),
        "finishedAt": datetime.now().isoformat(timespec="seconds"),
        "error": result.error,
    }
    temp = health_path.with_suffix(f".{os.getpid()}.tmp")
    temp.write_text(
        __import__("json").dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temp, health_path)


def failure_result(target: Path | str, error: str) -> ExportResult:
    """构造一个 ok=False 的 ExportResult，用于 sync 短路、源文件缺失等场景。"""
    target_path = Path(target)
    return ExportResult(
        ok=False,
        query=QUERY_NAME,
        target=str(target_path),
        rows=0,
        columns=0,
        file_size=target_path.stat().st_size if target_path.exists() else 0,
        duration_seconds=0.0,
        error=error,
    )
