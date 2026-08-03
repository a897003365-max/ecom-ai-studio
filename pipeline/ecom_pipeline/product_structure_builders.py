"""商品管理新增四模块 builder：价格 / 尺寸 / SPU 销量 / 定制结构（推导）。

从 warehouse.py 的 _build_product_management_pages 拆出，避免巨函数继续膨胀。
Phase 1：仅返回空结构与模块边界，4 个 builder 待 Phase 2+ 逐步填充。

数据安全约束（Phase 0 审计已验证）：
- q18（辅4-床垫编码）按 ``商家规编（后台）`` 是唯一 key（8055 行 0 重复 0 维度冲突）。
- q18 LEFT JOIN 订单事实不放大订单行、销售数量、商家实收。
- 订单行覆盖率 90.1%，超过 80% 阈值，无需降级；但模块仍返回 coverage 供 UI 展示。
- 定制信号极弱（颜色规格定制/异形/缺角 关键词几乎为 0），定制模块标注推导降级。
"""
from __future__ import annotations

from typing import Any

import duckdb
import re


def _empty_quality(warnings: list[str] | None = None) -> dict[str, Any]:
    return {
        "status": "unavailable",
        "coverage": None,
        "warnings": warnings or ["模块未实现"],
    }


def empty_price_structure() -> dict[str, Any]:
    return {
        "buckets": [],
        "channelMatrix": {"columns": [], "rows": []},
        "mattressCategoryMatrix": {"columns": [], "rows": []},
        "topProductMatrix": {"columns": [], "rows": []},
        "validOrderLines": 0,
        "excludedOrderLines": 0,
        "totalReceivedAmount": 0,
        "formula": "商家实收 / 销售数量",
        "quality": _empty_quality(["价格结构模块未实现"]),
    }


def empty_size_structure() -> dict[str, Any]:
    return {
        "sizes": [],
        "unknownSize": {
            "size": "未填写尺寸",
            "source": "unknown",
            "orderLines": 0,
            "orderLineShare": 0,
            "salesUnits": 0,
            "receivedAmount": 0,
            "receivedAmountShare": 0,
        },
        "mattressCategoryMatrix": {"columns": [], "rows": []},
        "topProductMatrix": {"columns": [], "rows": []},
        "recognizedOrderLines": 0,
        "totalOrderLines": 0,
        "quality": _empty_quality(["尺寸结构模块未实现"]),
    }


def empty_spu_sales_trend() -> dict[str, Any]:
    return {
        "spuChannelMatrix": {"columns": [], "rows": []},
        "dailySpuTrend": [],
        "categoryDailyTrend": [],
        "availableSpus": [],
        "defaultSpus": [],
        "summaries": [],
        "quality": _empty_quality(["SPU 销量趋势模块未实现"]),
    }


def empty_customization_structure() -> dict[str, Any]:
    return {
        "comparison": [],
        "categoryStructure": [],
        "tags": [],
        "topProducts": [],
        "derivationNote": "基于颜色规格与辅4-床垫编码(q18)字段推导，不等同于 ERP 原生定制字段。",
        "quality": _empty_quality(["定制结构模块未实现"]),
    }


PRICE_BUCKETS: list[tuple[str, str]] = [
    ("LE_1000", "1000以下"),
    ("1001_1500", "1001–1500"),
    ("1501_2000", "1501–2000"),
    ("2001_2500", "2001–2500"),
    ("2501_3000", "2501–3000"),
    ("3001_4000", "3001–4000"),
    ("GT_4000", "4000以上"),
]
PRICE_BUCKET_LABELS = [label for _, label in PRICE_BUCKETS]


def _price_bucket_case(recv_expr: str, qty_expr: str) -> str:
    ratio = f"{recv_expr} / greatest({qty_expr}, 1)"
    return (
        "CASE "
        f"WHEN {ratio} <= 1000 THEN '1000以下' "
        f"WHEN {ratio} <= 1500 THEN '1001–1500' "
        f"WHEN {ratio} <= 2000 THEN '1501–2000' "
        f"WHEN {ratio} <= 2500 THEN '2001–2500' "
        f"WHEN {ratio} <= 3000 THEN '2501–3000' "
        f"WHEN {ratio} <= 4000 THEN '3001–4000' "
        "ELSE '4000以上' END"
    )


def _fetch_records(
    connection: duckdb.DuckDBPyConnection,
    sql: str,
    params: list | None = None,
) -> list[dict[str, Any]]:
    cur = connection.execute(sql, params or [])
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def _pivot_share_matrix(
    cells: list[dict[str, Any]],
    row_keys: list[str],
    bucket_labels: list[str],
) -> dict[str, Any]:
    """把 (rowKey, bucket, n) 三元组透视为占比矩阵；每行分母为该行订单行合计。"""
    lookup: dict[tuple[str, str], int] = {}
    row_totals: dict[str, int] = {}
    for c in cells:
        key = (c["rowKey"], c["bucket"])
        lookup[key] = lookup.get(key, 0) + int(c["n"])
        row_totals[c["rowKey"]] = row_totals.get(c["rowKey"], 0) + int(c["n"])
    rows = []
    for rk in row_keys:
        total = row_totals.get(rk, 0)
        shares = {bl: (lookup.get((rk, bl), 0) / total) if total > 0 else 0 for bl in bucket_labels}
        rows.append({"rowKey": rk, "orderLines": total, "shares": shares})
    return {"columns": list(bucket_labels), "rows": rows}


