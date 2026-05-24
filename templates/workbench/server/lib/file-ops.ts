/**
 * Code Room — filesystem operations rooted at a workspace.
 *
 * Every public function in this module takes `workspaceRoot` (absolute,
 * already-resolved) plus a `relativePath` that the caller routed through
 * {@link assertPathInWorkspace}. We funnel through there again here as
 * defense-in-depth — there is no path that touches disk without that
 * check first.
 *
 * No symlink following: when we list a directory we DO NOT follow links
 * out of the workspace. For files, fs.readFile follows symlinks by
 * default — that's fine for reads of in-tree links, and the
 * assertPathInWorkspace guard already rejects out-of-tree absolute
 * links.
 */

import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { assertPathInWorkspace } from "./code-workspace.js";

export interface FileNode {
  /** Just the leaf name (e.g. "auth.ts"). */
  name: string;
  /** Path relative to the workspace root, using forward slashes. */
  path: string;
  type: "file" | "dir";
  /** File size in bytes; omitted for directories. */
  size?: number;
  /** Populated only when `depth > 0` and the node is a directory. */
  children?: FileNode[];
}

/**
 * Common noise we hide from the explorer regardless of `.gitignore` —
 * keeps the tree useful for a Mini IDE without bringing in an ignore
 * parser. Users can still navigate INTO these by typing the path, since
 * `assertPathInWorkspace` only blocks escape from the workspace, not
 * specific dirs.
 */
const NOISE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  ".netlify",
  ".output",
  "dist",
  "build",
  ".cache",
  ".DS_Store",
]);

/**
 * Read one level of a directory. When `depth > 1`, recursively populate
 * `children` for sub-directories up to that depth. Directories appear
 * before files; within each group, names sort case-insensitively.
 */
export async function listDirectory(
  workspaceRoot: string,
  relativePath: string,
  depth: number = 1,
): Promise<FileNode[]> {
  const absDir = assertPathInWorkspace(workspaceRoot, relativePath);
  const entries = await fs.readdir(absDir, { withFileTypes: true });

  const nodes: FileNode[] = [];
  for (const entry of entries) {
    if (NOISE_DIRS.has(entry.name)) continue;
    const childRel = relPosix(workspaceRoot, path.join(absDir, entry.name));
    const node: FileNode = {
      name: entry.name,
      path: childRel,
      type: entry.isDirectory() ? "dir" : "file",
    };
    if (entry.isFile()) {
      try {
        const stat = await fs.stat(path.join(absDir, entry.name));
        node.size = stat.size;
      } catch {
        // Best-effort — a permission denied still lists the entry,
        // just without its size.
      }
    }
    if (entry.isDirectory() && depth > 1) {
      try {
        node.children = await listDirectory(workspaceRoot, childRel, depth - 1);
      } catch {
        // Permission error — keep the directory entry but no children.
      }
    }
    nodes.push(node);
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return nodes;
}

/** Max bytes we'll stream to the editor pane. Beyond this we error
 *  rather than crash the browser. Monaco itself struggles past ~5MB. */
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB

export async function readFileContent(
  workspaceRoot: string,
  relativePath: string,
): Promise<{
  content: string;
  encoding: "utf-8" | "base64";
  sizeBytes: number;
}> {
  const abs = assertPathInWorkspace(workspaceRoot, relativePath);
  const stat = await fs.stat(abs);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${relativePath}`);
  }
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(
      `File is too large to open in the editor (${formatBytes(
        stat.size,
      )}). Limit is ${formatBytes(MAX_FILE_BYTES)}.`,
    );
  }
  const buf = await fs.readFile(abs);
  // Quick binary sniff: a NUL in the first 8KB is the classic heuristic
  // git itself uses. Anything binary we send back as base64 — the editor
  // pane decides whether to render or show an "unsupported" message.
  const sniffEnd = Math.min(buf.length, 8 * 1024);
  let isBinary = false;
  for (let i = 0; i < sniffEnd; i += 1) {
    if (buf[i] === 0) {
      isBinary = true;
      break;
    }
  }
  if (isBinary) {
    return {
      content: buf.toString("base64"),
      encoding: "base64",
      sizeBytes: stat.size,
    };
  }
  return {
    content: buf.toString("utf-8"),
    encoding: "utf-8",
    sizeBytes: stat.size,
  };
}

export async function writeFileContent(
  workspaceRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const abs = assertPathInWorkspace(workspaceRoot, relativePath);
  // Make sure the containing dir exists — write-then-create is friendlier
  // than 500ing for "new untitled file under src/".
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
}

export interface SearchHit {
  /** Workspace-relative path with forward slashes. */
  path: string;
  /** 1-indexed. */
  line: number;
  preview: string;
}

/**
 * Naive whole-tree search. Walks the workspace, skipping NOISE_DIRS, and
 * substring-matches each file line. Returns up to `max` hits (default
 * 100). Files >1MB are skipped to bound the work.
 */
export async function searchInFiles(
  workspaceRoot: string,
  query: string,
  options?: { caseSensitive?: boolean; max?: number },
): Promise<SearchHit[]> {
  const max = options?.max ?? 100;
  if (!query.trim()) return [];
  const needle = options?.caseSensitive ? query : query.toLowerCase();
  const hits: SearchHit[] = [];

  async function walk(dirRel: string): Promise<void> {
    if (hits.length >= max) return;
    const absDir = assertPathInWorkspace(workspaceRoot, dirRel);
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hits.length >= max) return;
      if (NOISE_DIRS.has(entry.name)) continue;
      const childRel = relPosix(workspaceRoot, path.join(absDir, entry.name));
      if (entry.isDirectory()) {
        await walk(childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = await fs.stat(path.join(absDir, entry.name));
        if (stat.size > 1024 * 1024) continue;
        const buf = await fs.readFile(path.join(absDir, entry.name));
        if (buf.includes(0)) continue; // skip binary
        const text = buf.toString("utf-8");
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          const haystack = options?.caseSensitive
            ? lines[i]
            : lines[i].toLowerCase();
          if (haystack.includes(needle)) {
            hits.push({
              path: childRel,
              line: i + 1,
              preview: lines[i].slice(0, 200),
            });
            if (hits.length >= max) return;
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  await walk(".");
  return hits;
}

/** Compute a workspace-relative path with forward slashes. */
function relPosix(workspaceRoot: string, absPath: string): string {
  const rel = path.relative(workspaceRoot, absPath);
  return rel.split(path.sep).join("/");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
