"""Phase 0 数据审计：商品管理新增四模块的数据基础探查。

只读连接 ecom.duckdb，输出脱敏聚合统计到 docs/product-structure-data-audit.md。
不输出原始订单行、订单号、买家、源文件路径。颜色规格仅抽样规格字符串本身。
"""
from __future__ import annotations

import duckdb
from pathlib import Path

DB = Path(__file__).resolve().parents[1] / "local-data" / "warehouse" / "ecom.duckdb"
OUT = Path(__file__).resolve().parents[1] / "docs" / "product-structure-data-audit.md"


def model_view(con: duckdb.DuckDBPyConnection, name: str) -> str:
    row = con.execute(
        "SELECT model_view FROM warehouse_query_catalog WHERE query_name = ?",
        [name],
    ).fetchone()
    if not row:
        raise SystemExit(f"视图不存在: {name}")
    return f'"{row[0]}"'


def main() -> None:
    con = duckdb.connect(str(DB), read_only=True)
    q26 = model_view(con, "15-聚水潭商品数据")
    q27 = model_view(con, "product-master")
    q18 = model_view(con, "辅4-床垫编码")

    lines: list[str] = []
    w = lines.append

    w("# 商品管理新增模块 · Phase 0 数据审计")
    w("")
    w("> 只读探查 ecom.duckdb。全部为聚合统计，不含原始订单行或源路径。")
    w("")

    # 1. 视图与行数
    w("## 1. 视图基线")
    w("")
    rows = con.execute(
        "SELECT query_name, model_view, rows, columns, status FROM warehouse_query_catalog "
        "WHERE query_name IN ('15-聚水潭商品数据','product-master','辅4-床垫编码') ORDER BY query_name"
    ).fetchall()
    w("| 查询 | model 视图 | 行数 | 列数 | 状态 |")
    w("|---|---|---:|---:|---|")
    for r in rows:
        w(f"| {r[0]} | `{r[1]}` | {r[2]} | {r[3]} | {r[4]} |")
    w("")

    # 2. q18 列
    q18_cols = [c[0] for c in con.execute(f"DESCRIBE {q18}").fetchall()]
    w("## 2. q18（辅4-床垫编码）字段清单")
    w("")
    for c in q18_cols:
        w(f"- `{c}`")
    w("")

    needed = ["商家规编（后台）", "SPU产品商编", "sku产品编码", "床垫类别", "厚度", "是否折叠", "尺寸", "商品ID"]
    w("### 关键字段存在性")
    w("")
    for c in needed:
        w(f"- `{c}`: {'✅' if c in q18_cols else '❌ 缺失'}")
    w("")

    # 3. q26 列确认
    q26_cols = {c[0] for c in con.execute(f"DESCRIBE {q26}").fetchall()}
    q26_needed = ["商品编码", "商家实收", "销售数量", "订单日期", "发货日期", "渠道平台", "店铺简称", "订单状态明细", "颜色规格", "发货仓"]
    w("## 3. q26（15-聚水潭商品数据）关键字段")
    w("")
    for c in q26_needed:
        w(f"- `{c}`: {'✅' if c in q26_cols else '❌ 缺失'}")
    w("")

    # 4. q18 join key 候选的空值与 distinct
    w("## 4. q18 join key 候选评估")
    w("")
    w("| 候选 key | 非空行数 | distinct 值 | 重复行数 |")
    w("|---|---:|---:|---:|")
    for key in ["商家规编（后台）", "sku产品编码", "商品ID"]:
        if key not in q18_cols:
            w(f"| `{key}` | 字段缺失 | - | - |")
            continue
        stats = con.execute(
            f'SELECT count(*), count("{key}"), count(distinct "{key}") FROM {q18}'
        ).fetchone()
        nonnull = stats[1] or 0
        distinct = stats[2] or 0
        dup = nonnull - distinct
        w(f"| `{key}` | {nonnull} | {distinct} | {dup} |")
    w("")

    # 5. q18 按商家规编的维度冲突
    w("## 5. q18 按商家规编（后台）的维度冲突")
    w("")
    if "商家规编（后台）" in q18_cols:
        dims = [d for d in ["SPU产品商编", "床垫类别", "厚度", "是否折叠", "尺寸"] if d in q18_cols]
        dim_check = ", ".join(f'count(distinct "{d}")' for d in dims)
        having = " OR ".join(f'count(distinct "{d}") > 1' for d in dims)
        conflict_rows = con.execute(
            f'SELECT "商家规编（后台）", {dim_check} FROM {q18} '
            f'WHERE "商家规编（后台）" IS NOT NULL AND length(trim(cast("商家规编（后台）" AS VARCHAR))) > 0 '
            f'GROUP BY 1 HAVING {having} LIMIT 20'
        ).fetchall()
        total_conflict = con.execute(
            f'SELECT count(*) FROM ('
            f'SELECT "商家规编（后台）" FROM {q18} '
            f'WHERE "商家规编（后台）" IS NOT NULL AND length(trim(cast("商家规编（后台）" AS VARCHAR))) > 0 '
            f'GROUP BY 1 HAVING {having})'
        ).fetchone()[0]
        w(f"维度冲突的商家规编数：**{total_conflict}**（维度：{', '.join(dims)}）")
        w("")
        if conflict_rows:
            w("样例（前 20）：")
            w("")
            header = ["商家规编（后台）"] + [f"distinct {d}" for d in dims]
            w("| " + " | ".join(header) + " |")
            w("|" + "|".join(["---"] * len(header)) + "|")
            for r in conflict_rows:
                w("| " + " | ".join(str(x) for x in r) + " |")
            w("")
    else:
        w("商家规编（后台）字段缺失，无法评估。")
        w("")

    # 6. 覆盖率：q26.商品编码 vs q18 各候选 key
    w("## 6. 订单 ↔ q18 覆盖率")
    w("")
    total_lines, total_codes = con.execute(
        f'SELECT count(*), count(distinct "商品编码") FROM {q26} WHERE "商品编码" IS NOT NULL'
    ).fetchone()
    w(f"q26 有效商品编码订单行：{total_lines}；distinct 商品编码：{total_codes}。")
    w("")
    w("| q18 join key | 匹配订单行 | 订单行覆盖率 | 匹配 distinct 编码 | SKU 覆盖率 |")
    w("|---|---:|---:|---:|---:|")
    for key in ["商家规编（后台）", "sku产品编码", "商品ID"]:
        if key not in q18_cols:
            w(f"| `{key}` | 字段缺失 | - | - | - |")
            continue
        m = con.execute(
            f'SELECT count(*), count(distinct s."商品编码") FROM {q26} s '
            f'JOIN {q18} q ON s."商品编码" = q."{key}" '
            f'WHERE s."商品编码" IS NOT NULL'
        ).fetchone()
        line_cov = (m[0] / total_lines) if total_lines else 0
        code_cov = (m[1] / total_codes) if total_codes else 0
        w(f"| `{key}` | {m[0]} | {line_cov:.1%} | {m[1]} | {code_cov:.1%} |")
    w("")

    # 7. join 放大验证（用 q18 原样 LEFT JOIN，看订单行是否增加）
    w("## 7. join 放大验证（q26 LEFT JOIN q18 原样）")
    w("")
    w("若 after > before，说明 q18 同 key 多行导致订单事实放大，禁止直接 join。")
    w("")
    for key in ["商家规编（后台）", "sku产品编码"]:
        if key not in q18_cols:
            continue
        before = con.execute(f'SELECT count(*) FROM {q26}').fetchone()[0]
        after = con.execute(
            f'SELECT count(*) FROM {q26} s LEFT JOIN {q18} q ON s."商品编码" = q."{key}"'
        ).fetchone()[0]
        amp = "⚠️ 放大" if after > before else "✅ 不放大"
        w(f"- key=`{key}`：before={before}，after={after} → {amp}")
    w("")

    # 7b. 用去重后的 q18 唯一映射验证不放大 + 金额一致
    w("### 7b. 去重唯一映射后的一致性")
    w("")
    if "商家规编（后台）" in q18_cols:
        dedup_sql = (
            f'(SELECT "商家规编（后台）" AS k, '
            + ", ".join(f'any_value("{d}") AS "{d}"' for d in ["SPU产品商编", "床垫类别", "厚度", "是否折叠", "尺寸"] if d in q18_cols)
            + f' FROM {q18} WHERE "商家规编（后台）" IS NOT NULL GROUP BY 1) q18u'
        )
        before_rows, before_qty, before_recv = con.execute(
            f'SELECT count(*), coalesce(sum(try_cast("销售数量" AS DOUBLE)),0), coalesce(sum(try_cast("商家实收" AS DOUBLE)),0) FROM {q26}'
        ).fetchone()
        after_rows, after_qty, after_recv = con.execute(
            f'SELECT count(*), coalesce(sum(try_cast(s."销售数量" AS DOUBLE)),0), coalesce(sum(try_cast(s."商家实收" AS DOUBLE)),0) '
            f'FROM {q26} s LEFT JOIN {dedup_sql} ON s."商品编码" = q18u.k'
        ).fetchone()
        w(f"| 指标 | join 前 | join 后 | 差异 |")
        w("|---|---:|---:|---:|")
        w(f"| 订单行数 | {before_rows} | {after_rows} | {after_rows - before_rows} |")
        w(f"| 销售数量合计 | {before_qty:.2f} | {after_qty:.2f} | {after_qty - before_qty:.2f} |")
        w(f"| 商家实收合计 | {before_recv:.2f} | {after_recv:.2f} | {after_recv - before_recv:.2f} |")
        w("")
    else:
        w("商家规编（后台）缺失，跳过。")
        w("")

    # 8. 颜色规格抽样（脱敏：仅规格字符串）
    w("## 8. 颜色规格抽样（规格字符串，前 40 个 distinct）")
    w("")
    samples = con.execute(
        f'SELECT DISTINCT "颜色规格" FROM {q26} '
        f'WHERE "颜色规格" IS NOT NULL AND length(trim(cast("颜色规格" AS VARCHAR))) > 0 LIMIT 40'
    ).fetchall()
    w("```")
    for s in samples:
        w(str(s[0]))
    w("```")
    w("")

    # 9. 价格分桶分布
    w("## 9. 单件实收价分桶分布（商家实收 / 销售数量）")
    w("")
    price_rows = con.execute(
        f"""
        WITH priced AS (
          SELECT
            try_cast("商家实收" AS DOUBLE) AS recv,
            try_cast("销售数量" AS DOUBLE) AS qty
          FROM {q26}
        )
        SELECT
          CASE
            WHEN recv IS NULL OR recv <= 0 OR qty IS NULL OR qty <= 0 THEN 'EXCLUDED'
            WHEN recv / greatest(qty, 1) <= 1000 THEN '1000以下'
            WHEN recv / greatest(qty, 1) <= 1500 THEN '1001–1500'
            WHEN recv / greatest(qty, 1) <= 2000 THEN '1501–2000'
            WHEN recv / greatest(qty, 1) <= 2500 THEN '2001–2500'
            WHEN recv / greatest(qty, 1) <= 3000 THEN '2501–3000'
            WHEN recv / greatest(qty, 1) <= 4000 THEN '3001–4000'
            ELSE '4000以上'
          END AS bucket,
          count(*) AS n,
          sum(recv) AS recv_sum
        FROM priced
        GROUP BY 1 ORDER BY 1
        """
    ).fetchall()
    w("| 档位 | 订单行 | 商家实收合计 |")
    w("|---|---:|---:|")
    for r in price_rows:
        w(f"| {r[0]} | {r[1]} | {r[2]:.2f} |")
    w("")

    # 10. 定制关键词信号
    w("## 10. 定制关键词信号（颜色规格）")
    w("")
    kw_rows = con.execute(
        f"""
        SELECT
          count(*) AS total,
          count_if(regexp_matches(lower(coalesce(cast("颜色规格" AS VARCHAR), '')), '定制|定做|非标')) AS custom_generic,
          count_if(regexp_matches(lower(coalesce(cast("颜色规格" AS VARCHAR), '')), '异形')) AS shape,
          count_if(regexp_matches(lower(coalesce(cast("颜色规格" AS VARCHAR), '')), '缺角')) AS corner,
          count_if(regexp_matches(lower(coalesce(cast("颜色规格" AS VARCHAR), '')), '折叠')) AS fold
        FROM {q26}
        """
    ).fetchone()
    w("| 信号 | 订单行数 | 占比 |")
    w("|---|---:|---:|")
    labels = ["总行数", "定制/定做/非标", "异形", "缺角", "折叠"]
    for label, val in zip(labels, kw_rows):
        ratio = (val / kw_rows[0]) if kw_rows[0] else 0
        w(f"| {label} | {val} | {ratio:.2%} |")
    w("")

    # 11. SPU 字段覆盖
    w("## 11. SPU 映射可行性")
    w("")
    if "SPU产品商编" in q18_cols:
        spu_stats = con.execute(
            f'SELECT count(*), count("SPU产品商编"), count(distinct "SPU产品商编") FROM {q18} '
            f'WHERE "商家规编（后台）" IS NOT NULL'
        ).fetchone()
        w(f"q18 有商家规编的行：{spu_stats[0]}；SPU 非空：{spu_stats[1]}；distinct SPU：{spu_stats[2]}。")
        w("")
        if "商家规编（后台）" in q18_cols:
            spu_cov = con.execute(
                f'SELECT count(*), count(distinct s."商品编码") FROM {q26} s '
                f'JOIN {q18} q ON s."商品编码" = q."商家规编（后台）" '
                f'WHERE q."SPU产品商编" IS NOT NULL AND length(trim(cast(q."SPU产品商编" AS VARCHAR))) > 0'
            ).fetchone()
            total_lines2 = con.execute(f'SELECT count(*) FROM {q26} WHERE "商品编码" IS NOT NULL').fetchone()[0]
            ratio = (spu_cov[0] / total_lines2) if total_lines2 else 0
            w(f"能映射到 SPU 的订单行：{spu_cov[0]}（{ratio:.1%}）；distinct 编码：{spu_cov[1]}。")
            w("")
    else:
        w("q18 无 SPU产品商编 字段。")
        w("")

    # 12. 结论
    w("## 12. 审计结论")
    w("")
    w("（由 Phase 0 脚本生成，供后续 builder 实现参考。具体去重规则、主 join key、降级阈值以此为准。）")
    w("")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"审计报告已写入: {OUT}")


if __name__ == "__main__":
    main()
