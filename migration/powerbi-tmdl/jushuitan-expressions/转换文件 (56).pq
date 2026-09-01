let
    源 = (参数55 as binary) => let
    源 = Excel.Workbook(参数55, null, true),
    已发_Sheet = 源{[Item="已发",Kind="Sheet"]}[Data],
    提升的标题 = Table.PromoteHeaders(已发_Sheet, [PromoteAllScalars=true])
in
    提升的标题
in
    源