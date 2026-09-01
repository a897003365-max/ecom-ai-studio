import assert from "node:assert/strict";
import { workflowEnvelopePaths } from "../server/workflow.mjs";

const root = "E:\\temp\\workflow-security-root";
const safe = workflowEnvelopePaths("copy_batch-20260718", root);

assert.equal(safe.taskId, "copy_batch-20260718");
assert.equal(safe.queueFile, "E:\\temp\\workflow-security-root\\workflow-inbox\\copy_batch-20260718.json");
assert.equal(safe.outputDirectory, "E:\\temp\\workflow-security-root\\workflow-output\\copy_batch-20260718");

for (const maliciousId of ["..\\..\\package", "../package", "copy/batch", "copy:batch", "copy batch", "copy.json"]) {
  assert.throws(() => workflowEnvelopePaths(maliciousId, root), /任务 ID 不合法/);
}

console.log("workflow task id security: ok");
