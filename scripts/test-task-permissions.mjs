import assert from "node:assert/strict";
import { requiredTaskPermission } from "../server/task-permissions.mjs";

assert.equal(requiredTaskPermission("content_generate"), "content.manage");
assert.equal(requiredTaskPermission("script_generate"), "content.manage");
assert.equal(requiredTaskPermission("quality_check"), "content.manage");
assert.equal(requiredTaskPermission("image_process"), "images.manage");
assert.equal(requiredTaskPermission("competitor_crawl"), "intelligence.manage");
assert.equal(requiredTaskPermission("top100_crawl"), "intelligence.manage");
assert.equal(requiredTaskPermission("data_sync"), "tasks.manage");
assert.equal(requiredTaskPermission("export_package"), "tasks.manage");
assert.throws(() => requiredTaskPermission("unknown_task"), /不支持的任务类型/);

console.log("task permissions: ok");
