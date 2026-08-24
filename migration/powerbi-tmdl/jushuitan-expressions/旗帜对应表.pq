let
    源 = Excel.Workbook(File.Contents("D:\麻大师\日更数据\天猫旗舰店\商品信息文件\旗帜对应表.xlsx"), null, true),
    Sheet1_Sheet = 源{[Item="Sheet1",Kind="Sheet"]}[Data],
    更改的类型 = Table.TransformColumnTypes(Sheet1_Sheet,{{"Column1", type text}, {"Column2", type text}}),
    提升的标题 = Table.PromoteHeaders(更改的类型, [PromoteAllScalars=true]),
    更改的类型1 = Table.TransformColumnTypes(提升的标题,{{"旗帜颜色", type text}, {"插旗订单信息", type text}, {"标记", type text}})
in
    更改的类型1