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

function resolveTombstonePath(
  rootDir: string,
  owner: string,
  resourcePath: string,
): string | null {
  const filePath = resolveSharedMemoryFilePath(rootDir, owner, resourcePath);
  return filePath ? `${filePath}.deleted` : null;
}

export async function readSharedMemoryTombstone(
  owner: string,
  resourcePath: string,
): Promise<number | null> {
  const rootDir = getSharedMemoryDir();
  if (!rootDir) return null;
  const tombstonePath = resolveTombstonePath(rootDir, owner, resourcePath);
  if (!tombstonePath) return null;
  try {
    const deletedAt = Number(await fs.promises.readFile(tombstonePath, "utf8"));
    if (!Number.isFinite(deletedAt)) {
      throw new Error(`Unreadable memory tombstone: ${tombstonePath}`);
    }
    return deletedAt;
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

export async function readSharedPersonalMemory(
  owner: string,
  resourcePath: string,
): Promise<{ content: string; mtimeMs: number; size: number } | null> {
  const rootDir = getSharedMemoryDir();
  if (!rootDir) return null;
  const filePath = resolveSharedMemoryFilePath(rootDir, owner, resourcePath);
  if (!filePath) return null;
  try {
    const [stat, content] = await Promise.all([
      fs.promises.stat(filePath),
      fs.promises.readFile(filePath, "utf8"),
    ]);
    if (!stat.isFile()) return null;
    return {
      content,
      mtimeMs: Math.floor(stat.mtimeMs),
      size: Buffer.byteLength(content, "utf8"),
    };
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
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
  await fs.promises.writeFile(filePath, content, "utf8");
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
  await fs.promises.writeFile(
    `${filePath}.deleted`,
    String(Date.now()),
    "utf8",
  );
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
      const stat = await fs.promises.stat(path.join(ownerDir, entry.name));
      results.push({
        path: `${MEMORY_PREFIX}${entry.name}`,
        mtimeMs: Math.floor(stat.mtimeMs),
        size: stat.size,
      });
    }
    return results;
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
}
