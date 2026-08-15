/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      screens: {
        xs: "390px",
        "3xl": "1600px",
      },
      colors: {
        canvas: "var(--color-bg-canvas)",
        surface: {
          DEFAULT: "var(--color-surface)",
          subtle: "var(--color-bg-subtle)",
          elevated: "var(--color-bg-elevated)",
          strong: "var(--color-surface-strong)",
          solid: "var(--color-surface-solid)",
        },
        border: {
          DEFAULT: "var(--color-border-default)",
          strong: "var(--color-border-strong)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          soft: "var(--color-accent-soft)",
        },
        status: {
          success: "var(--color-success)",
          info: "var(--color-info)",
          warning: "var(--color-warning)",
          danger: "var(--color-danger)",
        },
      },
      textColor: {
        primary: "var(--color-text-primary)",
        secondary: "var(--color-text-secondary)",
        muted: "var(--color-text-muted)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
      },
      fontSize: {
        caption: ["var(--font-size-caption)", { lineHeight: "var(--line-height-body)" }],
        body: ["var(--font-size-body)", { lineHeight: "var(--line-height-body)" }],
        section: ["var(--font-size-section)", { lineHeight: "var(--line-height-body)" }],
        "card-title": ["var(--font-size-card-title)", { lineHeight: "var(--line-height-tight)" }],
        "page-title": ["var(--font-size-title)", { lineHeight: "var(--line-height-tight)" }],
        kpi: ["var(--font-size-kpi)", { lineHeight: "var(--line-height-tight)" }],
      },
      spacing: {
        section: "var(--layout-section-gap)",
        card: "var(--layout-card-padding)",
        gutter: "var(--layout-page-gutter)",
      },
      borderRadius: {
        control: "var(--radius-control)",
        card: "var(--radius-card)",
        overlay: "var(--radius-overlay)",
      },
      boxShadow: {
        control: "var(--shadow-control)",
        card: "var(--shadow-card)",
        overlay: "var(--shadow-overlay)",
        accent: "var(--shadow-accent)",
      },
      maxWidth: {
        page: "var(--layout-page-max)",
      },
    },
  },
  plugins: [],
};
