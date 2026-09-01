import type { Top100ItemV2 } from "../types";
import { competitorImageUrl } from "../services/intelligenceApi";
import { StatusTag } from "./StatusTag";
import { RatingBar } from "./RatingBar";
import { clsx } from "../utils/format";

interface DetailDrawerProps {
  item: Top100ItemV2 | null;
  onClose: () => void;
}

// 点击 TOP100 行 → 全屏右侧抽屉展开 85 字段全景，按维度分组
export function DetailDrawer({ item, onClose }: DetailDrawerProps) {
  if (!item) return null;
  const imgUrl = competitorImageUrl(item.imageFile) || item.imageUrl || null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[720px] flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--bg)] shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] p-5">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <StatusTag label={`CP #${item.cpRank}`} tone={item.isOwnBrand ? "green" : "blue"} />
              <StatusTag label={item.brand} tone="muted" />
              <StatusTag label={item.platform} tone="muted" />
              {item.isOwnBrand && <StatusTag label="⭐ 我方品牌" tone="green" />}
            </div>
            <h3 className="text-base font-bold leading-tight">{item.productName}</h3>
            <div className="mt-1 text-xs text-[var(--muted)]">{item.shop} · {item.priceRange} · 月销 {item.salesRange}</div>
          </div>
          <button className="btn shrink-0" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        {/* Scrollable body */}
        <div className="grid flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[280px_1fr]">
          {/* 左：主图 + 9 项评分 */}
          <div>
            {imgUrl ? (
              <img
                src={imgUrl}
                alt={item.productName}
                loading="lazy"
                className="mb-4 w-full rounded-lg border border-[var(--border)]"
              />
            ) : (
              <div className="mb-4 flex aspect-square w-full items-center justify-center rounded-lg border border-[var(--border)] bg-white/[0.02] text-4xl">🛏️</div>
            )}
            <div className="grid gap-2 rounded-lg border border-[var(--border)] bg-white/[0.02] p-3">
              <div className="mb-1 text-xs font-bold text-[var(--muted)]">9 项评分</div>
              <RatingRow label="信息清晰度" value={item.scores.CH_clarity} />
              <RatingRow label="卖点表达" value={item.scores.CI_sellpoint} />
              <RatingRow label="差异化" value={item.scores.CJ_diff} />
              <RatingRow label="价格吸引力" value={item.scores.CK_price} />
              <RatingRow label="赠品吸引力" value={item.scores.CL_gift} />
              <RatingRow label="信任建立" value={item.scores.CM_trust} />
              <RatingRow label="紧迫感" value={item.scores.CN_urgency} />
              <RatingRow label="视觉完成度" value={item.scores.CO_visual} />
              <div className="mt-1 flex items-center justify-between border-t border-[var(--border)] pt-2">
                <div className="text-sm font-bold">综合转化潜力</div>
                <RatingBar value={item.scores.CP_total} showLabel />
              </div>
            </div>
          </div>

          {/* 右：分组字段 */}
          <div className="grid gap-4">
            <FieldGroup title="🎯 视觉焦点 & 传播主题">
              <Field label="主标题" value={item.headline} highlight />
              <Field label="副标题" value={item.subheadline} />
              <Field label="重点数字" value={item.keyNumbers} />
              <Field label="第一视觉焦点" value={item.visualFocus1} />
              <Field label="第二视觉焦点" value={item.visualFocus2} />
              <Field label="核心传播主题" value={item.mainTheme} />
            </FieldGroup>

            <FieldGroup title="💡 营销手法 & 卖点">
              <Field label="营销手法分类" value={item.marketingCategory} />
              <Field label="核心营销手法" value={item.marketingCore} highlight />
              <Field label="营销力度" value={item.marketingStrength} />
              <Field label="核心卖点" value={item.sellPointCore} highlight />
              <Field label="其他卖点" value={item.sellPointExtra} />
              <Field label="用户利益" value={item.userBenefit} />
              <Field label="对应痛点" value={item.painPoints} />
            </FieldGroup>

            <FieldGroup title="🎁 赠品 & 💰 价格 & ⏰ 紧迫感">
              <Field label="是否展示赠品" value={item.hasGift} />
              <Field label="赠品内容" value={item.giftContent} />
              <Field label="价格表达方式" value={item.priceExpression} />
              <Field label="紧迫感来源" value={item.urgencySource} />
            </FieldGroup>

            <FieldGroup title="🎨 视觉 & 👥 人群">
              <Field label="版式类型" value={item.layoutType} />
              <Field label="主色调" value={item.mainColor} />
              <Field label="目标人群" value={item.audience} />
              <Field label="使用场景" value={item.scene} />
              <Field label="转化公式" value={item.conversionFormula} />
            </FieldGroup>

            <FieldGroup title="✅ 单图结论（可复用 / 需回避）">
              <Field label="最大优势" value={item.biggestAdvantage} tone="green" />
              <Field label="最大问题" value={item.biggestProblem} tone="red" />
              <Field label="最值得借鉴" value={item.worthLearning} tone="blue" />
            </FieldGroup>
          </div>
        </div>
      </aside>
    </div>
  );
}

function RatingRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-[var(--muted)]">{label}</span>
      <RatingBar value={value} showLabel size="sm" />
    </div>
  );
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3">
      <div className="mb-2 text-xs font-bold text-[var(--muted)]">{title}</div>
      <div className="grid gap-2 text-sm leading-6">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  highlight = false,
  tone,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  tone?: "green" | "red" | "blue";
}) {
  if (!value) return null;
  const color =
    tone === "green" ? "text-[var(--green)]"
    : tone === "red" ? "text-[var(--red)]"
    : tone === "blue" ? "text-[var(--blue)]"
    : highlight ? "text-[var(--text)] font-semibold"
    : "text-[var(--text)]";
  return (
    <div>
      <span className="text-xs text-[var(--muted)]">{label}：</span>
      <span className={clsx(color)}>{value}</span>
    </div>
  );
}
