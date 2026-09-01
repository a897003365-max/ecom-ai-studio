// enable-src-share-admin.mjs
// 纯 CLI 启用 Taildrive 源码共享：
//   1) 用 Tailscale Admin API 给本机加 drive:share、给成员加 drive:access，
//      并且把 ecom_aistudio 共享的 grants（l-user-1 rw / 其余 ro）合并进现有 ACL。
//   2) 发布共享 tailscale drive share ecom_aistudio E:\ecom-ai-studio-share
//
// 用法（token 由你自己设进环境变量，不进屋对话；用完删）：
//   powershell:   $env:TS_ADMIN_TOKEN="tskey-..." ; node scripts\enable-src-share-admin.mjs
//   git-bash:     TS_ADMIN_TOKEN="tskey-..." node scripts/enable-src-share-admin.mjs
//
// token 需在 https://login.tailscale.com/admin/settings/keys 生成（Read/Write 权限）。

import { execSync } from "node:child_process";

const token = process.env.TS_ADMIN_TOKEN;
if (!token) {
  console.error("缺 TS_ADMIN_TOKEN。先用你的 Admin API token 设置该环境变量再跑。");
  process.exit(1);
}

// ---- tailnet 名：从 tailscaled 状态取；取不到用 TAILNET 兜底 ----
function getTailnet() {
  try {
    const j = JSON.parse(execSync("tailscale status --json", { encoding: "utf8" }));
    if (j?.CurrentTailnet?.Name) return j.CurrentTailnet.Name;
  } catch {}
  if (process.env.TAILNET) return process.env.TAILNET;
  throw new Error("无法确定 tailnet 名，请设 $env:TAILNET='<tailnet名>' 再跑。");
}
const tailnet = getTailnet();
const API = `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(tailnet)}`;
const auth = `Basic ${Buffer.from(`${token}:`).toString("base64")}`;

// ---- 取当前 ACL（严格 JSON）----
const resp = await fetch(`${API}/acl`, {
  headers: { Authorization: auth, Accept: "application/json" },
});
if (!resp.ok) throw new Error(`GET /acl 失败: ${resp.status} ${await resp.text()}`);
const policy = await resp.json();
console.log(`已读取当前策略 (${tailnet})`);

// ---- 合并 nodeAttrs ----
const NODE_ATTRS = [
  { target: ["autogroup:member"], attr: ["drive:access"] },
  { target: ["l-user"], attr: ["drive:share"] },
];
policy.nodeAttrs = policy.nodeAttrs || [];
for (const want of NODE_ATTRS) {
  const sameTarget = policy.nodeAttrs.find((e) =>
    JSON.stringify(e.target) === JSON.stringify(want.target));
  if (sameTarget) {
    for (const a of want.attr) if (!sameTarget.attr.includes(a)) sameTarget.attr.push(a);
  } else {
    policy.nodeAttrs.push(JSON.parse(JSON.stringify(want)));
  }
}

// ---- 合并 grants ----
const GRANTS = [
  { src: ["l-user-1"], dst: ["l-user"],
    app: { "tailscale.com/cap/drive": [{ shares: ["ecom_aistudio"], access: "rw" }] } },
  { src: ["l-user-2", "l-user-3", "chinami-v3tsh82"], dst: ["l-user"],
    app: { "tailscale.com/cap/drive": [{ shares: ["ecom_aistudio"], access: "ro" }] } },
];
policy.grants = policy.grants || [];
for (const want of GRANTS) {
  const hit = policy.grants.find((g) =>
    JSON.stringify(g.src) === JSON.stringify(want.src) &&
    JSON.stringify(g.dst) === JSON.stringify(want.dst));
  if (!hit) policy.grants.push(JSON.parse(JSON.stringify(want)));
}

// ---- 写回（PUT 整份策略，保留原有内容）----
const put = await fetch(`${API}/acl`, {
  method: "PUT",
  headers: { Authorization: auth, "Content-Type": "application/hujson" },
  body: JSON.stringify(policy),
});
if (!put.ok) throw new Error(`PUT /acl 失败: ${put.status} ${await put.text()}`);
console.log("ACL 已更新：drive:access(on members) / drive:share(on l-user) / grants 已合并。");

// ---- 发布共享 ----
execSync(`tailscale drive share ecom_aistudio "E:\\ecom-ai-studio-share"`, { stdio: "inherit" });
execSync("tailscale drive list", { stdio: "inherit" });
console.log("完成。现在可在 l-user-1 挂载 WebDAV 访问共享。");