/**
 * 方案 B：数据密集专业型深色主题
 * Tailwind 配置扩展
 * 将下面的 theme.extend 合并到你的 tailwind.config.js
 *
 * 参考：Grafana + Linear + PostHog
 */

module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      // ─────────────────────────────────────────────
      // 1. 颜色系统（oklch）
      // ─────────────────────────────────────────────
      colors: {
        // 背景层级
        bg: {
          page: 'oklch(12% 0.005 260)',
          sidebar: 'oklch(15% 0.005 260)',
          card: 'oklch(18% 0.005 260)',
          hover: 'oklch(21% 0.005 260)',
          active: 'oklch(24% 0.005 260)',
        },
        // 边框层级
        border: {
          subtle: 'oklch(24% 0.005 260)',
          card: 'oklch(28% 0.005 260)',
          focus: 'oklch(65% 0.16 260)',
        },
        // 文字层级
        text: {
          primary: 'oklch(96% 0 0)',
          secondary: 'oklch(78% 0 0)',
          tertiary: 'oklch(60% 0 0)',
          disabled: 'oklch(45% 0 0)',
        },
        // 语义色（正常全灰阶，异常才用彩色）
        status: {
          success: 'oklch(72% 0.16 145)',
          warning: 'oklch(78% 0.16 75)',
          progress: 'oklch(68% 0.16 260)',
          error: 'oklch(68% 0.18 25)',
          info: 'oklch(65% 0.12 200)',
          // 语义色淡版（背景、进度条）
          'success-bg': 'oklch(28% 0.06 145)',
          'warning-bg': 'oklch(30% 0.06 75)',
          'progress-bg': 'oklch(26% 0.06 260)',
          'error-bg': 'oklch(26% 0.07 25)',
        },
      },

      // ─────────────────────────────────────────────
      // 2. 字号阶（信息密度型）
      // ─────────────────────────────────────────────
      fontSize: {
        aux: ['0.6875rem', { lineHeight: '1.5' }],    // 11px - 辅助文字
        body: ['0.8125rem', { lineHeight: '1.5' }],   // 13px - 正文
        section: ['0.875rem', { lineHeight: '1.5' }], // 14px - section 标题
        subtitle: ['1rem', { lineHeight: '1.4' }],    // 16px - 卡片大标题
        kpi: ['2rem', { lineHeight: '1.2' }],         // 32px - KPI 大数字
        'kpi-sm': ['1.5rem', { lineHeight: '1.2' }],  // 24px - 小 KPI
      },

      // ─────────────────────────────────────────────
      // 3. 间距阶（4px 基准）
      // ─────────────────────────────────────────────
      spacing: {
        1: '0.25rem',   // 4px
        2: '0.5rem',    // 8px
        3: '0.75rem',   // 12px
        4: '1rem',      // 16px
        5: '1.25rem',   // 20px
        6: '1.5rem',    // 24px
        8: '2rem',      // 32px
      },

      // ─────────────────────────────────────────────
      // 4. 圆角、阴影、边框
      // ─────────────────────────────────────────────
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '8px',
      },
      boxShadow: {
        subtle: '0 1px 2px oklch(0% 0 0 / 0.2)',
        card: '0 2px 8px oklch(0% 0 0 / 0.15)',
        float: '0 4px 16px oklch(0% 0 0 / 0.2)',
      },

      // ─────────────────────────────────────────────
      // 5. 数字等宽（扫视速度提升 30%）
      // ─────────────────────────────────────────────
      fontVariantNumeric: {
        'tabular-nums': 'tabular-nums',
      },

      // ─────────────────────────────────────────────
      // 6. 背景噪点纹理（降低视觉疲劳）
      // 使用：className="bg-noise"
      // ─────────────────────────────────────────────
      backgroundImage: {
        noise: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.02'/%3E%3C/svg%3E")`,
      },

      // ─────────────────────────────────────────────
      // 7. 动画（克制）
      // ─────────────────────────────────────────────
      transitionDuration: {
        fast: '100ms',
        normal: '150ms',
        slow: '250ms',
      },
    },
  },

  // ─────────────────────────────────────────────
  // 插件：表格行高工具类
  // ─────────────────────────────────────────────
  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        '.tabular-nums': {
          fontVariantNumeric: 'tabular-nums',
        },
        '.table-row-height': {
          minHeight: 'calc(0.8125rem * 1.5 + 0.75rem * 2)',
        },
        '.status-dot': {
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          display: 'inline-block',
          marginRight: '6px',
        },
      });
    },
  ],
};

/* ============================================================
   使用示例（直接写在 JSX 里）
   ============================================================

   // 页面背景
   <body className="bg-bg-page bg-noise text-text-secondary">

   // 一张卡片
   <div className="bg-bg-card rounded-md shadow-card p-4 transition-normal hover:bg-bg-hover">

   // KPI 数字
   <span className="text-kpi font-semibold tabular-nums text-text-primary">126</span>
   <p className="text-aux text-text-tertiary">含 18 条待质检</p>

   // 状态标签
   <span className="status-dot bg-status-success"></span>
   <span className="text-section font-medium text-status-success">运行正常</span>

   // 表格行
   <tr className="table-row-height border-b border-border-subtle
                   hover:bg-bg-hover transition-fast">

   // 按钮
   <button className="bg-status-progress text-white px-4 py-2 rounded-md
                       transition-normal hover:brightness-110">
     新建批次
   </button>

   ============================================================
   迁移顺序建议
   ============================================================

   第 1 步（10 分钟）：
     - body 加 bg-bg-page bg-noise
     - 所有卡片改 bg-bg-card rounded-md

   第 2 步（30 分钟）：
     - "今日运营概览" 4 个数字改 text-kpi tabular-nums
     - 说明文字改 text-aux text-text-tertiary

   第 3 步（1 小时）：
     - 所有状态颜色语义化（status-success/progress/warning/error）
     - 给每个状态前加 6px 的圆点

   第 4 步（2 小时）：
     - 表格重排（行高、分隔线、hover 态）

   第 5 步（可选）：
     - 加 sparkline（react-sparklines 库，每个 KPI 5 行代码）
 */
