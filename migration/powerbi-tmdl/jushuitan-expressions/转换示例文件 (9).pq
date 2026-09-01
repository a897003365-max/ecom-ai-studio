let
    源 = Excel.Workbook(参数9, null, true),
    #"商品-宝贝管理-我的宝贝_Sheet" = 源{[Item="商品-宝贝管理-我的宝贝",Kind="Sheet"]}[Data],
    提升的标题 = Table.PromoteHeaders(#"商品-宝贝管理-我的宝贝_Sheet", [PromoteAllScalars=true])
in
    提升的标题