def _pivot_count_matrix(
    cells: list[dict[str, Any]],
    row_keys: list[str],
    col_keys: list[str],
) -> dict[str, Any]:
    """把 (rowKey, col, n) 三元组透视为数量矩阵；values 为数量，total 为行合计。"""
    lookup: dict[tuple[str, str], float] = {}
    row_totals: dict[str, float] = {}
    for c in cells:
        key = (c["rowKey"], c["col"])
        lookup[key] = lookup.get(key, 0) + float(c["n"])
        row_totals[c["rowKey"]] = row_totals.get(c["rowKey"], 0) + float(c["n"])
    rows = []
    for rk in row_keys:
        total = row_totals.get(rk, 0)
        values = {ck: lookup.get((rk, ck), 0) for ck in col_keys}
        rows.append({"rowKey": rk, "values": values, "total": total})
    return {"columns": list(col_keys), "rows": rows}


def build_price_structure(
    connection: duckdb.DuckDBPyConnection,
    view: str,
    base_view: str,
    pm_view: str | None,
    pm_columns: set[str],
    q18_view: str | None,
    q18_columns: set[str],
) -> dict[str, Any]:
    """价格结构：单件实收价 7 档分桶 + 渠道/床垫类别/TOP15 产品占比矩阵。

    单件实收价 = 商家实收 / 销售数量；只纳入商家实收>0 且销售数量>0 的订单行。
    无效行（NULL/非正）计入 excludedOrderLines，不进入任何占比分母。
    """
    recv = 'try_cast(s."商家实收" AS DOUBLE)'
    qty = 'try_cast(s."销售数量" AS DOUBLE)'
    bucket_expr = _price_bucket_case(recv, qty)
    valid_cte = f"""
      WITH valid AS (
        SELECT
          s."商品编码" AS code,
          coalesce(nullif(trim(cast(s."渠道平台" AS VARCHAR)), ''), '(未设定)') AS channel,
          {recv} AS recv, {qty} AS qty, {bucket_expr} AS bucket
        FROM {view} s
        WHERE {recv} > 0 AND {qty} > 0
      )
    """

    totals = _fetch_records(
        connection,
        f"""
        SELECT
          count(*) AS total_lines,
          sum(CASE WHEN try_cast("商家实收" AS DOUBLE) > 0 AND try_cast("销售数量" AS DOUBLE) > 0 THEN 1 ELSE 0 END) AS valid_lines,
          coalesce(sum(CASE WHEN try_cast("商家实收" AS DOUBLE) > 0 AND try_cast("销售数量" AS DOUBLE) > 0 THEN try_cast("商家实收" AS DOUBLE) ELSE 0 END), 0) AS total_recv
        FROM {view}
        """,
    )[0]
    valid_lines = int(totals["valid_lines"] or 0)
    total_recv = float(totals["total_recv"] or 0)
    # 用 total - valid 计算 excluded，避开 SQL 三值逻辑下 NOT(NULL) 不命中的问题。
    excluded = int(totals["total_lines"] or 0) - valid_lines

    bucket_map: dict[str, dict[str, Any]] = {}
    channel_cells: list[dict[str, Any]] = []
    if valid_lines > 0:
        bucket_map = {r["bucket"]: r for r in _fetch_records(
            connection,
            f"{valid_cte} SELECT bucket, count(*) AS order_lines, sum(qty) AS sales_units, sum(recv) AS received_amount FROM valid GROUP BY bucket",
        )}
        channel_cells = _fetch_records(
            connection,
            f"{valid_cte} SELECT channel AS \"rowKey\", bucket, count(*) AS n FROM valid GROUP BY 1, 2",
        )

    buckets = []
    for code, label in PRICE_BUCKETS:
        r = bucket_map.get(label)
        ol = int(r["order_lines"]) if r else 0
        su = float(r["sales_units"]) if r else 0
        ra = float(r["received_amount"]) if r else 0
        buckets.append({
            "bucket": code,
            "label": label,
            "orderLines": ol,
            "orderLineShare": (ol / valid_lines) if valid_lines > 0 else 0,
            "salesUnits": su,
            "receivedAmount": ra,
            "receivedAmountShare": (ra / total_recv) if total_recv > 0 else 0,
        })

    channel_keys = sorted({c["rowKey"] for c in channel_cells})
    channel_matrix = _pivot_share_matrix(channel_cells, channel_keys, PRICE_BUCKET_LABELS)

    cat_matrix: dict[str, Any] = {"columns": list(PRICE_BUCKET_LABELS), "rows": []}
    if pm_view and "床垫类别" in pm_columns and valid_lines > 0:
        cat_cells = _fetch_records(
            connection,
            f"""
            {valid_cte}
            SELECT coalesce(nullif(trim(cast(pm."床垫类别" AS VARCHAR)), ''), '(未分类)') AS "rowKey",
                   v.bucket, count(*) AS n
            FROM valid v LEFT JOIN {pm_view} pm ON v.code = pm."商品编码"
            GROUP BY 1, 2
            """,
        )
        cat_keys = sorted({c["rowKey"] for c in cat_cells})
        cat_matrix = _pivot_share_matrix(cat_cells, cat_keys, PRICE_BUCKET_LABELS)

    top_matrix: dict[str, Any] = {"columns": list(PRICE_BUCKET_LABELS), "rows": []}
    if pm_view and "产品名称" in pm_columns and valid_lines > 0:
        top_order_rows = _fetch_records(
            connection,
            f"""
            {valid_cte}
            SELECT coalesce(nullif(trim(cast(pm."产品名称" AS VARCHAR)), ''), '(未分类)') AS product,
                   sum(v.recv) AS total
            FROM valid v LEFT JOIN {pm_view} pm ON v.code = pm."商品编码"
            GROUP BY 1 ORDER BY 2 DESC LIMIT 15
            """,
        )
        top_keys = [r["product"] for r in top_order_rows]
        if top_keys:
            top_cells = _fetch_records(
                connection,
                f"""
                {valid_cte}
                SELECT coalesce(nullif(trim(cast(pm."产品名称" AS VARCHAR)), ''), '(未分类)') AS "rowKey",
                       v.bucket, count(*) AS n
                FROM valid v LEFT JOIN {pm_view} pm ON v.code = pm."商品编码"
                GROUP BY 1, 2
                """,
            )
            top_matrix = _pivot_share_matrix(top_cells, top_keys, PRICE_BUCKET_LABELS)

    status = "ready" if valid_lines > 0 else "unavailable"
    warnings: list[str] = [] if valid_lines > 0 else ["当前筛选范围无有效价格数据"]
    return {
        "buckets": buckets,
        "channelMatrix": channel_matrix,
        "mattressCategoryMatrix": cat_matrix,
        "topProductMatrix": top_matrix,
        "validOrderLines": valid_lines,
        "excludedOrderLines": excluded,
        "totalReceivedAmount": total_recv,
        "formula": "商家实收 / 销售数量",
        "quality": {"status": status, "coverage": None, "warnings": warnings},
    }


