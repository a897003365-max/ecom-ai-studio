const taskPermissionByType = Object.freeze({
  content_generate: "content.manage",
  script_generate: "content.manage",
  quality_check: "content.manage",
  image_process: "images.manage",
  competitor_crawl: "intelligence.manage",
  top100_crawl: "intelligence.manage",
  data_sync: "tasks.manage",
  export_package: "tasks.manage",
});

export function requiredTaskPermission(taskType) {
  const permission = taskPermissionByType[taskType];
  if (!permission) throw new Error(`不支持的任务类型：${String(taskType || "")}`);
  return permission;
}
