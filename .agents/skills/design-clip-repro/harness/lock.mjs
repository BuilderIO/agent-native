import {
  linkSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

/**
 * Machine-wide mutex for the resources that cannot be duplicated: the physical
 * cursor (osmouse) and the single logged-in Figma session. Headless design-app
 * work never needs this.
 */
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}

function acquire(path) {
  // link() publishes the lock with its PID already written, so no reader ever sees it empty.
  const mine = `${path}.${process.pid}`;
  writeFileSync(mine, String(process.pid));
  try {
    linkSync(mine, path);
    return true;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  } finally {
    rmSync(mine, { force: true });
  }

  let held;
  try {
    held = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  if (isAlive(Number(held))) return false;

  // Two waiters can find the same dead holder. Move the file aside atomically,
  // and put it back if a new holder's lock was taken instead.
  const stale = `${path}.stale.${process.pid}`;
  try {
    renameSync(path, stale);
  } catch {
    return false;
  }
  const moved = readFileSync(stale, "utf8");
  if (moved !== held) {
    try {
      linkSync(stale, path);
    } catch {}
    rmSync(stale, { force: true });
    return false;
  }
  rmSync(stale, { force: true });
  return acquire(path);
}

export async function withLock(name, fn, { timeoutMs = 15 * 60 * 1000 } = {}) {
  const path = `/tmp/an-harness-${name}.lock`;
  const started = Date.now();
  let waited = false;
  while (!acquire(path)) {
    if (Date.now() - started > timeoutMs)
      throw new Error(`lock timeout: ${name}`);
    if (!waited) {
      console.log(`[lock] waiting for ${name}…`);
      waited = true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (waited) console.log(`[lock] acquired ${name}`);
  try {
    return await fn();
  } finally {
    rmSync(path, { force: true });
  }
}
