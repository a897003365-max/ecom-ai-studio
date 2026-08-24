let
    源 = Excel.Workbook(参数44, null, true),
    客服接待明细对比报表1 = 源{[Name="客服接待明细对比报表"]}[Data],
    提升的标题 = Table.PromoteHeaders(客服接待明细对比报表1, [PromoteAllScalars=true])
in
    提升的标题