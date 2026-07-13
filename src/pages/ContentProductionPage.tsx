import { useMemo, useState } from "react";
import { Card } from "../components/Card";
import { PageHeader } from "../components/PageHeader";
import { PlatformBadge } from "../components/PlatformBadge";
import { ProgressBar } from "../components/ProgressBar";
import { StatusTag } from "../components/StatusTag";
import { TableShell } from "../components/TableShell";
import { contentPipeline, contentProducts } from "../data/mock";
import type { ContentProduct, ProductStatus, TaskCreateInput } from "../types";
import { productStatusText, productStatusTone } from "../utils/status";

interface ContentProductionPageProps {
  onAction: (title: string, detail?: string) => void;
  onCreateTask: (task: TaskCreateInput) => void;
}

export function ContentProductionPage({ onAction, onCreateTask }: ContentProductionPageProps) {
  const [products, setProducts] = useState<ContentProduct[]>(contentProducts);
  const [selectedId, setSelectedId] = useState(products[0]?.id ?? "");
  const selectedProduct = useMemo(() => products.find((product) => product.id === selectedId) ?? products[0], [products, selectedId]);

  function updateSelectedStatus(status: ProductStatus, toast: string) {
    setProducts((current) => current.map((product) => (product.id === selectedProduct.id ? { ...product, status } : product)));
    onAction(toast, `${selectedProduct.name} 已更新为 mock 状态：${productStatusText[status]}`);
  }

  function createContentTask(type: TaskCreateInput["type"], name: string, batch: string) {
    onCreateTask({
      name,
      type,
      module: "内容生产",
      batch,
      status: "pending",
      inputFiles: ["商品卖点表.xlsx", "合规替代表.xlsx", selectedProduct.sku],
      timeline: ["11:30 从内容生产页创建任务", "11:30 等待 Agent 执行"],
    });
  }

  return (
    <div>
      <PageHeader
        title="内容生产 / 短视频生产"
        subtitle="从批量转录、文案生成到分镜脚本的内容工作台；任务经同一网页端口写入本机队列，并映射到 E:/Github/.claude 的 Agent 工作流。"
        actions={
          <>
            <button className="btn-select" type="button">COPY-20260707-A ▾</button>
            <button className="btn-select" type="button">抖音 / 天猫 / 京东 ▾</button>
            <button className="btn-select" type="button">UPG / FAM / VALUE ▾</button>
          </>
        }
      />

      <div className="module-grid mb-5">
        {contentPipeline.map((step, index) => (
          <Card key={step.id}>
            <div className="mb-2 flex items-center justify-between">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-xs font-bold text-[var(--muted)]">{index + 1}</span>
              <StatusTag label={step.status} tone={step.tone} />
            </div>
            <div className="mb-1 text-[13.5px] font-bold">{step.title}</div>
            <div className="min-h-10 text-xs leading-5 text-[var(--muted)]">{step.desc}</div>
            <ProgressBar value={step.progress} tone={step.tone} />
            <div className="mt-2.5 text-[11.5px] text-[var(--muted)]">{step.meta}</div>
          </Card>
        ))}
      </div>

      <div className="split-grid items-start">
        <Card
          title="商品文案与分镜批次"
          action={
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={() => createContentTask("content_generate", "批量生成文案：COPY-20260707-C", "COPY-20260707-C")} type="button">批量生成文案</button>
              <button className="btn" onClick={() => createContentTask("script_generate", "生成分镜脚本：SCRIPT-20260707-C", "SCRIPT-20260707-C")} type="button">生成分镜脚本</button>
              <button className="btn" onClick={() => createContentTask("export_package", "导出内容生产结果包", "EXPORT-CONTENT-20260707")} type="button">导出结果</button>
            </div>
          }
        >
          <TableShell minWidth={1380}>
            <thead>
              <tr>
                <th>商品名</th>
                <th>SKU</th>
                <th>类目</th>
                <th>价格</th>
                <th>核心卖点</th>
                <th>目标平台</th>
                <th>素材来源</th>
                <th>生成状态</th>
                <th>质量评分</th>
                <th>人工确认</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <button className="text-left font-semibold text-[var(--text)] hover:text-[var(--brand)]" onClick={() => setSelectedId(product.id)} type="button">
                      {product.name}
                    </button>
                  </td>
                  <td>{product.sku}</td>
                  <td>{product.category}</td>
                  <td>{product.price}</td>
                  <td className="max-w-[220px]">{product.coreSellingPoint}</td>
                  <td><PlatformBadge platform={product.targetPlatform} /></td>
                  <td className="max-w-[220px] text-[var(--muted)]">{product.materialSource}</td>
                  <td><StatusTag label={productStatusText[product.status]} tone={productStatusTone[product.status]} /></td>
                  <td>
                    <div className="w-28">
                      <span className="text-xs">{product.qualityScore}</span>
                      <ProgressBar value={product.qualityScore} tone={product.qualityScore >= 80 ? "green" : "orange"} />
                    </div>
                  </td>
                  <td><StatusTag label={product.confirmationStatus} tone={product.confirmationStatus === "已确认" ? "green" : product.confirmationStatus === "需重审" ? "red" : "orange"} /></td>
                  <td>
                    <button className="btn" onClick={() => setSelectedId(product.id)} type="button">查看</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Card>

        <Card title="当前商品生成结果">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <div className="text-[15px] font-bold">{selectedProduct.name}</div>
              <div className="mt-1 text-xs text-[var(--muted)]">{selectedProduct.batch} · {selectedProduct.sku}</div>
            </div>
            <StatusTag label={productStatusText[selectedProduct.status]} tone={productStatusTone[selectedProduct.status]} />
          </div>

          <div className="grid gap-3">
            <section className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3">
              <div className="mb-1 text-xs text-[var(--muted)]">标题</div>
              <div className="font-semibold">{selectedProduct.result.title}</div>
            </section>
            <section className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3">
              <div className="mb-2 text-xs text-[var(--muted)]">三条卖点</div>
              <div className="flex flex-wrap gap-2">
                {selectedProduct.result.sellingPoints.map((point) => <StatusTag key={point} label={point} tone="green" />)}
              </div>
            </section>
            <section className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3">
              <div className="mb-1 text-xs text-[var(--muted)]">种草文案</div>
              <p className="m-0 text-[13px] leading-6">{selectedProduct.result.seedingCopy}</p>
            </section>
            <section className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3">
              <div className="mb-1 text-xs text-[var(--muted)]">短视频口播</div>
              <p className="m-0 text-[13px] leading-6">{selectedProduct.result.videoVoiceover}</p>
            </section>
            <section className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3">
              <div className="mb-1 text-xs text-[var(--muted)]">直播话术入口</div>
              <p className="m-0 text-[13px] leading-6">{selectedProduct.result.liveScript}</p>
            </section>
            <section className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3">
              <div className="mb-1 text-xs text-[var(--muted)]">详情页文案入口</div>
              <p className="m-0 text-[13px] leading-6">{selectedProduct.result.detailCopy}</p>
            </section>
          </div>

          <div className="mt-4 text-[13px] font-bold">分镜脚本</div>
          <TableShell minWidth={760}>
            <thead>
              <tr>
                <th>镜头</th>
                <th>画面描述</th>
                <th>口播</th>
                <th>字幕</th>
                <th>时长</th>
                <th>道具/场景</th>
                <th>风险提示</th>
              </tr>
            </thead>
            <tbody>
              {selectedProduct.result.storyboard.map((shot) => (
                <tr key={shot.shot}>
                  <td>{shot.shot}</td>
                  <td>{shot.visual}</td>
                  <td>{shot.voiceover}</td>
                  <td>{shot.subtitle}</td>
                  <td>{shot.duration}</td>
                  <td>{shot.propScene}</td>
                  <td>{shot.risk}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>

          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn" onClick={() => { updateSelectedStatus("running", "重新生成"); createContentTask("content_generate", `${selectedProduct.name} 重新生成`, `REGEN-${selectedProduct.sku}`); }} type="button">重新生成</button>
            <button className="btn-primary" onClick={() => updateSelectedStatus("confirmed", "人工确认完成")} type="button">人工确认</button>
            <button className="btn" onClick={() => createContentTask("quality_check", `${selectedProduct.name} 加入质检`, `QC-${selectedProduct.sku}`)} type="button">加入质检</button>
            <button className="btn" onClick={() => createContentTask("export_package", `${selectedProduct.name} 导出结果`, `EXPORT-${selectedProduct.sku}`)} type="button">导出结果</button>
          </div>
        </Card>
      </div>
    </div>
  );
}
