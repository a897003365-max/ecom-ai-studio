import { Card } from "../components/Card";
import { MetricCard } from "../components/MetricCard";
import { PageHeader } from "../components/PageHeader";
import { StatusTag } from "../components/StatusTag";
import { TableShell } from "../components/TableShell";
import { productAssetSummary, productAssets } from "../data/mock";
import type { TaskCreateInput } from "../types";

interface ProductAssetsPageProps {
  onAction: (title: string, detail?: string) => void;
  onCreateTask: (task: TaskCreateInput) => void;
}

export function ProductAssetsPage({ onAction, onCreateTask }: ProductAssetsPageProps) {
  function createContentTask(assetName: string, sku: string) {
    onCreateTask({
      name: `${assetName} 文案与分镜预生成`,
      type: "content_generate",
      module: "内容生产",
      batch: "COPY-20260707-ASSET",
      inputFiles: [sku, "商品资产表"],
      timeline: ["11:30 从商品资产创建内容任务", "11:30 等待文案 Agent 执行"],
    });
  }

  function createImageTask(assetName: string, sku: string) {
    onCreateTask({
      name: `${assetName} 图片资产批处理`,
      type: "image_process",
      module: "图片处理",
      batch: "IMG-20260707-ASSET",
      inputFiles: [sku, "本地素材文件夹"],
      timeline: ["11:30 从商品资产创建图片任务", "11:30 等待图片处理脚本执行"],
    });
  }

  return (
    <div>
      <PageHeader
        title="商品资产"
        subtitle="维护商品素材来源、SKU 完整度和可用于内容生产的资产状态，为文案、分镜、图片处理和运营复盘提供统一输入。"
        actions={
          <>
            <button className="btn" onClick={() => onAction("同步商品表", "已模拟读取本地 Excel / CSV 商品资产")} type="button">同步商品表</button>
            <button className="btn-primary" onClick={() => onAction("导入素材", "已模拟扫描本地素材文件夹")} type="button">导入素材</button>
          </>
        }
      />

      <div className="metric-grid mb-5">
        {productAssetSummary.map((item) => (
          <MetricCard key={item.label} metric={{ label: item.label, value: item.value, detail: item.detail, tone: item.tone }} />
        ))}
      </div>

      <Card title="商品素材资产清单">
        <TableShell minWidth={1180}>
          <thead>
            <tr>
              <th>商品名</th>
              <th>SKU</th>
              <th>类目</th>
              <th>价格带</th>
              <th>素材来源</th>
              <th>图片资产</th>
              <th>视频素材</th>
              <th>内容生产</th>
              <th>待补充字段</th>
              <th>负责人</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {productAssets.map((asset) => (
              <tr key={asset.id}>
                <td className="font-semibold">{asset.name}</td>
                <td>{asset.sku}</td>
                <td>{asset.category}</td>
                <td>{asset.priceBand}</td>
                <td className="max-w-[260px]">{asset.materialSource}</td>
                <td>{asset.imageCount}</td>
                <td>{asset.videoCount}</td>
                <td>
                  <StatusTag label={asset.contentReady ? "可用于生产" : "需补字段"} tone={asset.contentReady ? "green" : "orange"} />
                </td>
                <td>
                  {asset.missingFields.length ? (
                    <div className="flex max-w-[240px] flex-wrap gap-1.5">
                      {asset.missingFields.map((field) => <StatusTag key={field} label={field} tone="orange" />)}
                    </div>
                  ) : (
                    <StatusTag label="完整" tone="green" />
                  )}
                </td>
                <td>{asset.owner}</td>
                <td>{asset.lastUpdated}</td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn" onClick={() => createContentTask(asset.name, asset.sku)} type="button">生成文案</button>
                    <button className="btn" onClick={() => createImageTask(asset.name, asset.sku)} type="button">处理图片</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Card>
    </div>
  );
}
