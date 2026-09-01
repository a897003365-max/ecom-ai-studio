let
    源 = (参数1 as binary) => let
    源 = Excel.Workbook(参数1, null, true),
    订单分析_Sheet = 源{[Item="订单分析",Kind="Sheet"]}[Data],
    提升的标题 = Table.PromoteHeaders(订单分析_Sheet, [PromoteAllScalars=true])
in
    提升的标题
in
    源