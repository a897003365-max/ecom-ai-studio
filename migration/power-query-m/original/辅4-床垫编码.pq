let
    源 = Excel.Workbook(File.Contents("D:\麻大师\日更数据\天猫旗舰店\商品信息文件\产品明细.xlsx"), null, true),
    Sheet1_Sheet = 源{[Item="Sheet1",Kind="Sheet"]}[Data],
    提升的标题 = Table.PromoteHeaders(Sheet1_Sheet, [PromoteAllScalars=true])
in
    提升的标题
