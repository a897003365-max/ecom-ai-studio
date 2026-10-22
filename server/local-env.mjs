import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Linux 部署适配：process.env 缺失时加载项目根 .env（不覆盖已有值，Windows 行为不变）
if (process.platform !== "win32") {
  try {
    const envFile = join(process.cwd(), ".env");
    if (existsSync(envFile)) {
      for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && !(m[1] in process.env)) {
          let v = m[2];
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
          process.env[m[1]] = v;
        }
      }
    }
  } catch {
    // .env 读取失败时忽略，走原有 fallback
  }
}

const cache = new Map();

export function readLocalEnv(name, fallback = "") {
  if (cache.has(name)) return cache.get(name);
  const direct = process.env[name];
  if (direct) {
    cache.set(name, direct);
    return direct;
  }

  if (process.platform === "win32") {
    try {
      const output = execFileSync("reg.exe", ["query", "HKCU\\Environment", "/v", name], {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const match = output.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)$`, "mi"));
      const value = match?.[1]?.trim();
      if (value) {
        cache.set(name, value);
        return value;
      }
    } catch {
      // Environment variables may not exist on a fresh installation.
    }
  }

  cache.set(name, fallback);
  return fallback;
}

export function hasLocalEnv(...names) {
  return names.every((name) => Boolean(readLocalEnv(name)));
}