_SIZE_RE = re.compile(r"(\d{3,4})\s*(mm|cm)?\s*[×xX\*]\s*(\d{3,4})\s*(mm|cm)?", re.IGNORECASE)


def _normalize_size(raw: Any) -> str | None:
    """把原始尺寸字符串标准化为 `宽×长mm`；无法识别返回 None。

    统一分隔符 ×、去空格、cm 转 mm、宽×长排序。要求两边都是 3-4 位数字，
    过滤枕头等三围规格。支持 `1800MM*2000MM`、`180*200CM`、`1500mm*2000mm`。
    """
    if not raw:
        return None
    match = _SIZE_RE.search(str(raw))
    if not match:
        return None
    a, b = int(match.group(1)), int(match.group(3))
    unit = (match.group(2) or match.group(4) or "mm").lower()
    if unit == "cm":
        a, b = a * 10, b * 10
    width, length = min(a, b), max(a, b)
    return f"{width}×{length}mm"


def build_size_structure(
    connection: duckdb.DuckDBPyConnection,
    view: str,
    base_view: str,
    pm_view: str | None,
    pm_columns: set[str],
    q18_view: str | None,
    q18_columns: set[str],
) -> dict[str, Any]:
    """尺寸结构：q18 -> q27 -> 颜色规格优先级 + 类别/TOP15 占比矩阵。

    尺寸来源优先级：q18.尺寸 -> q27.尺寸 -> 颜色规格正则 -> 未填写尺寸。
    标准化为 `宽×长mm`；低频尺寸（<0.5% 订单行）并入"其他尺寸"列。
    占比分母含未填写尺寸，使各尺寸订单行占比加总为 1。
    """
    has_q18 = bool(q18_view and "尺寸" in q18_columns and "商家规编（后台）" in q18_columns)
    has_pm = bool(pm_view and "商品编码" in pm_columns)
    q18_size_expr = 'trim(cast(q18."尺寸" AS VARCHAR))' if has_q18 else "NULL::VARCHAR"
    pm_size_expr = 'trim(cast(pm."尺寸" AS VARCHAR))' if (has_pm and "尺寸" in pm_columns) else "NULL::VARCHAR"
    pm_cat_expr = 'pm."床垫类别"' if (has_pm and "床垫类别" in pm_columns) else "NULL::VARCHAR"
    pm_name_expr = 'pm."产品名称"' if (has_pm and "产品名称" in pm_columns) else "NULL::VARCHAR"
    joins = ""
    if has_q18:
        joins += f' LEFT JOIN {q18_view} q18 ON s."商品编码" = q18."商家规编（后台）"'
    if has_pm:
        joins += f' LEFT JOIN {pm_view} pm ON s."商品编码" = pm."商品编码"'

    size_extract = (
        f"""coalesce(
          nullif({q18_size_expr}, ''),
          nullif({pm_size_expr}, ''),
          regexp_extract(cast(s."颜色规格" AS VARCHAR), '\\d{{3,4}}(MM|CM|mm|cm)?\\s*[×xX\\*]\\s*\\d{{3,4}}(MM|CM|mm|cm)?', 0)
        )"""
    )
    source_case = (
        f"""CASE
          WHEN length({q18_size_expr}) > 0 THEN 'q18'
          WHEN length({pm_size_expr}) > 0 THEN 'q27'
          WHEN regexp_matches(cast(s."颜色规格" AS VARCHAR), '\\d{{3,4}}(MM|CM|mm|cm)?\\s*[×xX\\*]\\s*\\d{{3,4}}(MM|CM|mm|cm)?') THEN 'colorSpec'
          ELSE 'unknown'
        END"""
    )
    enriched = f"""
      WITH enriched AS (
        SELECT
          try_cast(s."商家实收" AS DOUBLE) AS recv,
          try_cast(s."销售数量" AS DOUBLE) AS qty,
          coalesce(nullif(trim(cast({pm_cat_expr} AS VARCHAR)), ''), '(未分类)') AS cat,
          coalesce(nullif(trim(cast({pm_name_expr} AS VARCHAR)), ''), '(未分类)') AS product,
          {size_extract} AS raw_size,
          {source_case} AS source
        FROM {view} s{joins}
      )
    """

    totals = _fetch_records(connection, f"SELECT count(*) AS total FROM {view}")[0]
    total_lines = int(totals["total"] or 0)
    if total_lines == 0:
        result = empty_size_structure()
        result["quality"] = {"status": "unavailable", "coverage": None, "warnings": ["当前筛选范围无订单数据"]}
        return result

    size_rows = _fetch_records(
        connection,
        f"""{enriched}
        SELECT raw_size, source, count(*) AS n, sum(qty) AS qty, sum(recv) AS recv
        FROM enriched WHERE source <> 'unknown'
        GROUP BY raw_size, source""",
    )
    unknown_stat = _fetch_records(
        connection,
        f"""{enriched}
        SELECT count(*) AS n, coalesce(sum(qty), 0) AS qty, coalesce(sum(recv), 0) AS recv
        FROM enriched WHERE source = 'unknown'""",
    )[0]
    unknown_lines = int(unknown_stat["n"] or 0)
    unknown_qty = float(unknown_stat["qty"] or 0)
    unknown_recv = float(unknown_stat["recv"] or 0)

    source_priority = {"q18": 0, "q27": 1, "colorSpec": 2}
    merged: dict[str, dict[str, Any]] = {}
    for r in size_rows:
        std = _normalize_size(r["raw_size"])
        if not std:
            unknown_lines += int(r["n"])
            unknown_qty += float(r["qty"] or 0)
            unknown_recv += float(r["recv"] or 0)
            continue
        if std not in merged:
            merged[std] = {"size": std, "orderLines": 0, "salesUnits": 0.0, "receivedAmount": 0.0, "source": r["source"]}
        merged[std]["orderLines"] += int(r["n"])
        merged[std]["salesUnits"] += float(r["qty"] or 0)
        merged[std]["receivedAmount"] += float(r["recv"] or 0)
        if source_priority.get(r["source"], 9) < source_priority.get(merged[std]["source"], 9):
            merged[std]["source"] = r["source"]

    recognized_lines = sum(v["orderLines"] for v in merged.values())
    threshold = max(total_lines * 0.005, 1)
    main_sizes: list[dict[str, Any]] = []
    for v in sorted(merged.values(), key=lambda x: x["orderLines"], reverse=True):
        if v["orderLines"] < threshold:
            break
        main_sizes.append(v)

    total_recv = sum(v["receivedAmount"] for v in merged.values()) + unknown_recv
    share_lines = lambda n: (n / total_lines) if total_lines > 0 else 0
    share_recv = lambda n: (n / total_recv) if total_recv > 0 else 0

    sizes_out = [
        {
            "size": v["size"],
            "source": v["source"],
            "orderLines": v["orderLines"],
            "orderLineShare": share_lines(v["orderLines"]),
            "salesUnits": v["salesUnits"],
            "receivedAmount": v["receivedAmount"],
            "receivedAmountShare": share_recv(v["receivedAmount"]),
        }
        for v in main_sizes
    ]
    unknown_size_row = {
        "size": "未填写尺寸",
        "source": "unknown",
        "orderLines": unknown_lines,
        "orderLineShare": share_lines(unknown_lines),
        "salesUnits": unknown_qty,
        "receivedAmount": unknown_recv,
        "receivedAmountShare": share_recv(unknown_recv),
    }

    q18_matched = 0
    if has_q18:
        q18_cov = _fetch_records(connection, f"{enriched} SELECT count(*) AS n FROM enriched WHERE source = 'q18'")[0]
        q18_matched = int(q18_cov["n"] or 0)
    coverage = {
        "totalOrderLines": total_lines,
        "matchedOrderLines": q18_matched,
        "totalProductCodes": 0,
        "matchedProductCodes": 0,
        "ambiguousProductCodes": 0,
        "orderLineRatio": (q18_matched / total_lines) if total_lines > 0 else None,
        "productCodeRatio": None,
    }

    main_size_labels = [s["size"] for s in sizes_out[:8]]
    other_label = "其他尺寸"

    def _build_matrix(row_field: str, top_n: int) -> dict[str, Any]:
        if not has_pm:
            return {"columns": [], "rows": []}
        cells = _fetch_records(
            connection,
            f"""{enriched}
            SELECT {row_field} AS "rowKey", raw_size, count(*) AS n
            FROM enriched WHERE source <> 'unknown' AND {row_field} IS NOT NULL
            GROUP BY 1, 2""",
        )
        lookup: dict[tuple[str, str], int] = {}
        row_totals: dict[str, int] = {}
        for c in cells:
            std = _normalize_size(c["raw_size"])
            if not std:
                continue
            label = std if std in main_size_labels else other_label
            key = (c["rowKey"], label)
            lookup[key] = lookup.get(key, 0) + int(c["n"])
            row_totals[c["rowKey"]] = row_totals.get(c["rowKey"], 0) + int(c["n"])
        row_keys = sorted(row_totals.keys(), key=lambda k: row_totals[k], reverse=True)[:top_n]
        cols = list(main_size_labels)
        if any((rk, other_label) in lookup for rk in row_keys):
            cols.append(other_label)
        rows = [
            {
                "rowKey": rk,
                "orderLines": row_totals[rk],
                "shares": {bl: (lookup.get((rk, bl), 0) / row_totals[rk]) if row_totals[rk] > 0 else 0 for bl in cols},
            }
            for rk in row_keys
        ]
        return {"columns": cols, "rows": rows}

    cat_matrix = _build_matrix("cat", 50)
    top_matrix = _build_matrix("product", 15)

    status = "ready" if recognized_lines > 0 else "degraded"
    warnings: list[str] = []
    if total_lines > 0 and q18_matched / total_lines < 0.8:
        warnings.append(f"q18 尺寸覆盖率仅 {q18_matched / total_lines:.1%}，部分尺寸依赖颜色规格推导")

    return {
        "sizes": sizes_out,
        "unknownSize": unknown_size_row,
        "mattressCategoryMatrix": cat_matrix,
        "topProductMatrix": top_matrix,
        "recognizedOrderLines": recognized_lines,
        "totalOrderLines": total_lines,
        "quality": {"status": status, "coverage": coverage, "warnings": warnings},
    }


