import { mkdir, open, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const lockDir = join(process.cwd(), "local-data", "locks");
const lockPath = join(lockDir, "dingtalk-sync.lock");
const staleLockMs = 2 * 60 * 60 * 1000;

export async function acquireDingTalkLock(owner = "unknown") {
  await mkdir(lockDir, { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, owner, startedAt: new Date().toISOString() }), "utf8");
    let released = false;
    return {
      async release() {
        if (released) return;
        released = true;
        await handle.close();
        await rm(lockPath, { force: true });
      },
    };
  } catch (error) {
    await handle?.close();
    if (error?.code !== "EEXIST") throw error;
    let stale = false;
    try {
      stale = Date.now() - (await stat(lockPath)).mtimeMs > staleLockMs;
    } catch {
      // The competing process may have released the lock between the checks.
    }
    if (stale) {
      await rm(lockPath, { force: true });
      return acquireDingTalkLock(owner);
    }
    return null;
  }
}
