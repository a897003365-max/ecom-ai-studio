import { execFileSync } from "node:child_process";

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
