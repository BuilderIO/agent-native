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

export class MemoryTombstoneError extends Error {}

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

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.promises.writeFile(temp, content, "utf8");
  await fs.promises.rename(temp, filePath);
}

async function readTombstone(tombstonePath: string): Promise<number | null> {
  try {
    const text = (await fs.promises.readFile(tombstonePath, "utf8")).trim();
    if (!/^\d+$/.test(text)) {
      throw new MemoryTombstoneError(
        `Invalid memory tombstone: ${tombstonePath}`,
      );
    }
    const deletedAt = Number(text);
    if (!Number.isSafeInteger(deletedAt)) {
      throw new MemoryTombstoneError(
        `Invalid memory tombstone: ${tombstonePath}`,
      );
    }
    return deletedAt;
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
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
  const deletedAt = await readTombstone(tombstonePath);
  try {
    const [stat, content] = await Promise.all([
      fs.promises.stat(filePath),
      fs.promises.readFile(filePath, "utf8"),
    ]);
    if (!stat.isFile()) return { state: "absent" };
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
    return deletedAt === null
      ? { state: "absent" }
      : { state: "deleted", deletedAt };
  }
}

export async function writeSharedPersonalMemory(
  owner: string,
  resourcePath: string,
  content: string,
): Promise<void> {
  const rootDir = getSharedMemoryDir();
  if (!rootDir) return;
  const filePath = resolveSharedMemoryFilePath(rootDir, owner, resourcePath);
  if (!filePath) return;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await writeAtomic(filePath, content);
  const tombstonePath = resolveTombstonePath(rootDir, owner, resourcePath);
  if (tombstonePath) {
    await fs.promises.unlink(tombstonePath).catch((error) => {
      if (!isMissingPathError(error)) throw error;
    });
  }
}

export async function deleteSharedPersonalMemory(
  owner: string,
  resourcePath: string,
): Promise<void> {
  const rootDir = getSharedMemoryDir();
  if (!rootDir) return;
  const filePath = resolveSharedMemoryFilePath(rootDir, owner, resourcePath);
  if (!filePath) return;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await writeAtomic(`${filePath}.deleted`, String(Date.now()));
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
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
