import { useEffect, useRef, useState } from "react";
import { Card } from "../components/Card";
import { PageHeader } from "../components/PageHeader";
import { StatusTag } from "../components/StatusTag";
import { agentResponsibilities, configGroups } from "../data/mock";
import { getDataSources, syncDataSource, uploadLocalDataFile } from "../services/localApi";
import type { Tone } from "../types";
import type { ConnectionStatus, DataSourcesPayload } from "../types/integration";

interface SettingsPageProps {
  onAction: (title: string, detail?: string) => void;
  canManage: boolean;
}

const visibleConfigGroups = Object.fromEntries(
  Object.entries(configGroups).filter(([group]) => !["本机环境", "接口占位"].includes(group)),
);

function sourceDisplayDetail(source: DataSourcesPayload["sources"][number]) {
  const records = source.records.toLocaleString("zh-CN");
  if (source.id === "warehouse") return `${records} 行经营数据已入库`;
  if (source.id === "workflow") return `${records} 个生产 Agent 可用`;
  if (source.id === "dingtalk") return `${records} 条经营记录 · 每日自动同步`;
  return `${records} 条汇总记录`;
}

function uploadStatusLabel(status: string) {
  return ({ waiting_parse: "待处理", imported: "已导入", failed: "导入失败" } as Record<string, string>)[status] ?? status;
}

function policyItemLabel(item: string) {
  if (item.includes(".claude")) return "内容生产工作流";
  if (item.includes("DuckDB")) return "经营数据仓库";
  if (item.includes("Parquet")) return "增量数据分区";
  if (item.includes("xsec_token")) return "带访问凭证的外部链接";
  if (item.includes("App Secret")) return "应用密钥、访问令牌与登录凭证";
  return item;
}

