let
    源 = Excel.Workbook(参数22, null, true),
    export_Sheet = 源{[Item="export",Kind="Sheet"]}[Data],
    提升的标题 = Table.PromoteHeaders(export_Sheet, [PromoteAllScalars=true])
in
    提升的标题