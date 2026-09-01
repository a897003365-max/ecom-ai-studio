let
    源 = Excel.Workbook(File.Contents("D:\麻大师\日更数据\天猫旗舰店\商品信息文件\自营id匹配表.xlsx"), null, true),
    Sheet1_Sheet = 源{[Item="Sheet1",Kind="Sheet"]}[Data],
    提升的标题 = Table.PromoteHeaders(Sheet1_Sheet, [PromoteAllScalars=true]),
    更改的类型 = Table.TransformColumnTypes(提升的标题,{{"商家规编（后台）", type text}, {"产品名称", type text}, {"SPU产品商编", type text}, {"skuid", type text}})
in
    更改的类型