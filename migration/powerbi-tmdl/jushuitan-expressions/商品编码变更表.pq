let
    源 = Excel.Workbook(File.Contents("D:\麻大师\日更数据\天猫旗舰店\商品信息文件\商品编码更新表.xlsx"), null, true),
    Sheet1_Sheet = 源{[Item="Sheet1",Kind="Sheet"]}[Data],
    提升的标题 = Table.PromoteHeaders(Sheet1_Sheet, [PromoteAllScalars=true]),
    更改的类型 = Table.TransformColumnTypes(提升的标题,{{"原编码", type text}, {"原编码规格", type text}, {"新编码", type text}, {"新编码规格", type text}, {"备注", type text}, {"替换编辑的日期", type date}})
in
    更改的类型