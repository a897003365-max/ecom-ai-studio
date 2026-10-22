-- 聚水潭订单层：源 public.jst_order_item_daily（mds-postgres-1）
-- 所有对象由 maizi 创建/拥有；ETL 见 pipeline/ecom_pipeline/jst_db_layer.py
-- 注意：maizi 默认 default_transaction_read_only=on，建表/写入连接需先
--       SET default_transaction_read_only=off;

-- ---------------------------------------------------------------------------
-- 辅助维表（来自 D:\麻大师\日更数据\天猫旗舰店 下的 Excel 辅助文件）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.jst_product_master (
  merchant_spec_code TEXT PRIMARY KEY,   -- 商家规编（后台）
  product_name        TEXT,              -- 产品名称
  sub_name            TEXT,              -- 子名称
  spu_code            TEXT,              -- SPU产品商编
  ship_warehouse      TEXT,              -- 发货仓
  mattress_category   TEXT,              -- 床垫类别
  thickness           TEXT,              -- 厚度
  size                TEXT,              -- 尺寸
  cost                TEXT,              -- 成本（源为文本，转换层再转数值）
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jst_jd_self_product (
  product_id          TEXT,              -- 商品ID（自营 SKUid）
  merchant_spec_code  TEXT               -- 商家规编（后台）
);
CREATE INDEX IF NOT EXISTS jst_jd_self_product_product_id_idx
  ON public.jst_jd_self_product (product_id);

CREATE TABLE IF NOT EXISTS public.jst_shop_mapping (
  shop_name        TEXT PRIMARY KEY,     -- ERP 店铺名称
  shop_short_name  TEXT                  -- 店铺简称
);

CREATE TABLE IF NOT EXISTS public.jst_offline_suborder (
  sub_order_no   TEXT PRIMARY KEY,       -- 子订单编号
  main_order_no  TEXT                    -- 主订单编号
);

CREATE TABLE IF NOT EXISTS public.jst_week_map (
  date  DATE PRIMARY KEY,                -- 日期
  week  TEXT                             -- 周
);

-- ---------------------------------------------------------------------------
-- 网站商品页层（对应 transforms._transform_jushuitan 的 48 个业务列）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.jst_order_item_web (
  "线上订单号"            TEXT,
  "线上子订单编号"        TEXT,
  "内部订单号"            TEXT,
  "线上商品名"            TEXT,
  "店铺商品编码"          TEXT,
  "商品编码"              TEXT,
  "商品简称"              TEXT,
  "颜色规格"              TEXT,
  "产品分类"              TEXT,
  "品牌"                  TEXT,
  "供应商"                TEXT,
  "店铺"                  TEXT,
  "店铺简称"              TEXT,
  "店铺简称（结算店铺）"  TEXT,
  "渠道平台"              TEXT,
  "订单来源"              TEXT,
  "订单状态"              TEXT,
  "订单状态明细"          TEXT,
  "订单状态汇总"          TEXT,
  "达人名称"              TEXT,
  "业务员"                TEXT,
  "省"                    TEXT,
  "发货仓"                TEXT,
  "是否定制"              BOOLEAN,
  "定制备注标签"          TEXT,
  "退款分类"              TEXT,
  "退款程度"              TEXT,
  "订单日期"              DATE,
  "付款日期"              DATE,
  "发货日期"              DATE,
  "确认收货日期"          DATE,
  "销售数量"              DOUBLE PRECISION,
  "实发数量"              DOUBLE PRECISION,
  "实发金额"              DOUBLE PRECISION,
  "销售金额"              DOUBLE PRECISION,
  "成本价"                DOUBLE PRECISION,
  "基本售价"              DOUBLE PRECISION,
  "销售成本"              DOUBLE PRECISION,
  "销售毛利"              DOUBLE PRECISION,
  "退货数量"              DOUBLE PRECISION,
  "退货金额"              DOUBLE PRECISION,
  "实退金额"              DOUBLE PRECISION,
  "买家实付"              DOUBLE PRECISION,
  "商家实收"              DOUBLE PRECISION,
  "平台补贴金额"          DOUBLE PRECISION,
  "优惠金额"              DOUBLE PRECISION,
  "运费收入"              DOUBLE PRECISION,
  "运费支出"              DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS jst_order_item_web_pay_date_idx
  ON public.jst_order_item_web ("付款日期");
CREATE INDEX IF NOT EXISTS jst_order_item_web_channel_idx
  ON public.jst_order_item_web ("渠道平台");
CREATE INDEX IF NOT EXISTS jst_order_item_web_status_idx
  ON public.jst_order_item_web ("订单状态明细");
CREATE INDEX IF NOT EXISTS jst_order_item_web_store_idx
  ON public.jst_order_item_web ("店铺简称");
CREATE INDEX IF NOT EXISTS jst_order_item_web_sku_idx
  ON public.jst_order_item_web ("商品编码");

-- ---------------------------------------------------------------------------
-- 共享表导出层（对应 jushuitan39.OUTPUT_COLUMNS 的 39 列，已按 39 列去重）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.jst_order_item_export (
  "线上订单号"            TEXT,
  "线上子订单编号"        TEXT,
  "线上商品名"            TEXT,
  "销售数量"              BIGINT,
  "商家实收"              DOUBLE PRECISION,
  "买家实付"              DOUBLE PRECISION,
  "退货金额"              DOUBLE PRECISION,
  "SPU产品商编"           TEXT,
  "产品名称"              TEXT,
  "子名称"                TEXT,
  "商品编码"              TEXT,
  "颜色规格"              TEXT,
  "商品id"                TEXT,
  "渠道平台"              TEXT,
  "店铺简称"              TEXT,
  "是否定制"              TEXT,     -- 共享表口径为「定制/常规」文本
  "定制备注标签"          TEXT,
  "订单状态汇总"          TEXT,
  "订单状态明细"          TEXT,
  "床垫类别"              TEXT,
  "年月"                  TEXT,
  "付款日期"              DATE,
  "发货日期"              DATE,
  "确认收货日期"          DATE,
  "发货仓"                TEXT,
  "买家ID"                TEXT,
  "成本"                  DOUBLE PRECISION,
  "订单状态"              TEXT,
  "卖家备注"              TEXT,
  "小旗"                  TEXT,
  "店铺简称（结算店铺）"  TEXT,
  "厚度"                  TEXT,
  "尺寸"                  TEXT,
  "店铺"                  TEXT,
  "商品简称"              TEXT,
  "毛利额"                DOUBLE PRECISION,
  "单件价格"              DOUBLE PRECISION,
  "周"                    TEXT,
  "内部订单号"            TEXT
);

-- ETL 写入暂存（每轮先落这里，最后 SELECT DISTINCT 进正式表，实现全量去重）
CREATE TABLE IF NOT EXISTS public.jst_order_item_export_staging (
  LIKE public.jst_order_item_export
);

-- ---------------------------------------------------------------------------
-- ETL 运行日志
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.jst_etl_runs (
  run_id                 BIGSERIAL PRIMARY KEY,
  started_at             TIMESTAMPTZ NOT NULL,
  finished_at            TIMESTAMPTZ,
  source_max_updated_at  TIMESTAMPTZ,
  web_rows               BIGINT,
  export_rows            BIGINT,
  status                 TEXT NOT NULL,
  error                  TEXT
);

-- 读权限：maizi 自己拥有表；给 ecom_sync 预留只读（如果后续需要）
GRANT SELECT ON public.jst_product_master,
                public.jst_jd_self_product,
                public.jst_shop_mapping,
                public.jst_offline_suborder,
                public.jst_week_map,
                public.jst_order_item_web,
                public.jst_order_item_export,
                public.jst_etl_runs
  TO ecom_sync;
