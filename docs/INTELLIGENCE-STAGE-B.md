# 竞品情报 Stage B：xlsx 上传 + 半自动 pipeline 设计

**Stage A（已实现）**：60 行离线分析嵌入前端，"开始抓取"按钮拆为「刷新分析」+「网页实时抓取(disabled)」
**Stage B（部分实现）**：本地 source_raw.xlsx 可执行图片提取、Vision/Mock 分析和结构化合并；浏览器上传、目录监视和生产级异步队列仍待实施。

---

## 目标

让"网页实时抓取"仍然保持 disabled，但**运营可以在网页上传新一批 xlsx**，触发 pipeline 的可自动化部分：

```
用户上传 xlsx
  ↓ /api/intelligence/import
server 保存到 local-data/intelligence/uploads/{timestamp}-{filename}
  ↓ [自动] 调用 竞品主图分析/scripts/01_extract_images.py
抽取 60 张 DISPIMG 图 → local-data/intelligence/images/
  ↓ [自动] 前端刷新 UI 提示："图片已抽取，等待 85 字段分析"
  ↓ [半自动] 用户在本地用视觉 LLM 生成 batch{1..10}_results.json
  ↓ 用户把 JSON 放入 local-data/intelligence/pending-batches/
  ↓ [自动] server 检测到 batch*.json 就位，跑合并 + 生成 top100.json
  ↓ 前端刷新 UI 提示："分析已完成，可查看新榜单"
```

## 待实施拆分

### 后端
1. `server/intelligence-pipeline.mjs` 新模块：封装 python 脚本调用（child_process.spawn）
2. `POST /api/intelligence/import` 接收 xlsx multipart，保存后触发 `01_extract_images.py`
3. `GET /api/intelligence/import/:id/status` 查询进度（extracting / waiting_analysis / merging / done / failed）
4. 文件监听：`chokidar` 观察 `local-data/intelligence/pending-batches/`，自动跑 `03_merge_and_write.py` + `build-intelligence-dataset.mjs`

### 前端
5. `src/components/UploadIntelligenceDialog.tsx`：xlsx 上传弹窗，展示 pipeline 4 步进度条
6. `IntelligencePage` 右上角"刷新分析"下拉：`🔄 刷新` / `📤 导入新一批 xlsx` / `🌐 网页抓取(disabled)`
7. 中间步骤 UI 提示："已抽取 60 张图，请生成 batch*.json 后放入 pending-batches/"
8. `src/services/intelligenceApi.ts` 加 `importXlsx` / `getImportStatus`

### 数据 / 脚本
9. `竞品主图分析/scripts/` 复用现有 01/03/04；新增 `07_watch_pending_batches.py` 可选
10. 复用 `ecom-ai-studio/local-data/` 隔离：`uploads/` `images/` `pending-batches/` `archive/`

## 待确认项（完整上传链路实施前需回答）

1. **视觉 LLM 分析这一步**是否需要接入项目自己的 `douyin-video-copy-analyst` 类 Agent，还是保持"人工放 JSON"的半自动模式？
   - 影响：如果接入 Agent，需要额外的 `POST /api/intelligence/analyze` 端点 + Agent 队列
   - 建议：首版保持半自动，Stage C 再评估
2. **xlsx 格式约束**：是否强制新上传的 xlsx 必须遵循 `00_原始表.xlsx` 的 DISPIMG 列位置？
   - 影响：如果格式松散，`01_extract_images.py` 需要更多容错
   - 建议：出一个"模板下载"按钮，规范上传格式
3. **图片和 JSON 的生命周期**：新一批上传后，旧的 top100.json 是覆盖还是归档？
   - 影响：归档需要多一个 `local-data/intelligence/archive/YYYY-MM-DD/` 目录 + UI 版本切换器
   - 建议：默认归档，UI 加一个"历史版本"下拉
4. **权限**：是否所有用户都能触发上传，还是只有特定角色？
   - 当前 ecom-ai-studio 没有用户系统，暂不做鉴权
   - 建议：Stage B 先保持无鉴权，如果上生产再补 basic auth

## 成本估算

| 项 | 估算 |
|---|---|
| 后端 4 项 | 半天 |
| 前端 4 项 | 半天 |
| 数据/脚本适配 | 1~2 小时 |
| 端到端测试 + 上传新 xlsx 全链路跑通 | 半天 |
| **合计** | **1~2 天** |

## 明确不做的事（避免范围蔓延）

- ❌ 真实网页爬虫（保持 disabled + tooltip）
- ❌ 视觉 LLM 全自动分析（Stage C 再评估）
- ❌ 用户鉴权 / 角色管理
- ❌ 多榜单并行（618 / 双11 / 春节 分别有独立榜单）
- ❌ 竞品价格监控 Tab 接真实数据（保持 mock）

---

**Stage A 完工记录**：见 .learnings/SESSION-LOG.md 2026-07-14 条目
**Stage B 完整实施条件**：运营明确需要通过浏览器自主上传并持续更新榜单
