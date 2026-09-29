import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";

/**
 * Machine-wide mutex for the resources that cannot be duplicated: the physical
 * cursor (osmouse) and the single logged-in Figma session. Headless design-app
 * work never needs this.
 */
const STALE_MS = 10 * 60 * 1000;

function acquire(path) {
  try {
    const fd = openSync(path, "wx");
    writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
    closeSync(fd);
    return true;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    // A crashed holder must not wedge the machine forever.
    try {
      const held = JSON.parse(readFileSync(path, "utf8"));
      const dead = (() => {
        try { process.kill(held.pid, 0); return false; } catch { return true; }
      })();
      if (dead || Date.now() - held.at > STALE_MS) {
        rmSync(path, { force: true });
        return acquire(path);
      }
    } catch {
      rmSync(path, { force: true });
      return acquire(path);
    }
    return false;
  }
}

export async function withLock(name, fn, { timeoutMs = 15 * 60 * 1000 } = {}) {
  const path = `/tmp/an-harness-${name}.lock`;
  const started = Date.now();
  let waited = false;
  while (!acquire(path)) {
    if (Date.now() - started > timeoutMs) throw new Error(`lock timeout: ${name}`);
    if (!waited) { console.log(`[lock] waiting for ${name}…`); waited = true; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (waited) console.log(`[lock] acquired ${name}`);
  try {
    return await fn();
  } finally {
    rmSync(path, { force: true });
  }
}
