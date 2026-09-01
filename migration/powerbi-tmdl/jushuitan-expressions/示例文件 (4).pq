let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\05-旗舰店ID对照表"),
    删除的其他列 = Table.SelectColumns(源,{"Content"}),
    导航1 = 删除的其他列{0}[Content]
in
    导航1