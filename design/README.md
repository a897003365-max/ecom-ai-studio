# 设计交付目录

本目录连接 Open Design、Codex、DevTools / Piny 与现有工程。

## 目录约定

- [`../DESIGN.md`](../DESIGN.md)：当前原型相对根目录设计系统的页面级覆盖说明。
- `references/`：外部参考图、链接说明、品牌资料；不要放密钥或受限数据。
- `screenshots/`：验收截图和对比截图。
- `prototypes/`：Open Design 导出的 HTML、JSX、CSS 或原型说明。
- `notes/`：视觉决策、冲突处理和已确认微调数值。

空目录使用 `.gitkeep` 保留。已有历史原型仍保存在 `designs/`，不在本次准备中搬迁或删除。

当前经营工作台线稿入口为
`../designs/wireframes/workbench-home-layout-options.html`。其白底界面是评审用浅色模式，
深色界面是正式运营工作台视觉模式；左侧/顶部的“外观”按钮只切换原型主题并写入浏览器
`localStorage`。本轮案例研究和视觉取舍记录在
`notes/wireframe-benchmark-2026-07-27.md`。

## Open Design 交付方式

1. 先让 Open Design 读取根目录 [`../DESIGN.md`](../DESIGN.md)，生成页面结构、原型和页面级设计说明。
2. 将原型源码放入 `design/prototypes/<page-name>/`。
3. 将截图命名为 `<page-name>--<viewport>--<state>--YYYY-MM-DD.png`，例如 `analytics--1440x900--default--2026-07-27.png`。
4. 将原型特有差异写入 `design/DESIGN.md`，不要复制根规范全文。
5. 交给 Codex 时明确目标页面、参考原型目录、验收状态和允许修改的范围。

## 冲突优先级

安全与用户当前要求 > `AGENTS.md` 和业务数据口径 > 现有功能与接口契约 > 根目录 [`../DESIGN.md`](../DESIGN.md) > `design/DESIGN.md` 中的视觉差异 > 截图细节。

视觉冲突不应通过修改业务逻辑解决。无法兼容的差异记录到 `design/notes/<page-name>-decisions.md`。

## DevTools / Piny 数值回传

将已确认值记录为：

```md
## analytics / sales-chart

- 视口：1280x800
- 定位：data-ui="sales-chart"
- 属性：grid-template-columns
- 原值：1fr
- 确认值：minmax(0, 1.6fr) minmax(320px, 1fr)
- 适用范围：>= 1024px
- 原因：主趋势优先，右侧摘要仍可读
```

如果改动已由 Piny 写回源码，记录修改文件、选择器/组件、视口和确认原因；Codex 后续负责映射 Token、合并重复样式并验证所有目标宽度。
