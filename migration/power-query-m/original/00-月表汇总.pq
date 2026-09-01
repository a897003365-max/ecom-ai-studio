let    
    源 = Excel.Workbook(File.Contents("D:\麻大师\日更数据\天猫旗舰店\00-各渠道销售数据\淘系.xlsx"), null, true),    
    Sheet4_Sheet = 源{[Item="Sheet4",Kind="Sheet"]}[Data],    
    提升的标题 = Table.PromoteHeaders(Sheet4_Sheet, [PromoteAllScalars=true]),    
    更改的类型 = Table.TransformColumnTypes(提升的标题,{{"日期", type date}, {"浏览量", Int64.Type}, {"店铺客户数", Int64.Type}, {"GMV", type number}, {"成功退款金额", type number}, {"当日净成交金额", type number}, {"回款#(lf)（减退款）", type number}, {"总推广费#(lf)(含品销宝，小红书）", type number}, {"加购人数", Int64.Type}, {"站内总推广费#(lf)(含品销宝）", type number}, {"站内推广费%#(lf)(含品销宝）", type any}, {"关键词推广", type number}, {"精准人群推广", type number}, {"万相台（不包含目标直投）", Int64.Type}, {"多目标直投", Int64.Type}, {"全站推广", type number}, {"品销宝", Int64.Type}, {"内容场景", type number}, {"店铺运营", Int64.Type}, {"小红书推广费", type number}, {"搜索排名数", type any}, {"渠道", type text}, {"店铺", type text}}),    
    更改的类型1 = Table.TransformColumnTypes(更改的类型,{{"站内推广费%#(lf)(含品销宝）", Percentage.Type}, {"淘客", type number}})
in    
    更改的类型1
