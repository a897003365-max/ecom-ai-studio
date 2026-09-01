let
    源 = (参数8 as binary) => let
    源 = Csv.Document(参数8,[Delimiter=",", Columns=89, Encoding=65001, QuoteStyle=QuoteStyle.Csv]),
    提升的标题 = Table.PromoteHeaders(源, [PromoteAllScalars=true])
in
    提升的标题
in
    源