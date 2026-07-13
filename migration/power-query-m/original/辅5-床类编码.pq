let
    源 = Excel.Workbook(File.Contents("D:\麻大师\日更数据\天猫旗舰店\商品信息文件\床类编码.xlsx"), null, true),
    Sheet1_Sheet = 源{[Item="Sheet1",Kind="Sheet"]}[Data],
    提升的标题 = Table.PromoteHeaders(Sheet1_Sheet, [PromoteAllScalars=true]),
    重命名的列 = Table.RenameColumns(提升的标题,{{"主型号", "SPU产品商编"}, {"id", "商品ID"}, {"商家编码（后台）", "商家规编（后台）"}})
in
    重命名的列
