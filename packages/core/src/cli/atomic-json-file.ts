import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const LOCK_WAIT_MS = 10_000;
const STALE_LOCK_MS = 30_000;
const lockWaiter = new Int32Array(new SharedArrayBuffer(4));

export interface FileLockOptions {
  lockWaitMs?: number;
  staleLockMs?: number;
  /**
   * Durable writers wait long enough to reclaim a fresh dead owner. Hot paths
   * may opt out and handle a short best-effort timeout themselves.
   */
  reclaimFreshDeadOwner?: boolean;
}

export interface AtomicJsonLineOptions {
  mode?: number;
  lock?: FileLockOptions;
}

interface FileLockMetadata {
  pid: number;
  createdAt: number;
  token: string;
}

export function withFileLockSync<T>(
  filePath: string,
  action: () => T,
  options: FileLockOptions = {},
): T {
  const lockPath = `${filePath}.lock`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const owner = acquireFileLockSync(lockPath, options);
  try {
    return action();
  } finally {
    releaseFileLockSync(lockPath, owner);
  }
}

export function writeJsonFileAtomically(
  filePath: string,
  value: unknown,
  options?: { mode?: number },
): void {
  writeTextFileAtomically(
    filePath,
    `${JSON.stringify(value, null, 2)}\n`,
    options,
  );
}

export function writeTextFileAtomically(
  filePath: string,
  content: string,
  options?: { mode?: number },
): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomUUID()}`,
  );
  let mode = options?.mode;
  if (mode === undefined) {
    try {
      mode = fs.statSync(filePath).mode & 0o777;
    } catch {
      // New files use the process umask.
    }
  }

  try {
    fs.writeFileSync(temporaryPath, content, {
      encoding: "utf-8",
      flag: "wx",
      ...(mode === undefined ? {} : { mode }),
    });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function updateJsonFileAtomically<T>(
  filePath: string,
  parse: (value: unknown) => T | null,
  update: (current: T | null) => T | null,
  options?: { lock?: FileLockOptions },
): T | null {
  return withFileLockSync(
    filePath,
    () => {
      const current = readJsonFile(filePath, parse);
      const next = update(current);
      if (next !== null) writeJsonFileAtomically(filePath, next);
      return next;
    },
    options?.lock,
  );
}

export function appendUniqueJsonLineAtomically<T extends { id: string }>(
  filePath: string,
  value: T,
  parse: (value: unknown) => T | null,
  options?: AtomicJsonLineOptions,
): { value: T; appended: boolean } {
  return withFileLockSync(
    filePath,
    () => {
      if (fs.existsSync(filePath)) {
        for (const line of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
          if (!line) continue;
          try {
            const existing = parse(JSON.parse(line) as unknown);
            if (existing?.id === value.id) {
              return { value: existing, appended: false };
            }
          } catch {
            // Ignore malformed legacy lines; valid events remain append-only.
          }
        }
      }
      fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, {
        encoding: "utf-8",
        ...(options?.mode === undefined ? {} : { mode: options.mode }),
      });
      return { value, appended: true };
    },
    options?.lock,
  );
}

function readJsonFile<T>(
  filePath: string,
  parse: (value: unknown) => T | null,
): T | null {
  try {
    return parse(JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown);
  } catch {
    return null;
  }
}

function acquireFileLockSync(
  lockPath: string,
  options: FileLockOptions,
): FileLockMetadata {
  const startedAt = Date.now();
  while (true) {
    if (hasActiveReaper(lockPath, options)) {
      waitForFileLock(lockPath, startedAt, options);
      continue;
    }
    const metadata: FileLockMetadata = {
      pid: process.pid,
      createdAt: Date.now(),
      token: crypto.randomUUID(),
    };
    let fd: number | undefined;
    try {
      fd = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(fd, JSON.stringify(metadata), "utf-8");
      return metadata;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      recoverStaleFileLock(lockPath, options);
      if (!fs.existsSync(lockPath)) continue;
      waitForFileLock(lockPath, startedAt, options);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
}

function recoverStaleFileLock(
  lockPath: string,
  options: FileLockOptions,
): void {
  const reaperPath = `${lockPath}.reaper`;
  const reaper = tryAcquireFileLock(reaperPath);
  if (!reaper) return;
  try {
    const stale = readFileLockMetadata(lockPath);
    if (!isStaleDeadOwner(stale, options)) return;
    const confirmed = readFileLockMetadata(lockPath);
    if (!sameFileLock(stale, confirmed)) return;
    releaseFileLockSync(lockPath, stale);
  } finally {
    releaseFileLockSync(reaperPath, reaper);
  }
}

function hasActiveReaper(lockPath: string, options: FileLockOptions): boolean {
  const reaperPath = `${lockPath}.reaper`;
  const reaper = readFileLockMetadata(reaperPath);
  if (!reaper) return false;
  if (!isStaleDeadOwner(reaper, options)) return true;
  releaseFileLockSync(reaperPath, reaper);
  return false;
}

function tryAcquireFileLock(lockPath: string): FileLockMetadata | null {
  const metadata: FileLockMetadata = {
    pid: process.pid,
    createdAt: Date.now(),
    token: crypto.randomUUID(),
  };
  let fd: number | undefined;
  try {
    fd = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(metadata), "utf-8");
    return metadata;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function releaseFileLockSync(lockPath: string, owner: FileLockMetadata): void {
  if (!sameFileLock(owner, readFileLockMetadata(lockPath))) return;
  try {
    fs.rmSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function readFileLockMetadata(lockPath: string): FileLockMetadata | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf-8")) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as FileLockMetadata).pid === "number" &&
      typeof (parsed as FileLockMetadata).createdAt === "number" &&
      typeof (parsed as FileLockMetadata).token === "string"
    ) {
      return parsed as FileLockMetadata;
    }
  } catch {
    return null;
  }
  return null;
}

function sameFileLock(
  left: FileLockMetadata | null,
  right: FileLockMetadata | null,
): boolean {
  return Boolean(
    left &&
    right &&
    left.pid === right.pid &&
    left.createdAt === right.createdAt &&
    left.token === right.token,
  );
}

function isStaleDeadOwner(
  metadata: FileLockMetadata | null,
  options: FileLockOptions,
): metadata is FileLockMetadata {
  return (
    metadata !== null &&
    Date.now() - metadata.createdAt >= staleLockMs(options) &&
    !isProcessAlive(metadata.pid)
  );
}

function waitForFileLock(
  lockPath: string,
  startedAt: number,
  options: FileLockOptions,
): void {
  if (
    Date.now() - startedAt >=
    lockWaitBudgetMs(lockPath, startedAt, options)
  ) {
    throw new Error(`Timed out waiting for local store lock: ${lockPath}`);
  }
  Atomics.wait(lockWaiter, 0, 0, 8 + Math.floor(Math.random() * 8));
}

function lockWaitBudgetMs(
  lockPath: string,
  startedAt: number,
  options: FileLockOptions,
): number {
  const configured = options.lockWaitMs ?? LOCK_WAIT_MS;
  if (options.reclaimFreshDeadOwner === false) return configured;
  const owner = readFileLockMetadata(lockPath);
  if (!owner || isProcessAlive(owner.pid)) return configured;
  const remainingUntilStale = Math.max(
    0,
    staleLockMs(options) - (Date.now() - owner.createdAt),
  );
  return Math.max(
    configured,
    Date.now() - startedAt + remainingUntilStale + 32,
  );
}

function staleLockMs(options: FileLockOptions): number {
  return options.staleLockMs ?? STALE_LOCK_MS;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
