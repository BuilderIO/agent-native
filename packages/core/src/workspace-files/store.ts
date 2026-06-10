/**
 * Workspace-files store.
 *
 * Provides read/write/append/list/delete/grep operations over the
 * `workspace_files` table. All writes enforce per-file (2 MB) and per-scope
 * (200 MB) caps. The table is lazily migrated on first use.
 */

import crypto from "node:crypto";
import { getDbExec } from "../db/client.js";
import {
  WORKSPACE_FILES_CREATE_SQL,
  WORKSPACE_FILES_INDEX_SQL,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max content size per file (bytes). */
export const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

/** Max total content size across all files in one scope (bytes). */
export const MAX_SCOPE_BYTES = 200 * 1024 * 1024; // 200 MB

/** Max content size when saving via saveToFile from provider-api / fetch tool (bytes). */
export const SAVE_TO_FILE_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

// ---------------------------------------------------------------------------
// Lazy table init
// ---------------------------------------------------------------------------

let _tableReady = false;

async function ensureTable(): Promise<void> {
  if (_tableReady) return;
  const db = getDbExec();
  await db.execute(WORKSPACE_FILES_CREATE_SQL);
  await db.execute(WORKSPACE_FILES_INDEX_SQL);
  _tableReady = true;
}

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

export interface WorkspaceFilesScope {
  scope: "user" | "org";
  scopeId: string;
}

/**
 * Validate a workspace file path.
 * - Non-empty, no leading slash, no ".." components, no null bytes.
 */
export function validatePath(path: string): string | null {
  if (!path || typeof path !== "string") return "path is required";
  if (path.startsWith("/")) return 'path must not start with "/"';
  if (path.includes("\0")) return "path must not contain null bytes";
  const parts = path.split("/");
  for (const part of parts) {
    if (part === "..") return 'path must not contain ".." components';
    if (part === "")
      return 'path must not contain empty segments ("//" or trailing "/")';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceFile {
  id: string;
  scope: string;
  scopeId: string;
  path: string;
  content: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceFileMeta {
  id: string;
  path: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

/**
 * Write (create or overwrite) a workspace file.
 * Enforces per-file (2 MB default; `saveToFile` callers may raise it up to
 * 20 MB via `opts.maxFileBytes`) and per-scope (200 MB) caps.
 */
export async function writeWorkspaceFile(
  scope: WorkspaceFilesScope,
  path: string,
  content: string,
  contentType = "text/plain",
  opts?: { maxFileBytes?: number },
): Promise<WorkspaceFileMeta> {
  const pathErr = validatePath(path);
  if (pathErr) throw new Error(`Invalid path: ${pathErr}`);

  const maxFileBytes = Math.min(
    opts?.maxFileBytes ?? MAX_FILE_BYTES,
    SAVE_TO_FILE_MAX_BYTES,
  );
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > maxFileBytes) {
    throw new Error(
      `File "${path}" would be ${(bytes / 1024 / 1024).toFixed(2)} MB, which exceeds the ${(maxFileBytes / 1024 / 1024).toFixed(0)} MB per-file limit.`,
    );
  }

  await ensureTable();
  const db = getDbExec();

  // Check scope total (excluding current file's existing bytes).
  const existing = await getWorkspaceFileMeta(scope, path);
  const existingBytes = existing?.sizeBytes ?? 0;
  const scopeTotal = await getScopeTotalBytes(scope);
  const newTotal = scopeTotal - existingBytes + bytes;
  if (newTotal > MAX_SCOPE_BYTES) {
    throw new Error(
      `Writing "${path}" would bring the workspace total to ${(newTotal / 1024 / 1024).toFixed(1)} MB, exceeding the 200 MB limit.`,
    );
  }

  const now = new Date().toISOString();

  if (existing) {
    await db.execute({
      sql: `UPDATE workspace_files SET content = ?, content_type = ?, size_bytes = ?, updated_at = ? WHERE scope = ? AND scope_id = ? AND path = ?`,
      args: [
        content,
        contentType,
        bytes,
        now,
        scope.scope,
        scope.scopeId,
        path,
      ],
    });
    return {
      ...existing,
      content: undefined as any,
      contentType,
      sizeBytes: bytes,
      updatedAt: now,
    } as unknown as WorkspaceFileMeta;
  }

  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO workspace_files (id, scope, scope_id, path, content, content_type, size_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      scope.scope,
      scope.scopeId,
      path,
      content,
      contentType,
      bytes,
      now,
      now,
    ],
  });
  return {
    id,
    path,
    contentType,
    sizeBytes: bytes,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Append text to an existing workspace file, or create it if it doesn't exist.
 */
export async function appendWorkspaceFile(
  scope: WorkspaceFilesScope,
  path: string,
  text: string,
  contentType = "text/plain",
): Promise<WorkspaceFileMeta> {
  const pathErr = validatePath(path);
  if (pathErr) throw new Error(`Invalid path: ${pathErr}`);

  await ensureTable();
  const existing = await readWorkspaceFile(scope, path);
  const newContent = existing ? existing.content + text : text;
  return writeWorkspaceFile(scope, path, newContent, contentType);
}

/**
 * Read a workspace file's content (with optional offset and maxChars for paging).
 * Returns null if the file doesn't exist.
 */
export async function readWorkspaceFile(
  scope: WorkspaceFilesScope,
  path: string,
  opts?: { offset?: number; maxChars?: number },
): Promise<WorkspaceFile | null> {
  const pathErr = validatePath(path);
  if (pathErr) throw new Error(`Invalid path: ${pathErr}`);

  await ensureTable();
  const db = getDbExec();
  const result = await db.execute({
    sql: `SELECT id, scope, scope_id, path, content, content_type, size_bytes, created_at, updated_at FROM workspace_files WHERE scope = ? AND scope_id = ? AND path = ?`,
    args: [scope.scope, scope.scopeId, path],
  });

  const row = result.rows[0];
  if (!row) return null;

  let content = String(row[4] ?? "");
  if (opts?.offset || opts?.maxChars) {
    const off = opts.offset ?? 0;
    content = content.slice(
      off,
      opts.maxChars !== undefined ? off + opts.maxChars : undefined,
    );
  }

  return {
    id: String(row[0]),
    scope: String(row[1]),
    scopeId: String(row[2]),
    path: String(row[3]),
    content,
    contentType: String(row[5] ?? "text/plain"),
    sizeBytes: Number(row[6] ?? 0),
    createdAt: String(row[7]),
    updatedAt: String(row[8]),
  };
}

/**
 * Get file metadata without loading content.
 */
export async function getWorkspaceFileMeta(
  scope: WorkspaceFilesScope,
  path: string,
): Promise<WorkspaceFileMeta | null> {
  await ensureTable();
  const db = getDbExec();
  const result = await db.execute({
    sql: `SELECT id, path, content_type, size_bytes, created_at, updated_at FROM workspace_files WHERE scope = ? AND scope_id = ? AND path = ?`,
    args: [scope.scope, scope.scopeId, path],
  });

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: String(row[0]),
    path: String(row[1]),
    contentType: String(row[2] ?? "text/plain"),
    sizeBytes: Number(row[3] ?? 0),
    createdAt: String(row[4]),
    updatedAt: String(row[5]),
  };
}

/**
 * List workspace files, optionally filtered by path prefix.
 * Returns metadata only (no content).
 */
export async function listWorkspaceFiles(
  scope: WorkspaceFilesScope,
  prefix?: string,
): Promise<WorkspaceFileMeta[]> {
  await ensureTable();
  const db = getDbExec();

  if (prefix) {
    // Allow a trailing slash on list prefixes, but reject traversal and
    // other invalid path shapes before they reach the LIKE pattern.
    const normalizedPrefix = prefix.endsWith("/")
      ? prefix.slice(0, -1)
      : prefix;
    const pathErr = validatePath(normalizedPrefix);
    if (pathErr) {
      throw new Error(pathErr);
    }
    const result = await db.execute({
      sql: `SELECT id, path, content_type, size_bytes, created_at, updated_at FROM workspace_files WHERE scope = ? AND scope_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\') ORDER BY path ASC`,
      args: [
        scope.scope,
        scope.scopeId,
        normalizedPrefix,
        `${normalizedPrefix.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}/%`,
      ],
    });
    return result.rows.map(rowToMeta);
  }

  const result = await db.execute({
    sql: `SELECT id, path, content_type, size_bytes, created_at, updated_at FROM workspace_files WHERE scope = ? AND scope_id = ? ORDER BY path ASC`,
    args: [scope.scope, scope.scopeId],
  });
  return result.rows.map(rowToMeta);
}

/**
 * Delete a workspace file. Returns true if deleted, false if not found.
 */
export async function deleteWorkspaceFile(
  scope: WorkspaceFilesScope,
  path: string,
): Promise<boolean> {
  const pathErr = validatePath(path);
  if (pathErr) throw new Error(`Invalid path: ${pathErr}`);

  await ensureTable();
  const db = getDbExec();
  const result = await db.execute({
    sql: `DELETE FROM workspace_files WHERE scope = ? AND scope_id = ? AND path = ?`,
    args: [scope.scope, scope.scopeId, path],
  });
  return result.rowsAffected > 0;
}

/**
 * Search file contents for a substring or regex pattern.
 * Returns matching lines with path context.
 */
export async function grepWorkspaceFiles(
  scope: WorkspaceFilesScope,
  pattern: string,
  opts?: {
    pathPrefix?: string;
    useRegex?: boolean;
    maxMatchesPerFile?: number;
    maxFiles?: number;
  },
): Promise<Array<{ path: string; lineNumber: number; line: string }>> {
  const files = await listWorkspaceFiles(scope, opts?.pathPrefix);
  const limited = files.slice(0, opts?.maxFiles ?? 50);

  let regex: RegExp;
  try {
    regex = opts?.useRegex
      ? new RegExp(pattern, "i")
      : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  } catch {
    throw new Error(`Invalid regex pattern: ${pattern}`);
  }

  const results: Array<{ path: string; lineNumber: number; line: string }> = [];
  const maxPerFile = opts?.maxMatchesPerFile ?? 20;

  for (const meta of limited) {
    const file = await readWorkspaceFile(scope, meta.path);
    if (!file) continue;
    const lines = file.content.split("\n");
    let matchCount = 0;
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        results.push({ path: meta.path, lineNumber: i + 1, line: lines[i] });
        matchCount++;
        if (matchCount >= maxPerFile) break;
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getScopeTotalBytes(scope: WorkspaceFilesScope): Promise<number> {
  const db = getDbExec();
  const result = await db.execute({
    sql: `SELECT COALESCE(SUM(size_bytes), 0) as total FROM workspace_files WHERE scope = ? AND scope_id = ?`,
    args: [scope.scope, scope.scopeId],
  });
  return Number(result.rows[0]?.[0] ?? 0);
}

function rowToMeta(row: any[]): WorkspaceFileMeta {
  return {
    id: String(row[0]),
    path: String(row[1]),
    contentType: String(row[2] ?? "text/plain"),
    sizeBytes: Number(row[3] ?? 0),
    createdAt: String(row[4]),
    updatedAt: String(row[5]),
  };
}