def build_spu_sales_trend(
    connection: duckdb.DuckDBPyConnection,
    view: str,
    base_view: str,
    pm_view: str | None,
    pm_columns: set[str],
    q18_view: str | None,
    q18_columns: set[str],
) -> dict[str, Any]:
    """SPU 销量趋势：SPU×渠道销量矩阵 + 全量 SPU 日趋势 + 床垫类别日趋势。

    SPU 只取 q18.SPU产品商编；缺失归"未识别 SPU"，禁止用床垫类别冒充。
    defaultSpus 为商家实收 TOP15（默认选中）；dailySpuTrend 返回全量 SPU 供前端搜索筛选。
    """
    has_q18 = bool(q18_view and "SPU产品商编" in q18_columns and "商家规编（后台）" in q18_columns)
    has_pm = bool(pm_view and "商品编码" in pm_columns)
    q18_spu_expr = 'trim(cast(q18."SPU产品商编" AS VARCHAR))' if has_q18 else "NULL::VARCHAR"
    q18_name_expr = 'q18."产品名称"' if (has_q18 and "产品名称" in q18_columns) else "NULL::VARCHAR"
    pm_cat_expr = 'pm."床垫类别"' if (has_pm and "床垫类别" in pm_columns) else "NULL::VARCHAR"
    joins = ""
    if has_q18:
        joins += f' LEFT JOIN {q18_view} q18 ON s."商品编码" = q18."商家规编（后台）"'
    if has_pm:
        joins += f' LEFT JOIN {pm_view} pm ON s."商品编码" = pm."商品编码"'

    enriched = f"""
      WITH enriched AS (
        SELECT
          try_cast(s."商家实收" AS DOUBLE) AS recv,
          try_cast(s."销售数量" AS DOUBLE) AS qty,
          cast(s."订单日期" AS VARCHAR) AS dt,
          coalesce(nullif(trim(cast(s."渠道平台" AS VARCHAR)), ''), '(未设定)') AS channel,
          coalesce(nullif({q18_spu_expr}, ''), '未识别 SPU') AS spu,
          coalesce(nullif(trim(cast({q18_name_expr} AS VARCHAR)), ''), '') AS spu_product_name,
          coalesce(nullif(trim(cast({pm_cat_expr} AS VARCHAR)), ''), '(未分类)') AS cat
        FROM {view} s{joins}
      )
    """

    totals = _fetch_records(connection, f"SELECT count(*) AS total FROM {view}")[0]
    total_lines = int(totals["total"] or 0)
    if total_lines == 0:
        result = empty_spu_sales_trend()
        result["quality"] = {"status": "unavailable", "coverage": None, "warnings": ["当前筛选范围无订单数据"]}
        return result

    spu_rows = _fetch_records(
        connection,
        f"""{enriched}
        SELECT spu, any_value(spu_product_name) AS productName, count(*) AS orderLines, sum(qty) AS salesUnits, sum(recv) AS receivedAmount
        FROM enriched GROUP BY spu ORDER BY sum(recv) DESC""",
    )
    summaries = [
        {
            "spu": r["spu"],
            "productName": r.get("productName") or "",
            "orderLines": int(r["orderLines"]),
            "salesUnits": float(r["salesUnits"] or 0),
            "receivedAmount": float(r["receivedAmount"] or 0),
        }
        for r in spu_rows
    ]
    default_spus = [r["spu"] for r in spu_rows if r["spu"] != "未识别 SPU"][:15]
    available_spus = [r["spu"] for r in spu_rows]

    channel_cells = _fetch_records(
        connection,
        f"""{enriched}
        SELECT spu AS "rowKey", channel AS "col", sum(qty) AS n
        FROM enriched GROUP BY 1, 2""",
    )
    has_unknown_spu = any(c["rowKey"] == "未识别 SPU" for c in channel_cells)
    spu_keys = default_spus + (["未识别 SPU"] if has_unknown_spu else [])
    col_totals: dict[str, float] = {}
    for c in channel_cells:
        col_totals[c["col"]] = col_totals.get(c["col"], 0) + float(c["n"])
    col_keys = sorted(col_totals.keys(), key=lambda k: col_totals[k], reverse=True)
    spu_matrix = _pivot_count_matrix(channel_cells, spu_keys, col_keys)

    daily_rows = _fetch_records(
        connection,
        f"""{enriched}
        SELECT dt AS date, spu, count(*) AS orderLines, sum(qty) AS salesUnits, sum(recv) AS receivedAmount
        FROM enriched WHERE dt IS NOT NULL
        GROUP BY 1, 2 ORDER BY 1, 2""",
    )
    daily_spu = [
        {
            "date": r["date"],
            "spu": r["spu"],
            "orderLines": int(r["orderLines"]),
            "salesUnits": float(r["salesUnits"] or 0),
            "receivedAmount": float(r["receivedAmount"] or 0),
        }
        for r in daily_rows
    ]

    cat_daily = _fetch_records(
        connection,
        f"""{enriched}
        SELECT dt AS date, cat AS mattressCategory, sum(qty) AS salesUnits, sum(recv) AS receivedAmount
        FROM enriched WHERE dt IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2""",
    )
    category_daily = [
        {
            "date": r["date"],
            "mattressCategory": r["mattressCategory"],
            "salesUnits": float(r["salesUnits"] or 0),
            "receivedAmount": float(r["receivedAmount"] or 0),
        }
        for r in cat_daily
    ]

    q18_matched = 0
    if has_q18:
        q18_cov = _fetch_records(
            connection, f"{enriched} SELECT count(*) AS n FROM enriched WHERE spu <> '未识别 SPU'"
        )[0]
        q18_matched = int(q18_cov["n"] or 0)
    coverage = {
        "totalOrderLines": total_lines,
        "matchedOrderLines": q18_matched,
        "totalProductCodes": 0,
        "matchedProductCodes": 0,
        "ambiguousProductCodes": 0,
        "orderLineRatio": (q18_matched / total_lines) if total_lines > 0 else None,
        "productCodeRatio": None,
    }

    status = "ready" if q18_matched > 0 else "degraded"
    warnings: list[str] = []
    if total_lines > 0 and q18_matched / total_lines < 0.8:
        warnings.append(f"q18 SPU 覆盖率仅 {q18_matched / total_lines:.1%}，大量订单归入未识别 SPU")

    return {
        "spuChannelMatrix": spu_matrix,
        "dailySpuTrend": daily_spu,
        "categoryDailyTrend": category_daily,
        "availableSpus": available_spus,
        "defaultSpus": default_spus,
        "summaries": summaries,
        "quality": {"status": status, "coverage": coverage, "warnings": warnings},
    }


