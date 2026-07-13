import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { dataDir } from "./storage.mjs";

const projectRoot = "E:\\Github";
const claudeRoot = join(projectRoot, ".claude");
const agentsDir = join(claudeRoot, "agents");
const workflowFile = join(claudeRoot, "agent-workflows", "douyin-ecom-copy-workflow.md");
const promptFile = join(claudeRoot, "agent-workflows", "codex-compatible-prompts.md");

const expectedAgents = [
  "douyin-video-transcriber",
  "douyin-video-copy-analyst",
  "copy-material-library-manager",
  "home-material-intake",
  "product-template-filler",
  "mattress-upgrade-copy-producer",
  "mattress-family-pain-copy-producer",
  "mattress-config-value-copy-producer",
  "copy-quality-deduper",
  "douyin-copy-compliance-reviewer",
  "compliance-rewrite-producer",
  "douyin-storyboard-script-writer",
];

export async function getWorkflowStatus() {
  let files = [];
  try {
    files = await readdir(agentsDir);
  } catch {
    files = [];
  }
  const installed = new Set(files.filter((file) => file.endsWith(".md")).map((file) => basename(file, ".md")));
  const agents = expectedAgents.map((name) => ({ name, installed: installed.has(name) }));
  const readyCount = agents.filter((agent) => agent.installed).length;

  return {
    id: "douyin-ecom-copy",
    name: "抖音电商文案与分镜工作流",
    status: readyCount === expectedAgents.length && existsSync(workflowFile) ? "ready" : "incomplete",
    localRoot: claudeRoot,
    workflowFile,
    promptFile,
    readyCount,
    expectedCount: expectedAgents.length,
    agents,
    stages: ["素材接入", "转录/拆解", "UPG/FAM/VALUE 并行生产", "去重质检", "合规复核", "分镜脚本", "人工确认"],
    executionPort: "/api/workflows/douyin-ecom-copy/run",
  };
}

export async function queueWorkflowEnvelope(task) {
  if (!new Set(["content_generate", "script_generate", "quality_check"]).has(task.type)) return null;
  const inbox = join(dataDir, "workflow-inbox");
  await mkdir(inbox, { recursive: true });
  const filePath = join(inbox, `${task.id}.json`);
  const envelope = {
    schemaVersion: 1,
    workflowId: "douyin-ecom-copy",
    taskId: task.id,
    taskType: task.type,
    batch: task.batch,
    createdAt: new Date().toISOString(),
    executionMode: "local_queue",
    sourceWorkflow: workflowFile,
    inputFiles: task.inputFiles ?? [],
    outputDirectory: join(dataDir, "workflow-output", task.id),
    constraints: ["不操作真实店铺", "不发布内容", "不写入平台账号", "输出需人工确认"],
  };
  await writeFile(filePath, JSON.stringify(envelope, null, 2), "utf8");
  return { ...envelope, queueFile: filePath };
}

export { claudeRoot };
