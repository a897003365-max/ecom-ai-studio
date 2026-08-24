let
    源 = (参数48 as binary) => let
    源 = Excel.Workbook(参数48, null, true),
    数据信息_Sheet = 源{[Item="数据信息",Kind="Sheet"]}[Data],
    提升的标题 = Table.PromoteHeaders(数据信息_Sheet, [PromoteAllScalars=true])
in
    提升的标题
in
    源