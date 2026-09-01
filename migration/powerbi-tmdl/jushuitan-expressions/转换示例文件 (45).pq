let
    源 = Excel.Workbook(参数45, null, true),
    促成下单1 = 源{[Name="促成下单"]}[Data],
    提升的标题 = Table.PromoteHeaders(促成下单1, [PromoteAllScalars=true])
in
    提升的标题