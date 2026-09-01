// scripts/mutate-acl.mjs  -- 读 opencli 取回的 ACL 包络，合并 nodeAttrs/grants 后写纯 JSON 到 /tmp/acl-new.json
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const INPUT  = join(here, ".tmp", "acl-envelope.json");
const OUTPUT = join(here, ".tmp", "acl-new.json");

const env = JSON.parse(readFileSync(INPUT, "utf8"));
const src = env.value;

function strip(s) {
  let o = "", i = 0, inS = false, q = "";
  while (i < s.length) {
    const c = s[i];
    if (inS) {
      o += c;
      if (c === "\\") { o += s[++i] || ""; }
      else if (c === q) inS = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { inS = true; q = c; o += c; i++; continue; }
    if (c === "/" && s[i + 1] === "/") { while (i < s.length && s[i] !== "\n") i++; continue; }
    o += c;
    i++;
  }
  return o.replace(/,(\s*[}\]])/g, "$1");
}

const obj = JSON.parse(strip(src));

const MAGIC = "tailfc6ee5.ts.net";
const nodeDNS = (h) => `${h.toLowerCase()}.${MAGIC}`;

obj.nodeAttrs = obj.nodeAttrs || [];
const wantAttrs = [
  { target: ["autogroup:member"],    attr: ["drive:access"] },
  { target: ["a897003365@gmail.com"], attr: ["drive:share"] },
];
for (const w of wantAttrs) {
  const hit = obj.nodeAttrs.find((e) => JSON.stringify(e.target) === JSON.stringify(w.target));
  if (hit) { for (const a of w.attr) if (!hit.attr.includes(a)) hit.attr.push(a); }
  else obj.nodeAttrs.push(JSON.parse(JSON.stringify(w)));
}

obj.grants = obj.grants || [];
const wantGrants = [
  { src: ["autogroup:member"], dst: ["100.113.194.123"],
    app: { "tailscale.com/cap/drive": [{ shares: ["ecom_aistudio"], access: "ro" }] } },
  { src: ["a897003365@gmail.com"], dst: ["100.113.194.123"],
    app: { "tailscale.com/cap/drive": [{ shares: ["ecom_aistudio"], access: "rw" }] } },
];
for (const w of wantGrants) {
  const hit = obj.grants.find(
    (g) => JSON.stringify(g.src) === JSON.stringify(w.src) &&
           JSON.stringify(g.dst) === JSON.stringify(w.dst));
  if (!hit) obj.grants.push(JSON.parse(JSON.stringify(w)));
}

writeFileSync(OUTPUT, JSON.stringify(obj, null, 2));
console.log("OK, new ACL bytes:", JSON.stringify(obj).length);
console.log("Wrote:", OUTPUT);
