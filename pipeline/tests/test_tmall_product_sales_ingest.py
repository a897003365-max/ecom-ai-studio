from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

import polars as pl
from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecom_pipeline.catalog import load_catalog  # noqa: E402
from ecom_pipeline.readers import read_source_file  # noqa: E402
from ecom_pipeline.transforms import transform_source_file  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parents[2]

# 生意参谋 2026-09 新版「商品_全部」导出：表头在第 5 行（上方 4 行空行/说明），38 列且多列改名
NEW_WIDE_HEADER = [
    "统计日期", "商品ID", "商品名称", "主商品ID", "商品类型", "货号", "商品状态", "商品标签",
    "商品访客数", "商品浏览量", "平均停留时长", "商品详情页跳出率", "商品收藏人数", "商品加购件数",
    "商品加购人数", "下单买家数", "下单件数", "下单金额", "下单转化率", "支付买家数", "支付件数",
    "支付金额", "商品支付转化率", "支付新买家数", "支付老买家数", "老买家支付金额", "聚划算支付金额",
    "访客平均价值", "成功退款金额", "竞争力评分", "年累计支付金额", "月累计支付金额", "月累计支付件数",
    "搜索引导支付转化率", "搜索引导访客数", "搜索引导支付买家数", "结构化详情引导转化率", "结构化详情引导成交占比",
]
NEW_WIDE_ROW = [
    "2026-09-03", "681141376007", "麻大师0胶水软床垫加硬神器", "681141376007", "主商品", "-",
    "当前在线", "-", "16,040", "27,933", "16.26", "88.60%", "252", "674", "514", "68", "77",
    "102,802.00", "0.42%", "61", "65", "87,965.07", "0.38%", "53", "8", "11,656.04", "0.00",
    "5.48", "31,942.65", "-", "32,323,003.55", "279,680.24", "200", "5.43%", "479", "26", "-", "-",
]

# 新版「品类_商品排行」瘦导出：仅 12 列支付口径，无访客/加购/退款列
NEW_THIN_HEADER = [
    "统计日期", "商品ID", "商品名称", "货号", "商品状态", "商品标签",
    "支付金额", "支付买家数", "支付件数", "支付子订单数", "客单价", "件单价",
]
NEW_THIN_ROW = [
    "2026-08-31", "762305889158", "麻大师豆7床垫", "-", "当前在线", "-",
    "207,927.09", "113", "130", "128", "1,840.06", "1,599.44",
]

# 旧版导出（2024-06 ~ 2026-08）：表头在第 0 行
OLD_HEADER = [
    "日期", "商品名称", "商品ID", "标准类目", "商品状态", "支付金额", "退款金额", "支付件数",
    "支付买家数", "支付转化率", "商品访客数", "加购人数", "加购件数", "UV价值",
]
OLD_ROW = [
    "2026-08-29", "麻大师豆7床垫", "762305889158", "全部标准类目", "当前在线", 176893.01, 36000.5,
    130, 113, 0.0091, 6381, 417, 542, 13.61,
]

# 生意参谋「一键导出」格式（2026-09 起用于补齐历史日期）：表头在第 0 行，无日期列，
# 日期在「日期范围」单元格内（2026-09-02|2026-09-02），商品ID 写作「商品 ID」，
# 每个指标带一个「（较上一周期）」环比百分比列
ONECLICK_HEADER = [
    "栏目", "菜单", "数据点", "维度", "日期范围", "类目", "选择类型", "搜索商品",
    "商品名称", "商品链接", "商品图片链接", "商品 ID", "商品编码", "商品状态", "导出时间",
    "支付金额", "支付金额（较上一周期）", "退款金额", "退款金额（较上一周期）",
    "支付件数", "支付件数（较上一周期）", "支付买家数", "支付买家数（较上一周期）",
    "支付新买家数", "加购件数", "加购人数", "收藏人数", "商品访客数", "商品浏览量",
    "跳失率", "UV价值", "客单价", "件单价",
]
ONECLICK_ROW = [
    "商品", "商品排行", "全部商品", "日", "2026-09-02|2026-09-02", "全部标准类目", "较上一周期", "",
    "麻大师豆7床垫", "https://detail.tmall.com/item.htm?id=762305889158", "https://img.alicdn.com/x.jpg",
    "762305889158", "-", "当前在线", "2026-09-04 16:25:40",
    "127,950.35", "28.95%", "36,064.82", "50.16%",
    "83", "38.33%", "71", "33.96%",
    "57", "96", "88", "14", "7,654", "18,236",
    "45.10%", "16.72", "1,801.84", "1,541.57",
]


def _write_sheet(path: Path, header: list[str], rows: list[list[object]], leading_blank_rows: int) -> None:
    workbook = Workbook()
    sheet = workbook.active
    for _ in range(leading_blank_rows):
        sheet.append([None] * len(header))
    sheet.append(header)
    for row in rows:
        sheet.append(row)
    workbook.save(path)


class TmallProductSalesIngestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        _, queries = load_catalog(PROJECT_ROOT / "migration" / "power-query-m" / "manifest.json")
        cls.spec = next(query for query in queries if query.name == "07-旗舰店商品销售数据")
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp_dir.cleanup)
        root = Path(cls.temp_dir.name)
        _write_sheet(root / "new_wide.xls", NEW_WIDE_HEADER, [NEW_WIDE_ROW], leading_blank_rows=4)
        _write_sheet(root / "new_thin.xlsx", NEW_THIN_HEADER, [NEW_THIN_ROW], leading_blank_rows=4)
        _write_sheet(root / "old.xlsx", OLD_HEADER, [OLD_ROW], leading_blank_rows=0)
        _write_sheet(root / "oneclick.xlsx", ONECLICK_HEADER, [ONECLICK_ROW], leading_blank_rows=0)
        cls.frames = {
            name: transform_source_file(read_source_file(root / name, cls.spec), cls.spec, root / name)
            for name in ("new_wide.xls", "new_thin.xlsx", "old.xlsx", "oneclick.xlsx")
        }

    def test_new_wide_export_maps_to_canonical_columns(self) -> None:
        frame = self.frames["new_wide.xls"]
        self.assertEqual(frame.height, 1)
        self.assertEqual(frame["日期"][0], date(2026, 9, 3))
        self.assertEqual(frame["日期"].dtype, pl.Date)
        self.assertEqual(frame["商品ID"][0], "681141376007")
        self.assertEqual(frame["商品访客数"][0], 16040)
        self.assertEqual(frame["加购人数"][0], 514)
        self.assertEqual(frame["加购件数"][0], 674)
        self.assertAlmostEqual(frame["支付金额"][0], 87965.07)
        self.assertAlmostEqual(frame["退款金额"][0], 31942.65)
        self.assertEqual(frame["商品支付件数"][0], 65)
        self.assertAlmostEqual(frame["UV价值"][0], 5.48)
        self.assertAlmostEqual(frame["跳失率"][0], 0.886)

    def test_new_thin_export_keeps_payment_columns(self) -> None:
        frame = self.frames["new_thin.xlsx"]
        self.assertEqual(frame.height, 1)
        self.assertEqual(frame["日期"][0], date(2026, 8, 31))
        self.assertAlmostEqual(frame["支付金额"][0], 207927.09)
        self.assertEqual(frame["支付买家数"][0], 113)
        self.assertEqual(frame["商品支付件数"][0], 130)
        self.assertNotIn("商品访客数", frame.columns)
        self.assertNotIn("退款金额", frame.columns)

    def test_old_export_still_parses(self) -> None:
        frame = self.frames["old.xlsx"]
        self.assertEqual(frame.height, 1)
        self.assertEqual(frame["日期"][0], date(2026, 8, 29))
        self.assertEqual(frame["商品访客数"][0], 6381)
        self.assertEqual(frame["加购人数"][0], 417)
        self.assertAlmostEqual(frame["退款金额"][0], 36000.5)
        self.assertEqual(frame["商品支付件数"][0], 130)

    def test_oneclick_export_derives_date_and_canonical_columns(self) -> None:
        frame = self.frames["oneclick.xlsx"]
        self.assertEqual(frame.height, 1)
        self.assertEqual(frame["日期"][0], date(2026, 9, 2))
        self.assertEqual(frame["日期"].dtype, pl.Date)
        self.assertEqual(frame["日期范围"].dtype, pl.String)
        self.assertEqual(frame["商品ID"][0], "762305889158")
        self.assertEqual(frame["商品编码"].dtype, pl.String)
        self.assertEqual(frame["商品访客数"][0], 7654)
        self.assertEqual(frame["加购人数"][0], 88)
        self.assertAlmostEqual(frame["支付金额"][0], 127950.35)
        self.assertAlmostEqual(frame["退款金额"][0], 36064.82)
        self.assertEqual(frame["商品支付件数"][0], 83)
        self.assertAlmostEqual(frame["支付金额（较上一周期）"][0], 0.2895)
        self.assertAlmostEqual(frame["跳失率"][0], 0.451)

    def test_oneclick_frame_unions_with_existing_formats(self) -> None:
        import duckdb

        root = Path(self.temp_dir.name)
        for name, frame in self.frames.items():
            frame.write_parquet(root / f"{name}.parquet")
        # 与生产视图同款合并方式（warehouse 的 read_parquet union_by_name）
        rows = (
            duckdb.connect()
            .execute(
                f"SELECT cast(\"日期\" AS DATE) AS d, cast(\"商品ID\" AS VARCHAR) AS pid "
                f"FROM read_parquet('{root.as_posix()}/*.parquet', union_by_name=true)"
            )
            .fetchall()
        )
        pairs = {(d, pid) for d, pid in rows}
        self.assertIn((date(2026, 9, 2), "762305889158"), pairs)
        self.assertIn((date(2026, 8, 31), "762305889158"), pairs)
        self.assertIn((date(2026, 9, 3), "681141376007"), pairs)
        self.assertIn((date(2026, 8, 29), "762305889158"), pairs)


if __name__ == "__main__":
    unittest.main()
