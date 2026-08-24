let
    源 = Csv.Document(参数56,[Delimiter=",", Columns=39, Encoding=936, QuoteStyle=QuoteStyle.Csv]),
    提升的标题 = Table.PromoteHeaders(源, [PromoteAllScalars=true])
in
    提升的标题