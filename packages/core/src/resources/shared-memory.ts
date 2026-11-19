import fs from "node:fs";
import path from "node:path";

const MEMORY_PREFIX = "memory/";
const SAFE_MEMORY_FILE_PATTERN = /^[a-zA-Z0-9._-]+\.md$/;

/**
 * Optional directory shared across local app processes in the desktop app
 * so personal `memory/*` resources written by one app agent load in every
 * other app agent's new chats.
 */
export function getSharedMemoryDir(): string | null {
  const dir = process.env.AGENT_NATIVE_MEMORY_DIR?.trim();
  return dir ? path.resolve(dir) : null;
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
      mtimeMs: stat.mtimeMs,
      size: Buffer.byteLength(content, "utf8"),
    };
  } catch {
    return null;
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
}

export async function deleteSharedPersonalMemory(
  owner: string,
  resourcePath: string,
): Promise<void> {
  const rootDir = getSharedMemoryDir();
  if (!rootDir) return;
  const filePath = resolveSharedMemoryFilePath(rootDir, owner, resourcePath);
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
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
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
    return results;
  } catch {
    return [];
  }
}
