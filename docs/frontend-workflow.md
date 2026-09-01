# 设计原型到工程实现工作流

## 目标

使用 Open Design 产出视觉方向，Codex 完成工程实现，DevTools / Piny 进行可视化微调，最后由 Codex 收敛响应式与代码质量。全程保留现有业务逻辑、接口、权限、路由、数据结构和功能行为。

## 1. Open Design：原型

输入：

- 根目录 [`../DESIGN.md`](../DESIGN.md)
- 当前页面源码与截图
- `design/references/` 中的参考资料
- 目标页面、目标状态和允许调整范围

输出：

- `design/prototypes/<page-name>/` 下的原型
- `design/screenshots/` 下的目标截图
- `design/DESIGN.md` 中的页面级差异
- 必要时在 `design/notes/` 记录取舍

Open Design 不定义业务接口，不替换真实数据口径，不直接覆盖生产页面。

## 2. Codex：工程实现

修改页面前必须：

1. 阅读 `AGENTS.md`、根目录 [`../DESIGN.md`](../DESIGN.md) 和 `design/DESIGN.md`。
2. 检查 Git 状态与目标文件差异，避免覆盖未提交修改。
3. 核对目标页面、现有组件、接口调用和响应式行为。

实现规则：

- 优先复用现有组件，不擅自修改业务接口、权限、路由或数据结构。
- 基础 UI 与业务组件分离；不把整页塞进超大组件，也不拆无复用价值的小组件。
- 新样式必须使用 `src/styles/tokens.css` 或 Tailwind 语义 Token。
- 不只针对单一屏幕写死布局，不为匹配截图大量使用绝对定位。
- 不用固定高度裁切动态内容；宽表使用横向滚动。
- 不随意增加 UI 框架或高侵入性运行时依赖。
- 保留清晰组件名、稳定 className、语义 HTML；核心模块使用 `data-ui`。

完成后运行：

```text
npm run lint
npm run typecheck
npm run build
npm test
git diff --check
```

输出修改文件清单、视觉变化、验证结果、未验证项和残余风险。

## 3. DevTools / Piny：可视化微调

### DevTools

1. 在目标宽度打开页面，优先用 `[data-ui="..."]` 定位。
2. 在 Styles / Layout 面板临时调整 width、gap、padding、Flex 或 Grid。
3. 同时检查父容器的 `min-width`、`overflow`、`position` 和高度约束。
4. 将确认值按 `design/README.md` 模板写入 `design/notes/`，再由 Codex回写。

### Piny

当前项目是 React + Vite + Tailwind CSS，具备 Piny 的框架条件。建议：

- 在 VS Code / Cursor / Windsurf 安装 Piny 扩展后，从目标 TSX 右键选择 `Edit in Piny`。
- 项目根目录打开为单一 workspace，使用 `npm run dev:ui` 做纯前端预览，或 `npm run dev` 联调真实本地接口。
- 将 Piny 自定义主题指向 `tailwind.config.cjs`；语义 Token 会出现在 Tailwind 主题中。
- 优先编辑静态 Tailwind 类。全局 CSS 组件类、SVG 坐标和数据驱动行内宽度仍由源码/DevTools 调整。
- Piny 写回后先检查 Git diff，再运行完整验证；不要批量接受无法解释的任意值。

Piny 是 IDE 扩展，本项目不需要为它加入运行时包或注入脚本。Visual Select 等能力可能受扩展版本或授权方案影响，以本机扩展实际界面为准。

## 4. Codex：收敛

- 将重复数值映射回 Token，合并语义相同的样式。
- 删除本次产生的失效 class，不机械清理历史业务 CSS。
- 检查桌面后必须检查移动端，并复核动态内容、空状态、加载和错误状态。
- 修复本次改动引入的问题；历史问题单独列出，不借机扩大重构。

## 响应式验收矩阵

| 宽度 | 重点 |
| --- | --- |
| 1440px | 页面层级、宽屏留白、主次图表比例 |
| 1280px | 标准桌面密度、筛选与操作区 |
| 1024px | 侧栏/内容边界、双列收敛 |
| 768px | 平板换行、图表高度、导航拥挤 |
| 390px | 主流移动端、按钮和筛选换行 |
| 375px | 最窄目标、文本截断和横向溢出 |

每个宽度检查：

- 页面根节点是否横向溢出。
- 表格是否在自身容器横向滚动。
- 卡片是否按信息优先级换行。
- 图表是否保持可读高度和完整图例。
- 顶部导航、筛选项和按钮是否拥挤或越界。
- 文本截断是否保留 title/完整查看方式。
- 固定高度是否裁切动态内容。
- 移动端是否优先保留结论、异常、核心 KPI 和主要动作。

