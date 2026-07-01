import "./styles.css";
import concept01 from "../designs/concepts/01-product-import-cockpit.png";
import concept02 from "../designs/concepts/02-competitor-intelligence.png";
import concept03 from "../designs/concepts/03-ai-product-profile.png";
import concept04 from "../designs/concepts/04-main-image-generator.png";
import concept05 from "../designs/concepts/05-bedroom-scene-generator.png";
import concept06 from "../designs/concepts/06-detail-page-planner.png";
import concept07 from "../designs/concepts/07-ugc-rednote-studio.png";
import concept08 from "../designs/concepts/08-video-storyboard.png";
import concept09 from "../designs/concepts/09-task-quality-center.png";
import concept10 from "../designs/concepts/10-performance-regeneration.png";

type Concept = {
  id: string;
  title: string;
  description: string;
  status: "Generated" | "Pending";
  path: string;
  metrics: string[];
};

const concepts: Concept[] = [
  {
    id: "01",
    title: "商品导入驾驶舱",
    description: "床垫 SKU 批量导入、原始图片、规格、价格带、渠道标签。",
    status: "Generated",
    path: concept01,
    metrics: ["128 SKU", "6 渠道", "92% 完整度"],
  },
  {
    id: "02",
    title: "爆款/竞品拆解台",
    description: "竞品图墙、卖点聚类、视觉风格分析、机会点。",
    status: "Generated",
    path: concept02,
    metrics: ["48 竞品", "12 卖点", "7 机会点"],
  },
  {
    id: "03",
    title: "AI 商品档案页",
    description: "材质、支撑层、适用人群、核心卖点、合规禁词检查。",
    status: "Generated",
    path: concept03,
    metrics: ["8 卖点", "0 禁词", "A- 档案"],
  },
  {
    id: "04",
    title: "主图生成工作台",
    description: "白底主图、场景主图、促销主图，多方案并排和尺寸预览。",
    status: "Generated",
    path: concept04,
    metrics: ["12 方案", "4 尺寸", "86% 一致性"],
  },
  {
    id: "05",
    title: "卧室场景图生成器",
    description: "北欧、奶油风、酒店风卧室场景，床垫替换和光影控制。",
    status: "Generated",
    path: concept05,
    metrics: ["9 场景", "3 风格", "91% 真实感"],
  },
  {
    id: "06",
    title: "详情页长图规划器",
    description: "首屏、卖点、材质拆解、尺寸、服务承诺的分屏脚本和预览。",
    status: "Generated",
    path: concept06,
    metrics: ["11 分屏", "5 模块", "2 语言"],
  },
  {
    id: "07",
    title: "买家秀/小红书素材台",
    description: "真实家居口吻、UGC 照片、种草标题、封面图批量生成。",
    status: "Generated",
    path: concept07,
    metrics: ["24 素材", "6 口吻", "18 标题"],
  },
  {
    id: "08",
    title: "短视频分镜生成台",
    description: "床垫卖点视频脚本、镜头列表、素材队列、生成进度。",
    status: "Generated",
    path: concept08,
    metrics: ["8 镜头", "35 秒", "64% 生成"],
  },
  {
    id: "09",
    title: "任务队列与质检中心",
    description: "批量任务、失败重试、相似度、清晰度、违规词、品牌一致性评分。",
    status: "Generated",
    path: concept09,
    metrics: ["36 任务", "92% 通过", "4 重试"],
  },
  {
    id: "10",
    title: "投放复盘与再生成",
    description: "平台发布状态、点击率、转化率、素材胜率、基于数据一键再生成。",
    status: "Generated",
    path: concept10,
    metrics: ["3 平台", "2.8% CTR", "14 胜出"],
  },
];

const navigationItems = [
  "工作台首页",
  "商品资产",
  "竞品拆解",
  "主图生成",
  "详情页生成",
  "短视频",
  "任务质检",
  "投放复盘",
  "系统设置",
];

function conceptCard(concept: Concept): string {
  const metricHtml = concept.metrics.map((metric) => `<span>${metric}</span>`).join("");

  return `
    <article class="concept-card">
      <div class="concept-preview">
        <img src="${concept.path}" alt="${concept.title}" />
        <div class="concept-fallback">
          <strong>${concept.id}</strong>
          <span>Concept image slot</span>
        </div>
      </div>
      <div class="concept-copy">
        <div class="concept-title-row">
          <span class="concept-id">${concept.id}</span>
          <h3>${concept.title}</h3>
          <span class="status-pill ${concept.status.toLowerCase()}">${concept.status}</span>
        </div>
        <p>${concept.description}</p>
        <div class="metric-row">${metricHtml}</div>
      </div>
    </article>
  `;
}

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="studio-shell">
    <aside class="side-nav">
      <div class="brand">
        <div class="brand-mark">e</div>
        <div>
          <strong>ecom AI Studio</strong>
          <span>AI 电商影像生产工作台</span>
        </div>
      </div>
      <nav>
        ${navigationItems
          .map((item, index) => `<button class="${index === 0 ? "active" : ""}">${item}</button>`)
          .join("")}
      </nav>
      <div class="nav-note">
        <span>Design base</span>
        <strong>10 concept states</strong>
      </div>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <div>
          <p>Mattress Commerce Loop</p>
          <h1>床垫/家居电商 AI 生产闭环</h1>
        </div>
        <div class="topbar-actions">
          <button>查看 Brief</button>
          <button class="primary">进入样图集</button>
        </div>
      </header>

      <section class="overview-grid">
        <div class="hero-panel">
          <p class="eyebrow">Design objective</p>
          <h2>像真实后台截图一样定义产品，而不是做一组海报。</h2>
          <p>
            这套底座把视频里的工作台结构转成床垫家居业务闭环：商品导入、竞品拆解、
            素材生成、任务质检、投放复盘和再生成。
          </p>
          <div class="stage-line">
            <span>导入</span>
            <span>分析</span>
            <span>生成</span>
            <span>质检</span>
            <span>复盘</span>
          </div>
        </div>
        <div class="queue-panel">
          <p class="eyebrow">Task queue</p>
          <div class="queue-item running">
            <strong>主图方案生成</strong>
            <span>6/12 running</span>
          </div>
          <div class="queue-item">
            <strong>竞品卖点聚类</strong>
            <span>complete</span>
          </div>
          <div class="queue-item">
            <strong>短视频分镜</strong>
            <span>waiting</span>
          </div>
          <div class="score-grid">
            <span><strong>86</strong> 图片</span>
            <span><strong>14</strong> 任务</span>
            <span><strong>92%</strong> 通过率</span>
            <span><strong>10</strong> 样图</span>
          </div>
        </div>
      </section>

      <section class="concept-section">
        <div class="section-heading">
          <p class="eyebrow">Concept set</p>
          <h2>10 张样图</h2>
        </div>
        <div class="concept-grid">
          ${concepts.map(conceptCard).join("")}
        </div>
      </section>
    </section>
  </main>
`;
