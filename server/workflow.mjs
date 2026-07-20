import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
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

const taskIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

function isWithin(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export function workflowEnvelopePaths(taskId, root = dataDir) {
  const normalizedTaskId = String(taskId ?? "").trim();
  if (!taskIdPattern.test(normalizedTaskId)) {
    throw new Error("任务 ID 不合法：仅支持 1-80 位字母、数字、下划线和连字符，且必须以字母或数字开头");
  }
  const dataRoot = resolve(root);
  const inbox = resolve(dataRoot, "workflow-inbox");
  const outputDirectory = resolve(dataRoot, "workflow-output", normalizedTaskId);
  const queueFile = resolve(inbox, `${normalizedTaskId}.json`);
  if (!isWithin(dataRoot, inbox) || !isWithin(dataRoot, outputDirectory) || !isWithin(inbox, queueFile)) {
    throw new Error("任务 ID 不合法：工作流文件路径越出本地数据目录");
  }
  return { taskId: normalizedTaskId, inbox, outputDirectory, queueFile };
}

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
  const paths = workflowEnvelopePaths(task.id);
  const { inbox, outputDirectory, queueFile } = paths;
  await mkdir(inbox, { recursive: true });
  const envelope = {
    schemaVersion: 1,
    workflowId: "douyin-ecom-copy",
    taskId: paths.taskId,
    taskType: task.type,
    batch: task.batch,
    createdAt: new Date().toISOString(),
    executionMode: "local_queue",
    sourceWorkflow: workflowFile,
    inputFiles: task.inputFiles ?? [],
    outputDirectory,
    constraints: ["不操作真实店铺", "不发布内容", "不写入平台账号", "输出需人工确认"],
  };
  const temporaryFile = `${queueFile}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  try {
    await writeFile(temporaryFile, JSON.stringify(envelope, null, 2), "utf8");
    await rename(temporaryFile, queueFile);
  } finally {
    await rm(temporaryFile, { force: true });
  }
  return { ...envelope, queueFile };
}

export { claudeRoot };
