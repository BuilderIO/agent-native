import { readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA_DIR_PREFIX = "agent-native-core-vitest-";

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    throw error;
  }
}

// Test files run in parallel worker processes. A file that opens the database
// without DATABASE_URL gets the ./data/pglite default, and that directory's
// process lock admits one process at a time, so parallel files collide on it.
if (!process.env.DATABASE_URL) {
  // Vitest kills its workers rather than letting them exit, so each process
  // removes the directories dead ones left behind instead of its own. That
  // includes one under this process's PID, which the OS may have reused.
  for (const name of readdirSync(os.tmpdir())) {
    const pid = Number(name.slice(DATA_DIR_PREFIX.length).split(".")[0]);
    if (
      !name.startsWith(DATA_DIR_PREFIX) ||
      !(Number.isInteger(pid) && pid > 0)
    ) {
      continue;
    }
    if (pid !== process.pid && isProcessAlive(pid)) continue;
    rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
  }
  const dataDir = path.join(os.tmpdir(), `${DATA_DIR_PREFIX}${process.pid}`);
  process.env.DATABASE_URL = `pglite:${dataDir}`; // guard:allow-env-mutation — Vitest setup runs once per test process, before any test code
}
