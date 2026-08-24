let
    源 = (参数46 as binary) => let
    源 = Excel.Workbook(参数46, null, true),
    服务商工作量报表1 = 源{[Name="服务商工作量报表"]}[Data],
    提升的标题 = Table.PromoteHeaders(服务商工作量报表1, [PromoteAllScalars=true])
in
    提升的标题
in
    源