CUSTOM_TAGS = ["定制缺角", "定制异形", "定制折叠", "定制尺寸", "定制厚度", "定制内材", "未填写标签"]


def build_customization_structure(
    connection: duckdb.DuckDBPyConnection,
    view: str,
    base_view: str,
    pm_view: str | None,
    pm_columns: set[str],
    q18_view: str | None,
    q18_columns: set[str],
) -> dict[str, Any]:
    """定制结构（推导）：常规/定制对比 + 7 标签 + 类别结构 + TOP20 履约。

    当前数仓无原生定制字段，仅基于颜色规格关键词推导；Phase 0 审计确认信号极弱
   （定制/异形/缺角 关键词几乎为 0），quality 标注 degraded。毛利因成本口径复杂暂返回 null。
    """
    has_pm = bool(pm_view and "商品编码" in pm_columns)
    pm_cat_expr = 'pm."床垫类别"' if (has_pm and "床垫类别" in pm_columns) else "NULL::VARCHAR"
    pm_name_expr = 'pm."产品名称"' if (has_pm and "产品名称" in pm_columns) else "NULL::VARCHAR"
    joins = ""
    if has_pm:
        joins += f' LEFT JOIN {pm_view} pm ON s."商品编码" = pm."商品编码"'

    enriched = f"""
      WITH enriched AS (
        SELECT
          try_cast(s."商家实收" AS DOUBLE) AS recv,
          try_cast(s."销售数量" AS DOUBLE) AS qty,
          cast(s."订单日期" AS DATE) AS order_date,
          cast(s."发货日期" AS DATE) AS ship_date,
          lower(coalesce(cast(s."颜色规格" AS VARCHAR), '')) AS spec_lower,
          coalesce(nullif(trim(cast({pm_cat_expr} AS VARCHAR)), ''), '(未分类)') AS cat,
          coalesce(nullif(trim(cast({pm_name_expr} AS VARCHAR)), ''), '(未分类)') AS product
        FROM {view} s{joins}
      )
    """
    tag_case = (
        "CASE "
        "WHEN spec_lower LIKE '%缺角%' THEN '定制缺角' "
        "WHEN spec_lower LIKE '%异形%' OR spec_lower LIKE '%圆%' OR spec_lower LIKE '%弧形%' THEN '定制异形' "
        "WHEN spec_lower LIKE '%定制折叠%' OR spec_lower LIKE '%定做折叠%' THEN '定制折叠' "
        "WHEN spec_lower LIKE '%定制尺寸%' OR spec_lower LIKE '%定做尺寸%' THEN '定制尺寸' "
        "WHEN spec_lower LIKE '%定制厚度%' OR spec_lower LIKE '%定做厚度%' THEN '定制厚度' "
        "WHEN spec_lower LIKE '%定制内材%' OR spec_lower LIKE '%定做内材%' THEN '定制内材' "
        "WHEN spec_lower LIKE '%定制%' OR spec_lower LIKE '%定做%' OR spec_lower LIKE '%非标%' THEN '未填写标签' "
        "ELSE NULL END"
    )

    totals = _fetch_records(connection, f"SELECT count(*) AS total FROM {view}")[0]
    total_lines = int(totals["total"] or 0)
    if total_lines == 0:
        result = empty_customization_structure()
        result["quality"] = {"status": "unavailable", "coverage": None, "warnings": ["当前筛选范围无订单数据"]}
        return result

    comp_rows = _fetch_records(
        connection,
        f"""{enriched}
        SELECT
          CASE WHEN {tag_case} IS NOT NULL THEN '定制' ELSE '常规' END AS order_type,
          count(*) AS order_lines,
          sum(recv) AS recv,
          sum(CASE WHEN ship_date IS NOT NULL AND ship_date >= order_date THEN 1 ELSE 0 END) AS shipped,
          avg(CASE WHEN ship_date IS NOT NULL AND ship_date >= order_date THEN date_diff('day', order_date, ship_date) END) AS avg_days,
          avg(CASE WHEN ship_date IS NOT NULL AND ship_date >= order_date AND date_diff('day', order_date, ship_date) <= 7 THEN 1.0 ELSE 0 END) AS within7,
          avg(CASE WHEN ship_date IS NOT NULL AND ship_date >= order_date AND date_diff('day', order_date, ship_date) <= 15 THEN 1.0 ELSE 0 END) AS within15
        FROM enriched GROUP BY 1""",
    )
    comp_map = {r["order_type"]: r for r in comp_rows}
    comparison = []
    for ot in ["常规", "定制"]:
        r = comp_map.get(ot)
        ol = int(r["order_lines"]) if r else 0
        recv = float(r["recv"] or 0) if r else 0.0
        shipped = int(r["shipped"]) if r else 0
        avg_days = float(r["avg_days"]) if r and r["avg_days"] is not None else None
        w7 = float(r["within7"]) if r and r["within7"] is not None else None
        w15 = float(r["within15"]) if r and r["within15"] is not None else None
        comparison.append({
            "orderType": ot,
            "orderLines": ol,
            "orderLineShare": (ol / total_lines) if total_lines > 0 else 0,
            "receivedAmount": recv,
            "grossMargin": None,
            "shippedOrderLines": shipped,
            "avgShippingDays": avg_days,
            "shippedWithin7DaysShare": w7,
            "shippedWithin15DaysShare": w15,
        })

    tag_rows = _fetch_records(
        connection,
        f"""{enriched}
        SELECT {tag_case} AS tag, count(*) AS n FROM enriched WHERE {tag_case} IS NOT NULL GROUP BY 1""",
    )
    tag_map = {r["tag"]: int(r["n"]) for r in tag_rows}
    custom_total = sum(tag_map.values())
    tags = [
        {"tag": t, "orderLines": tag_map.get(t, 0), "customOrderLineShare": (tag_map.get(t, 0) / custom_total) if custom_total > 0 else 0}
        for t in CUSTOM_TAGS
    ]

    category_structure: list[dict[str, Any]] = []
    if has_pm and custom_total > 0:
        cat_rows = _fetch_records(
            connection,
            f"""{enriched}
            SELECT cat,
                   sum(qty) AS sales_units,
                   sum(CASE WHEN {tag_case} IS NOT NULL THEN qty ELSE 0 END) AS custom_sales_units,
                   count(*) AS n
            FROM enriched GROUP BY 1 ORDER BY 2 DESC""",
        )
        custom_total_qty = max(float(r["custom_sales_units"] or 0) for r in cat_rows) if cat_rows else 0
        category_structure = [
            {
                "mattressCategory": r["cat"],
                "salesUnits": float(r["sales_units"] or 0),
                "customSalesUnits": float(r["custom_sales_units"] or 0),
                "customSalesShare": (float(r["custom_sales_units"] or 0) / float(r["sales_units"])) if float(r["sales_units"] or 0) > 0 else 0,
                "customOrderLines": int(r["n"]),
                "customOrderLineShare": (int(r["n"]) / custom_total) if custom_total > 0 else 0,
            }
            for r in cat_rows
        ]

    top_products: list[dict[str, Any]] = []
    if has_pm and custom_total > 0:
        top_rows = _fetch_records(
            connection,
            f"""{enriched}
            SELECT product, count(*) AS custom_lines, sum(recv) AS custom_recv,
                   sum(CASE WHEN ship_date IS NOT NULL AND ship_date >= order_date THEN 1 ELSE 0 END) AS shipped,
                   avg(CASE WHEN ship_date IS NOT NULL AND ship_date >= order_date THEN date_diff('day', order_date, ship_date) END) AS avg_days,
                   avg(CASE WHEN ship_date IS NOT NULL AND ship_date >= order_date AND date_diff('day', order_date, ship_date) <= 7 THEN 1.0 ELSE 0 END) AS within7,
                   avg(CASE WHEN ship_date IS NOT NULL AND ship_date >= order_date AND date_diff('day', order_date, ship_date) <= 10 THEN 1.0 ELSE 0 END) AS within10,
                   avg(CASE WHEN ship_date IS NOT NULL AND ship_date >= order_date AND date_diff('day', order_date, ship_date) <= 15 THEN 1.0 ELSE 0 END) AS within15
            FROM enriched WHERE {tag_case} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 20""",
        )
        top_products = [
            {
                "productName": r["product"],
                "totalOrderLines": int(r["custom_lines"]),
                "customOrderLines": int(r["custom_lines"]),
                "customShareWithinProduct": 1.0,
                "customReceivedAmount": float(r["custom_recv"] or 0),
                "shippedCustomOrderLines": int(r["shipped"]),
                "shippedWithin7DaysShare": float(r["within7"]) if r["within7"] is not None else None,
                "shippedWithin10DaysShare": float(r["within10"]) if r["within10"] is not None else None,
                "shippedWithin15DaysShare": float(r["within15"]) if r["within15"] is not None else None,
            }
            for r in top_rows
        ]

    status = "degraded"
    warnings = ["当前数仓无原生定制字段，定制结构仅基于颜色规格关键词推导，信号极弱，不等同于参考看板口径。"]
    if custom_total == 0:
        warnings.append("当前筛选范围未识别到任何定制订单。")

    return {
        "comparison": comparison,
        "categoryStructure": category_structure,
        "tags": tags,
        "topProducts": top_products,
        "derivationNote": "基于颜色规格关键词推导，不等同于 ERP 原生定制字段。当前数仓无定制标签字段，信号极弱。",
        "quality": {"status": status, "coverage": None, "warnings": warnings},
    }