export function SettingsPage({ onAction, canManage }: SettingsPageProps) {
  const [tokenMode, setTokenMode] = useState("不在浏览器保存");
  const [dataSources, setDataSources] = useState<DataSourcesPayload | null>(null);
  const [syncing, setSyncing] = useState<"warehouse" | "feishu" | "dingtalk" | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const uploadCategory = useRef("operations_manual_import");

  function loadSources(showFeedback = false) {
    getDataSources()
      .then((payload) => {
        setDataSources(payload);
        if (showFeedback) onAction("环境检测完成", "数据连接与工作流状态已刷新");
      })
      .catch((error: unknown) => {
        if (showFeedback) onAction("本地服务不可用", error instanceof Error ? error.message : "请确认本地服务已启动");
      });
  }

  useEffect(() => {
    loadSources();
  }, []);

  async function handleSync(source: "warehouse" | "feishu" | "dingtalk") {
    setSyncing(source);
    try {
      await syncDataSource(source);
      loadSources();
      const details = {
        warehouse: "经营数据与看板快照已更新",
        feishu: "飞书共享表已完成脱敏聚合",
        dingtalk: "钉钉共享表已完成只读同步并生成脱敏快照",
      };
      onAction("数据同步完成", details[source]);
    } catch (error) {
      onAction("数据同步失败", error instanceof Error ? error.message : "请检查本机数据源状态");
    } finally {
      setSyncing(null);
    }
  }

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const category = uploadCategory.current;
      const upload = await uploadLocalDataFile(file, category);
      loadSources();
      onAction(
        category === "dingtalk_operations" ? "钉钉数据已完成本机导入" : "文件已进入本地导入队列",
        category === "dingtalk_operations"
          ? `${file.name} 已生成脱敏聚合快照，原始行不会写入看板数据库`
          : `${file.name} 已进入导入队列，当前状态：${uploadStatusLabel(upload.status)}`,
      );
    } catch (error) {
      onAction("上传失败", error instanceof Error ? error.message : "仅支持 10 MB 内的 CSV/XLSX/JSON");
    } finally {
      setUploading(false);
      if (uploadInput.current) uploadInput.current.value = "";
    }
  }

  function openUpload(category: "operations_manual_import" | "dingtalk_operations") {
    uploadCategory.current = category;
    uploadInput.current?.click();
  }

  function statusTone(status: ConnectionStatus): Tone {
    if (status === "connected" || status === "ready") return "green";
    if (status === "cached") return "blue";
    if (status === "auth_required") return "orange";
    return "red";
  }

  return (
    <div>
      <PageHeader
        title="系统设置"
        subtitle="管理数据连接、同步计划与内容生产工作流，敏感信息仅在本机保存。"
        actions={
          <>
            <button className="btn" onClick={() => loadSources(true)} type="button">检测环境</button>
            <button className="btn-primary" disabled={!canManage} onClick={() => onAction("配置已保留", "连接设置由本机服务读取，不在浏览器保存密钥")} title={canManage ? "保存系统配置" : "当前账号仅可查看设置"} type="button">保存配置</button>
          </>
        }
      />

      <Card
        title="数据源连接中心"
        className="mb-4"
        action={
          <>
            <input
              accept=".csv,.xlsx,.json"
              className="hidden"
              onChange={(event) => event.target.files?.[0] && void handleUpload(event.target.files[0])}
              ref={uploadInput}
              type="file"
            />
            <button className="btn" disabled={uploading || !canManage} onClick={() => openUpload("operations_manual_import")} type="button">
              {uploading ? "写入中..." : "上传脱敏数据"}
            </button>
          </>
        }
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(dataSources?.sources ?? []).map((source) => (
            <div className="min-w-0 rounded-lg border border-[var(--border)] bg-white/[0.02] p-3" key={source.id}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0 text-[13.5px] font-bold">{source.name}</div>
                <StatusTag label={source.statusLabel} tone={statusTone(source.status)} dot />
              </div>
              <div className="min-h-10 text-xs leading-5 text-[var(--muted)]">{sourceDisplayDetail(source)}</div>
              <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-[var(--muted)]">
                <span>{source.lastSync ? new Date(source.lastSync).toLocaleString("zh-CN") : "尚无同步历史"}</span>
                {source.id === "warehouse" && <button className="btn" disabled={syncing !== null || !canManage} onClick={() => void handleSync("warehouse")} type="button">{syncing === "warehouse" ? "建仓中" : "同步"}</button>}
                {source.id === "feishu" && <button className="btn" disabled={syncing !== null || !canManage} onClick={() => void handleSync("feishu")} type="button">{syncing === "feishu" ? "聚合中" : "同步"}</button>}
                {source.id === "dingtalk" && (
                  <div className="flex gap-1.5">
                    <button className="btn" disabled={syncing !== null || !canManage} onClick={() => void handleSync("dingtalk")} type="button">{syncing === "dingtalk" ? "读取中" : "同步"}</button>
                    <button className="btn" disabled={uploading || !canManage} onClick={() => openUpload("dingtalk_operations")} type="button">文件回退</button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {!dataSources && (
            <div className="rounded-lg border border-[var(--border)] p-3 text-xs leading-5 text-[var(--muted)] md:col-span-2 xl:col-span-4">
              正在读取连接状态，请稍候。
            </div>
          )}
        </div>
      </Card>

      <div className="mb-4 grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Card title="数据接入与上传分级">
          <div className="grid gap-3 md:grid-cols-2">
            {(dataSources?.uploadPolicy ?? []).map((group) => (
              <div className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3" key={group.id}>
                <div className="mb-2 flex items-center justify-between gap-2"><div className="font-bold">{group.category}</div><StatusTag label={group.items.length.toString()} tone={group.tone} /></div>
                <div className="flex flex-wrap gap-1.5">{group.items.map((item) => <StatusTag key={item} label={policyItemLabel(item)} tone="muted" />)}</div>
                <div className="mt-2 text-xs leading-5 text-[var(--muted)]">{group.reason}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="数据处理与工作流状态">
          <div className="grid gap-3">
            {dataSources?.warehouse && (
              <div className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3">
                <div className="flex items-center justify-between gap-2"><div className="text-[13px] font-bold">经营数据仓库</div><StatusTag label={`${dataSources.warehouse.completedQueries}/${dataSources.warehouse.queryCount} 数据集`} tone={dataSources.warehouse.failedPartitionCount ? "orange" : "green"} dot /></div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px] text-[var(--muted)]">
                  <div><b className="block text-[13px] text-[var(--text)]">{dataSources.warehouse.sourceFileCount}</b>数据文件</div>
                  <div><b className="block text-[13px] text-[var(--text)]">{dataSources.warehouse.partitionCount}</b>已入库</div>
                  <div><b className="block text-[13px] text-[var(--text)]">{dataSources.warehouse.rowCount.toLocaleString("zh-CN")}</b>数据行</div>
                </div>
              </div>
            )}
            {dataSources?.workflow && (
              <div className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3">
                <div className="flex items-center justify-between gap-2"><div className="text-[13px] font-bold">内容生产工作流</div><StatusTag label={`${dataSources.workflow.readyCount}/${dataSources.workflow.expectedCount} 就绪`} tone={dataSources.workflow.status === "ready" ? "green" : "red"} dot /></div>
                <div className="mt-2 text-xs leading-5 text-[var(--muted)]">{dataSources.workflow.stages.join(" → ")}</div>
              </div>
            )}
            {(dataSources?.uploads.length ?? 0) > 0 && (
              <div className="text-xs text-[var(--muted)]">最近导入：{dataSources?.uploads[0]?.fileName} · {uploadStatusLabel(dataSources?.uploads[0]?.status ?? "")}</div>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {Object.entries(visibleConfigGroups).map(([group, items]) => (
          <Card title={group} key={group}>
            <div className="grid gap-3">
              {items.map((item) => (
                <div className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3" key={`${group}-${item.name}`}>
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[13.5px] font-bold">{item.name}</div>
                      <div className="mt-1 text-xs leading-5 text-[var(--muted)]">{item.desc}</div>
                    </div>
                    <StatusTag label={item.status} tone={item.tone} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card title="连接与安全设置">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1.5 text-xs text-[var(--muted)]">
              模型服务密钥
              <input className="input-field" placeholder="从当前安全模式读取" type="password" />
            </label>
            <label className="grid gap-1.5 text-xs text-[var(--muted)]">
              飞书应用凭证
              <input className="input-field" placeholder="从当前安全模式读取" type="password" />
            </label>
            <label className="grid gap-1.5 text-xs text-[var(--muted)]">
              本地脚本目录
              <input className="input-field" defaultValue="E:/Github/scripts" />
            </label>
            <label className="grid gap-1.5 text-xs text-[var(--muted)]">
              本地素材文件夹
              <input className="input-field" defaultValue="E:/素材/电商素材" />
            </label>
            <label className="grid gap-1.5 text-xs text-[var(--muted)] md:col-span-2">
              安全模式
              <select className="input-field" value={tokenMode} onChange={(event) => setTokenMode(event.target.value)}>
                <option>不在浏览器保存</option>
                <option>从环境变量读取</option>
                <option>从本机加密配置读取</option>
              </select>
            </label>
          </div>
          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--orange-bg)] px-3 py-2 text-xs leading-5 text-[var(--orange)]">
            当前选择：{tokenMode}。密钥不会写入页面数据或操作日志。
          </div>
        </Card>

        <Card title="AI / 人工分工配置">
          <div className="grid gap-3">
            {agentResponsibilities.map((item) => (
              <div className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3" key={item.businessLine}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-bold">{item.businessLine}</div>
                  <StatusTag label="重复交给 AI，判断留给人" tone="blue" />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-2 font-bold text-[var(--brand)]">AI / Agent 负责</div>
                    <ul className="m-0 grid gap-1.5 pl-4 text-[13px] leading-6 text-[var(--muted)]">
                      {item.ai.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-2 font-bold text-[var(--orange)]">人工负责</div>
                    <ul className="m-0 grid gap-1.5 pl-4 text-[13px] leading-6 text-[var(--muted)]">
                      {item.human.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
