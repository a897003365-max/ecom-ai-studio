let
    源 = Excel.Workbook(参数28, null, true),
    Sheet0_Sheet = 源{[Item="Sheet0",Kind="Sheet"]}[Data],
    提升的标题 = Table.PromoteHeaders(Sheet0_Sheet, [PromoteAllScalars=true])
in
    提升的标题