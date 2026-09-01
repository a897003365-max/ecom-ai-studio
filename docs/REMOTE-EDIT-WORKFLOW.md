# ecom_aistudio 远程编辑与部署工作流（经验总结）

> 2026-08 由 l-user-1 侧排查总结。适用场景：在另一台机器上修改本站点（http://100.113.194.123:5174/）并让改动生效。

## 1. 架构关键事实（踩坑后确认）

- **5174 不是 Vite 开发服务器**，而是生产模式：`node server/index.mjs --production`，托管 `<项目>/dist`（`server/index.mjs` 第 44/47/1217 行）。
- 因此**只改 `src/` 源码不会让页面变化**，必须重新 `npm run build` 生成新 dist。
- 本机（l-user-1）的 `E:\Github\tmall-sku-price\.tmp-ecom\src-mirror` 只是历史遗留的**只读镜像**（由 `download-src.py` 经 WebDAV 下载用于 tsc 检查），改它完全无效，勿再编辑。
- 修改源码后若页面没变，先用 `curl http://100.113.194.123:5174/src/pages/<文件>` 验证 dev/production 模式，再看 HTML 里是否引用 `/assets/index-*.js`（= production 构建产物）。

## 2. 本机（l-user）当前部署状态

- **Taildrive 源码共享已发布**：共享名 `ecom_aistudio` → `E:\ecom-ai-studio-share`（junction 直通真源码 `src/`、`server/`、`docs/` 等；不含 .env / node_modules / local-data / dist）。
- **自动重建看门狗已启动并注册为计划任务**（`EcomAIStudio-AutoRebuild-Watcher`，登录自启）：监听真源码 `src/`、`server/`，检测到变更 → 2 秒 debounce → `npm run build` → 重启 5174。**构建失败会保留旧 dist 继续服务**，日志在 `logs/auto-rebuild.log`。
- 5174 服务由 `EcomAIStudio-Tailscale-Server` 计划任务 + 5 秒看门狗保活，**无需任何人手动重启**。

## 3. 推荐编辑通道

### A. Taildrive 直改（最快，改完即生效）

1. 文件资源管理器地址栏输入：`\\100.113.194.123\taildrive\ecom_aistudio`
   （权限：l-user-1 为 **rw 读写**；l-user-2 / l-user-3 / chinami 只读。）
2. 像本地目录一样直接编辑 `src/` 下文件，保存即可。
3. 写入通过 junction 实时落到真源码，看门狗 ~3 秒内自动构建并重启 5174，浏览器 **Ctrl+F5** 强刷即生效。
4. 构建失败时看门狗不会重启服务、旧版继续跑；排错看 `logs/auto-rebuild.log`。

### B. WebDAV 代理（本机 SMB 不通时的实测可用备选）

- 读写端点：`http://100.100.100.100:8080/a897003365%40gmail.com/l-user/ecom_aistudio/`
- 下载：`curl -s <BASE>/src/pages/X.tsx`；列目录：`curl -X PROPFIND -H "Depth: 1" <BASE>/dir/`
- 上传：`curl -X PUT -T 本地文件 <BASE>/src/pages/X.tsx`（返回 201 Created 即成功）
- 注意：该通道同样只写源码，需等看门狗自动构建；`dist/` 不在共享内，无法直接改产物。

### C. Git 流程（正式留痕）

另一台 `git push origin agent/publish-ecom-ai-studio` → l-user 侧 `git pull` + 构建（或等看门狗）。适合需要提交记录的改动。

## 4. 通道选择与冲突注意

| 场景 | 用哪个 |
|---|---|
| 快速改完立即看效果 | Taildrive（或 WebDAV）+ 看门狗 |
| 正式提交、多人协作 | Git |
| 只做类型检查/本地分析 | 本地 src-mirror（只读，勿编辑） |

- ⚠️ 不要在同一文件上同时存在未提交的本地修改和远端直改，容易冲突。
- ⚠️ 直改覆盖文件时注意保留对方会话里未提交的修复（例如某次会话修过 `IntelligencePage.tsx` 的 import 路径 + 泛型三处编译错误）。构建失败会被看门狗安全跳过，服务不受影响，但改动不生效。

## 5. 实测验证记录（2026-08-31，l-user-1 侧执行）

### 通道实测结论

| 通道 | 结果 |
|---|---|
| Taildrive SMB `\\100.113.194.123\taildrive\ecom_aistudio` | ❌ 从本机（用户名恰好也叫 `l-user\administrator`，但 Tailscale IP 不同）**不可达**，Test-Path False。注意：本机机器名与站点机同名易混淆，以 Tailscale IP 为准（站点机=100.113.194.123） |
| WebDAV 代理 `100.100.100.100:8080` PUT/GET/PROPFIND | ✅ 读写均可用（201 Created），且 GET 回读内容正确 |
| 看门狗自动重建 | ✅ 有效：PUT 源码后 ~20-40s 内 5174 的 bundle hash 变化（QQOJBHUb→BVD3Hb3l→DvZqJWFj），服务自动重启，无需人工干预 |

### ⚠️ 发现的不一致（重要）

WebDAV 共享里的 `src/pages/IntelligencePage.tsx` 已确认包含最新改动，但**最新构建产物** `assets/IntelligencePage-BQmiOFAd.js` 中该单元格仍是 `children:s.salesRange`（无 `||item.priceRange` 回退）。两次触发重建后 chunk hash 未变。可能原因：WebDAV 共享目录与看门狗监听/构建的真源码目录**不是同一份物理拷贝**（同步滞后或单向同步）。

**交接事项（请站点机 AI/管理员处理）**：确认 `src/pages/IntelligencePage.tsx` 中 TOP100 表格单元格为
`{item.salesRange || item.priceRange || "-"}`
（表头已是「支付买家数」）。若构建产物里没有该回退逻辑，说明构建用的目录与共享目录不同步，请同步后重建。

### 字段映射 bug（已在源码修复，待下次 pipeline 运行生效）

`scripts/read-ranking-rows.py` 原第 121 行把 Excel「支付买家数」列写进 `"price"` 字段、`"sales"` 恒为空 → 线上 `top100.json` 的 `priceRange` 装的是买家数区间（如 "250 ~ 500"）、`salesRange` 全空 → 页面「支付买家数」列显示空白/0。已修复为 `"price": ""`、`"sales": <支付买家数>`，并在 `scripts/build-intelligence-dataset.mjs` 的 `salesRange` 加了回退。**旧缓存（analysis-cache/*/pipeline-results.json）里的 raw.price 仍是买家数，前端已用 `salesRange || priceRange` 回退兼容，无需重跑视觉分析。**

## 6. 本次实际案例（价格带 → 支付买家数）

- 需求：TOP100 表格的「价格带」列恢复为原 Excel 的「支付买家数」口径。
- 改动（`src/pages/IntelligencePage.tsx`）：删「价格带」+「月销」两列 → 合并为「支付买家数」（`item.salesRange`）；加载占位 `colSpan` 11→10。
- 踩坑过程：先改了本地 src-mirror（无效）→ PUT 到 WebDAV 源码（成功但页面没变）→ 发现 5174 是 production 构建 → 最终靠看门狗自动重建生效。
- 经验：**改动是否生效的唯一判据是刷新页面 + Ctrl+F5，构建日志看 `logs/auto-rebuild.log`。**