def build_product_structure_modules(
    connection: duckdb.DuckDBPyConnection,
    view: str,
    base_view: str,
    pm_view: str | None,
    pm_columns: set[str],
    q18_view: str | None,
    q18_columns: set[str],
) -> dict[str, Any]:
    """组装 4 个新增结构模块。单个 builder 异常时返回该模块空结构，不影响其余模块。"""
    modules: list[tuple[str, Any]] = []
    for name, builder in (
        ("priceStructure", build_price_structure),
        ("sizeStructure", build_size_structure),
        ("spuSalesTrend", build_spu_sales_trend),
        ("customizationStructure", build_customization_structure),
    ):
        try:
            modules.append((name, builder(connection, view, base_view, pm_view, pm_columns, q18_view, q18_columns)))
        except Exception as error:  # 单模块失败不阻塞其余模块；不向前端暴露 SQL 或路径。
            empty = {
                "priceStructure": empty_price_structure,
                "sizeStructure": empty_size_structure,
                "spuSalesTrend": empty_spu_sales_trend,
                "customizationStructure": empty_customization_structure,
            }[name]()
            empty["quality"] = {
                "status": "unavailable",
                "coverage": None,
                "warnings": [f"模块构建失败：{type(error).__name__}"],
            }
            modules.append((name, empty))
    return dict(modules)
