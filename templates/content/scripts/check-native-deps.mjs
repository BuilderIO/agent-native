#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REBUILD_LOCK = ".agent-native-better-sqlite3-rebuild.lock";
const LOCK_INITIALIZATION_TIMEOUT_MS = 5_000;
const REBUILD_WAIT_MS = 250;
const REBUILD_TIMEOUT_MS = 10 * 60 * 1000;

function resolveBetterSqlite3() {
  try {
    return require.resolve("better-sqlite3");
  } catch {
    const pnpmDir = join(__dirname, "..", "..", "..", "node_modules", ".pnpm");
    if (!existsSync(pnpmDir))
      throw new Error("better-sqlite3 is not installed");
    const packageDir = readdirSync(pnpmDir).find((entry) =>
      entry.startsWith("better-sqlite3@"),
    );
    if (!packageDir) throw new Error("better-sqlite3 is not installed");
    return join(
      pnpmDir,
      packageDir,
      "node_modules",
      "better-sqlite3",
      "lib",
      "index.js",
    );
  }
}

function npmExecutable() {
  const sibling = join(
    dirname(process.execPath),
    process.platform === "win32" ? "npm.cmd" : "npm",
  );
  return existsSync(sibling) ? sibling : "npm";
}

function sleepSync(milliseconds) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code !== "ESRCH";
  }
}

function acquireRebuildLock(packageDir) {
  const lockPath = join(packageDir, REBUILD_LOCK);
  const startedWaiting = Date.now();

  while (true) {
    try {
      const lockFd = openSync(lockPath, "wx");
      writeSync(
        lockFd,
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
        }),
      );
      return () => {
        try {
          closeSync(lockFd);
        } finally {
          try {
            unlinkSync(lockPath);
          } catch (error) {
            if (
              !(
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
              )
            ) {
              throw error;
            }
          }
        }
      };
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      ) {
        throw error;
      }

      let ownerPid = null;
      let lockAge = 0;
      try {
        const lock = JSON.parse(readFileSync(lockPath, "utf8"));
        ownerPid = typeof lock.pid === "number" ? lock.pid : null;
      } catch {
        // The owner may be between creating and writing the lock metadata.
      }
      try {
        lockAge = Date.now() - statSync(lockPath).mtimeMs;
      } catch {
        continue;
      }

      if (
        (ownerPid !== null && !processIsRunning(ownerPid)) ||
        (ownerPid === null && lockAge > LOCK_INITIALIZATION_TIMEOUT_MS)
      ) {
        try {
          unlinkSync(lockPath);
          continue;
        } catch (unlinkError) {
          if (
            !(
              unlinkError instanceof Error &&
              "code" in unlinkError &&
              unlinkError.code === "ENOENT"
            )
          ) {
            throw unlinkError;
          }
          continue;
        }
      }

      if (Date.now() - startedWaiting > REBUILD_TIMEOUT_MS) {
        throw new Error(
          "Timed out waiting for another process to rebuild better-sqlite3",
        );
      }
      sleepSync(REBUILD_WAIT_MS);
    }
  }
}

function verifyBetterSqlite3(entry) {
  const requireFromPackage = createRequire(entry);
  const Database = requireFromPackage(entry);
  const db = new Database(":memory:");
  db.close();
}

let packageEntry;
try {
  packageEntry = resolveBetterSqlite3();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`
[content dev preflight] better-sqlite3 could not load its native binding.

Original error:
${message}
`);
  process.exit(1);
}

try {
  verifyBetterSqlite3(packageEntry);
} catch (firstError) {
  const packageDir = dirname(dirname(packageEntry));
  const releaseLock = acquireRebuildLock(packageDir);
  let repairError;
  try {
    let alreadyRepaired = false;
    try {
      verifyBetterSqlite3(packageEntry);
      alreadyRepaired = true;
    } catch {
      // Another preflight may have repaired the package while we waited.
    }
    if (!alreadyRepaired) {
      console.warn(
        `[content dev preflight] Rebuilding ${packageDir} with Node ${process.version} (ABI ${process.versions.modules})...`,
      );
      execFileSync(
        npmExecutable(),
        ["run", "build-release", "--prefix", packageDir],
        {
          cwd: packageDir,
          stdio: "inherit",
        },
      );
      verifyBetterSqlite3(packageEntry);
    }
  } catch (error) {
    repairError = error;
  } finally {
    releaseLock();
  }

  if (repairError) {
    const original =
      firstError instanceof Error ? firstError.message : String(firstError);
    const repaired =
      repairError instanceof Error ? repairError.message : String(repairError);
    console.error(`
[content dev preflight] better-sqlite3 is still unusable after a direct rebuild.

Package: ${packageDir}
Node: ${process.version} (ABI ${process.versions.modules})
Original error: ${original}
Rebuild error: ${repaired}
`);
    process.exit(1);
  }
}
