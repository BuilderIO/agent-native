import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getAppConfig } from "../app-config/index.js";

const MEMORY_PREFIX = "memory/";
const SAFE_MEMORY_FILE_PATTERN = /^[a-zA-Z0-9._-]+\.md$/;

/**
 * Optional directory shared across local app processes in the desktop app
 * so personal `memory/*` resources written by one app agent load in every
 * other app agent's new chats.
 */
export function getSharedMemoryDir(): string | null {
  const dir = getAppConfig().agent.sharedMemoryDir;
  return dir ? path.resolve(dir) : null;
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export function isPersonalMemoryResourcePath(
  owner: string,
  resourcePath: string,
): boolean {
  if (!owner || owner === "__shared__" || owner.startsWith("__")) {
    return false;
  }
  if (!resourcePath.startsWith(MEMORY_PREFIX)) return false;
  const fileName = resourcePath.slice(MEMORY_PREFIX.length);
  if (!fileName || fileName.includes("..")) return false;
  return SAFE_MEMORY_FILE_PATTERN.test(fileName);
}

function resolveSharedMemoryOwnerDir(
  rootDir: string,
  owner: string,
): string | null {
  const safeOwner = encodeURIComponent(owner);
  if (!safeOwner || safeOwner === "." || safeOwner === "..") return null;
  const resolvedRoot = path.resolve(rootDir);
  const ownerDir = path.resolve(resolvedRoot, safeOwner);
  if (!ownerDir.startsWith(resolvedRoot + path.sep)) return null;
  return ownerDir;
}

export function resolveSharedMemoryFilePath(
  rootDir: string,
  owner: string,
  resourcePath: string,
): string | null {
  if (!isPersonalMemoryResourcePath(owner, resourcePath)) return null;
  const ownerDir = resolveSharedMemoryOwnerDir(rootDir, owner);
  if (!ownerDir) return null;
  const fileName = resourcePath.slice(MEMORY_PREFIX.length);
  const resolved = path.resolve(ownerDir, fileName);
  if (!resolved.startsWith(ownerDir + path.sep)) return null;
  return resolved;
}

/** The tombstone could not be published, so the delete did not start. */
export class MemoryTombstoneError extends Error {}

/**
 * The tombstone was published but the SQL delete failed. The row is still
 * stored; the shared copy was restored from it when that repair succeeded.
 */
export class MemoryDeleteFailedError extends Error {}

/**
 * A delete failed and the tombstone could not be repaired or removed, so
 * whether the memory is hidden or visible is unknown.
 */
export class MemoryDeleteStateUnknownError extends MemoryDeleteFailedError {}

export class MemoryWriteConflictError extends Error {
  adopted: { content: string; updatedAt: number } | null;

  constructor(
    message: string,
    adopted: { content: string; updatedAt: number } | null,
  ) {
    super(message);
    this.adopted = adopted;
  }
}

export class MemoryMirrorStaleError extends Error {
  committed: { path: string; content: string; updatedAt: number };

  constructor(
    message: string,
    committed: { path: string; content: string; updatedAt: number },
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.committed = committed;
  }
}

export class MemoryMirrorRepairError extends Error {}

/** Another process held a memory file's lock for the whole retry window. */
export class MemoryLockTimeoutError extends Error {}

/**
 * Lets a caller keep doing follow-up work after a write whose SQL row
 * committed but whose mirror is stale, then report the staleness at the end.
 */
export function staleMirrorCollector(): {
  absorb: (error: unknown) => void;
  finish: () => void;
} {
  let first: MemoryMirrorStaleError | undefined;
  return {
    absorb(error) {
      if (!(error instanceof MemoryMirrorStaleError)) throw error;
      first ??= error;
    },
    finish() {
      if (first) throw first;
    },
  };
}

export type MirroredMemory =
  | { state: "absent" }
  | { state: "deleted"; deletedAt: number }
  | { state: "present"; content: string; mtimeMs: number; size: number };

function resolveTombstonePath(
  rootDir: string,
  owner: string,
  resourcePath: string,
): string | null {
  const filePath = resolveSharedMemoryFilePath(rootDir, owner, resourcePath);
  return filePath ? `${filePath}.deleted` : null;
}

const LOCK_TIMEOUT_MS = 2_000;
const LOCK_STALE_MS = 10_000;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

type LockSnapshot = { ino: number; mtimeMs: number; text: string };

async function readLock(lockPath: string): Promise<LockSnapshot | null> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(lockPath, "r");
    const { ino, mtimeMs } = await handle.stat();
    return { ino, mtimeMs, text: await handle.readFile("utf8") };
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

function isStaleLock(lock: LockSnapshot): boolean {
  const pid = Number.parseInt(lock.text, 10);
  const dead = !Number.isInteger(pid) || !isProcessAlive(pid);
  return dead && Date.now() - lock.mtimeMs > LOCK_STALE_MS;
}

async function clearStaleReclaimMarker(reclaimPath: string): Promise<void> {
  const judged = await readLock(reclaimPath);
  if (!judged || !isStaleLock(judged)) return;
  const aside = `${reclaimPath}.${process.pid}.${randomUUID()}`;
  try {
    await fs.promises.rename(reclaimPath, aside);
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
  const taken = await readLock(aside);
  const same =
    taken &&
    taken.ino === judged.ino &&
    taken.mtimeMs === judged.mtimeMs &&
    taken.text === judged.text;
  if (!same) {
    await fs.promises.link(aside, reclaimPath).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
  }
  await fs.promises.unlink(aside);
}

async function breakStaleLock(lockPath: string): Promise<void> {
  const judged = await readLock(lockPath);
  if (!judged || !isStaleLock(judged)) return;
  const reclaimPath = `${lockPath}.reclaim`;
  try {
    const marker = await fs.promises.open(reclaimPath, "wx");
    try {
      await marker.writeFile(`${process.pid} ${Date.now()}`);
    } finally {
      await marker.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await clearStaleReclaimMarker(reclaimPath);
    return;
  }
  try {
    const current = await readLock(lockPath);
    if (
      current &&
      current.ino === judged.ino &&
      current.mtimeMs === judged.mtimeMs &&
      current.text === judged.text &&
      isStaleLock(current)
    ) {
      await fs.promises.unlink(lockPath);
    }
  } finally {
    await fs.promises.unlink(reclaimPath).catch((error) => {
      if (!isMissingPathError(error)) throw error;
    });
  }
}

const heldFileLocks = new AsyncLocalStorage<ReadonlySet<string>>();

async function lockFile<T>(
  filePath: string,
  work: () => Promise<T>,
): Promise<T> {
  const held = heldFileLocks.getStore();
  if (held?.has(filePath)) return work();
  const lockPath = `${filePath}.lock`;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (let delay = 5; ; delay = Math.min(delay * 2, 80)) {
    try {
      const handle = await fs.promises.open(lockPath, "wx");
      try {
        await handle.writeFile(`${process.pid} ${Date.now()}`);
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await breakStaleLock(lockPath);
    if (Date.now() >= deadline) {
      throw new MemoryLockTimeoutError(
        `${path.basename(filePath)} is locked by another process`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  try {
    return await heldFileLocks.run(new Set(held).add(filePath), work);
  } finally {
    await fs.promises.unlink(lockPath).catch((error) => {
      if (!isMissingPathError(error)) throw error;
    });
  }
}

/**
 * Runs `work` while holding the cross-process lock for one memory path, so a
 * check and the write that depends on it cannot interleave with another
 * process. Without a shared directory there is nothing to lock.
 */
export function withSharedMemoryLock<T>(
  owner: string,
  resourcePath: string,
  work: () => Promise<T>,
): Promise<T> {
  const rootDir = getSharedMemoryDir();
  const filePath =
    rootDir && resolveSharedMemoryFilePath(rootDir, owner, resourcePath);
  return filePath ? lockFile(filePath, work) : work();
}

async function writeAtomic(
  filePath: string,
  content: string,
  stamp?: number,
): Promise<void> {
  const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.promises.writeFile(temp, content, "utf8");
  if (stamp !== undefined) {
    await fs.promises.utimes(temp, new Date(stamp), new Date(stamp));
  }
  await fs.promises.rename(temp, filePath);
}

type Tombstone = { deletedAt: number; pendingPid: number | null };

function parseTombstone(text: string, tombstonePath: string): Tombstone {
  const invalid = () =>
    new MemoryTombstoneError(`Invalid memory tombstone: ${tombstonePath}`);
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) {
    const deletedAt = Number(trimmed);
    if (!Number.isSafeInteger(deletedAt)) throw invalid();
    return { deletedAt, pendingPid: null };
  }
  let parsed: { deletedAt?: unknown; state?: unknown; pid?: unknown };
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw invalid();
  }
  if (!Number.isSafeInteger(parsed.deletedAt)) throw invalid();
  const deletedAt = parsed.deletedAt as number;
  if (parsed.state === "committed") return { deletedAt, pendingPid: null };
  if (parsed.state !== "pending" || !Number.isSafeInteger(parsed.pid)) {
    throw invalid();
  }
  return { deletedAt, pendingPid: parsed.pid as number };
}

async function readTombstoneRecord(
  tombstonePath: string,
): Promise<Tombstone | null> {
  try {
    return parseTombstone(
      await fs.promises.readFile(tombstonePath, "utf8"),
      tombstonePath,
    );
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

async function readTombstone(tombstonePath: string): Promise<number | null> {
  const record = await readTombstoneRecord(tombstonePath);
  return record ? record.deletedAt : null;
}

/**
 * The one reader of mirrored memory. A tombstone at least as new as the file
 * means the memory was deleted, whether or not the file is still there.
 */
export async function readMirroredMemory(
  owner: string,
  resourcePath: string,
  rootDir: string | null = getSharedMemoryDir(),
): Promise<MirroredMemory> {
  if (!rootDir) return { state: "absent" };
  const filePath = resolveSharedMemoryFilePath(rootDir, owner, resourcePath);
  const tombstonePath = resolveTombstonePath(rootDir, owner, resourcePath);
  if (!filePath || !tombstonePath) return { state: "absent" };
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(filePath, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) return { state: "absent" };
    const content = await handle.readFile("utf8");
    const deletedAt = await readTombstone(tombstonePath);
    if (deletedAt !== null && stat.mtimeMs <= deletedAt) {
      return { state: "deleted", deletedAt };
    }
    return {
      state: "present",
      content,
      mtimeMs: stat.mtimeMs,
      size: Buffer.byteLength(content, "utf8"),
    };
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
    const deletedAt = await readTombstone(tombstonePath);
    return deletedAt === null
      ? { state: "absent" }
      : { state: "deleted", deletedAt };
  } finally {
    await handle?.close();
  }
}

export async function writeSharedPersonalMemory(
  owner: string,
  resourcePath: string,
  content: string,
  revision: number,
): Promise<void> {
  const rootDir = getSharedMemoryDir();
  if (!rootDir) return;
  const filePath = resolveSharedMemoryFilePath(rootDir, owner, resourcePath);
  const tombstonePath = resolveTombstonePath(rootDir, owner, resourcePath);
  if (!filePath || !tombstonePath) return;
  await lockFile(filePath, async () => {
    const deletedAt = await readTombstone(tombstonePath);
    if (deletedAt !== null && deletedAt >= revision) {
      throw new MemoryTombstoneError(
        `${resourcePath} was deleted after this revision; its shared copy was left deleted`,
      );
    }
    await writeAtomic(filePath, content, revision);
    if (deletedAt !== null) await fs.promises.unlink(tombstonePath);
  });
}

export async function deleteSharedPersonalMemory(
  owner: string,
  resourcePath: string,
  revisionFloor = 0,
  state: "pending" | "committed" = "committed",
): Promise<number> {
  const rootDir = getSharedMemoryDir();
  if (!rootDir) return 0;
  const filePath = resolveSharedMemoryFilePath(rootDir, owner, resourcePath);
  if (!filePath) return 0;
  return lockFile(filePath, async () => {
    const fileStat = await fs.promises.stat(filePath).catch((error) => {
      if (!isMissingPathError(error)) throw error;
      return null;
    });
    const existing = await readTombstone(`${filePath}.deleted`);
    const deletedAt = Math.max(
      Date.now(),
      existing ?? 0,
      revisionFloor,
      fileStat ? Math.floor(fileStat.mtimeMs) + 1 : 0,
    );
    await writeAtomic(
      `${filePath}.deleted`,
      state === "pending"
        ? JSON.stringify({ deletedAt, state, pid: process.pid })
        : String(deletedAt),
    );
    await removeSharedFile(filePath, resourcePath, deletedAt);
    return deletedAt;
  });
}

async function removeSharedFile(
  filePath: string,
  resourcePath: string,
  deletedAt: number,
): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (!isMissingPathError(error)) {
      await quarantineSharedFile(filePath).catch((quarantineError) => {
        throw new MemoryMirrorStaleError(
          `${resourcePath} was deleted but its shared file could not be removed; the leftover file stays readable outside the app`,
          { path: resourcePath, content: "", updatedAt: deletedAt },
          { cause: new AggregateError([error, quarantineError]) },
        );
      });
    }
  }
}

/**
 * Retry removing a shared file that a delete tombstoned but could not remove.
 * Returns true when a tombstoned leftover was removed; a file written after
 * the tombstone is live and is left alone.
 */
export async function removeTombstonedSharedFile(
  owner: string,
  resourcePath: string,
): Promise<boolean> {
  const rootDir = getSharedMemoryDir();
  if (!rootDir) return false;
  const filePath = resolveSharedMemoryFilePath(rootDir, owner, resourcePath);
  if (!filePath) return false;
  return lockFile(filePath, async () => {
    const fileStat = await fs.promises.stat(filePath).catch((error) => {
      if (!isMissingPathError(error)) throw error;
      return null;
    });
    if (!fileStat?.isFile()) return false;
    const deletedAt = await readTombstone(`${filePath}.deleted`);
    if (deletedAt === null || fileStat.mtimeMs > deletedAt) return false;
    await removeSharedFile(filePath, resourcePath, deletedAt);
    return true;
  });
}

async function quarantineSharedFile(filePath: string): Promise<void> {
  const quarantine = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.removed`,
  );
  await fs.promises.rename(filePath, quarantine);
  await fs.promises.unlink(quarantine);
}

/**
 * The revision a tombstone covers, read without the file's contents. A file
 * written after the tombstone voids it, as in readMirroredMemory.
 */
export async function readMemoryTombstoneFloor(
  owner: string,
  resourcePath: string,
): Promise<number | null> {
  const rootDir = getSharedMemoryDir();
  if (!rootDir) return null;
  const filePath = resolveSharedMemoryFilePath(rootDir, owner, resourcePath);
  const tombstonePath = resolveTombstonePath(rootDir, owner, resourcePath);
  if (!filePath || !tombstonePath) return null;
  const deletedAt = await readTombstone(tombstonePath);
  if (deletedAt === null) return null;
  const stat = await fs.promises.stat(filePath).catch((error) => {
    if (!isMissingPathError(error)) throw error;
    return null;
  });
  return stat?.isFile() && stat.mtimeMs > deletedAt ? null : deletedAt;
}

/**
 * The revision of a pending tombstone whose delete can no longer finish
 * because its process is gone. Age never counts, and a committed tombstone is
 * never abandoned.
 */
export async function readAbandonedMemoryDelete(
  owner: string,
  resourcePath: string,
): Promise<number | null> {
  const rootDir = getSharedMemoryDir();
  const tombstonePath =
    rootDir && resolveTombstonePath(rootDir, owner, resourcePath);
  if (!tombstonePath) return null;
  const record = await readTombstoneRecord(tombstonePath);
  if (record?.pendingPid == null) return null;
  return isProcessAlive(record.pendingPid) ? null : record.deletedAt;
}

/** The raw tombstone value, whether or not the file still covers it. */
export async function readMemoryTombstone(
  owner: string,
  resourcePath: string,
): Promise<number | null> {
  const rootDir = getSharedMemoryDir();
  const tombstonePath =
    rootDir && resolveTombstonePath(rootDir, owner, resourcePath);
  return tombstonePath ? readTombstone(tombstonePath) : null;
}

/** Removes the marker only while it still holds the value this caller wrote. */
export async function clearSharedMemoryTombstone(
  owner: string,
  resourcePath: string,
  expectedDeletedAt: number,
): Promise<boolean> {
  const rootDir = getSharedMemoryDir();
  if (!rootDir) return false;
  const filePath = resolveSharedMemoryFilePath(rootDir, owner, resourcePath);
  if (!filePath) return false;
  return lockFile(filePath, async () => {
    if ((await readTombstone(`${filePath}.deleted`)) !== expectedDeletedAt) {
      return false;
    }
    await fs.promises.unlink(`${filePath}.deleted`);
    return true;
  });
}

export async function listSharedPersonalMemories(
  owner: string,
): Promise<Array<{ path: string; mtimeMs: number; size: number }>> {
  const rootDir = getSharedMemoryDir();
  if (!rootDir || !owner || owner === "__shared__" || owner.startsWith("__")) {
    return [];
  }
  const ownerDir = resolveSharedMemoryOwnerDir(rootDir, owner);
  if (!ownerDir) return [];
  try {
    const entries = await fs.promises.readdir(ownerDir, {
      withFileTypes: true,
    });
    const results: Array<{ path: string; mtimeMs: number; size: number }> = [];
    for (const entry of entries) {
      if (!entry.isFile() || !SAFE_MEMORY_FILE_PATTERN.test(entry.name)) {
        continue;
      }
      const memory = await readMirroredMemory(
        owner,
        `${MEMORY_PREFIX}${entry.name}`,
        rootDir,
      );
      if (memory.state !== "present") continue;
      results.push({
        path: `${MEMORY_PREFIX}${entry.name}`,
        mtimeMs: memory.mtimeMs,
        size: memory.size,
      });
    }
    return results;
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
}
