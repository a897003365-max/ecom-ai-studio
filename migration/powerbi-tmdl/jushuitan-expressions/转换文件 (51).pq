let
    源 = (参数50 as binary) => let
    源 = Excel.Workbook(参数50, null, true),
    Sheet1_Sheet = 源{[Item="export",Kind="Sheet"]}[Data],
    提升的标题 = Table.PromoteHeaders(Sheet1_Sheet, [PromoteAllScalars=true])
in
    提升的标题
in
    源