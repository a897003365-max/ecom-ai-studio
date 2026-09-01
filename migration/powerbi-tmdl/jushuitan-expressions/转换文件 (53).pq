let
    源 = (参数52 as binary) => let
    源 = Excel.Workbook(参数52, null, true),
    Sheet1_Sheet = 源{[Item="Sheet1",Kind="Sheet"]}[Data],
    提升的标题 = Table.PromoteHeaders(Sheet1_Sheet, [PromoteAllScalars=true])
in
    提升的标题
in
    源