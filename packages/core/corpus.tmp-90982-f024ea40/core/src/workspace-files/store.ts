/**
 * Compatibility wrapper for the old `workspace-files` API.
 *
 * Storage now goes through the core Resources table so agent files live in the
 * same workspace the user manages in the Resources panel. Paths under
 * `scratch/` are hidden agent scratch; every other path is a normal visible
 * resource in the current personal or organization scope.
 */

import {
  SHARED_OWNER,
  resourceDeleteByPath,
  resourceGetByPath,
  resourceList,
  resourcePut,
  type Resource,
  type ResourceMeta,
  type ResourceVisibility,
} from "../resources/store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max content size per file (bytes) for direct workspaceWrite calls. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Legacy export retained for API compatibility. The Resources store is the
 * canonical quota surface now, so the compatibility wrapper does not maintain a
 * separate per-scope total.
 */
export const MAX_SCOPE_BYTES = 200 * 1024 * 1024; // 200 MB

/** Max content size when saving via saveToFile from provider-api / fetch tool. */
export const SAVE_TO_FILE_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

export interface WorkspaceFilesScope {
  scope: "user" | "org";
  scopeId: string;
}

function ownerForScope(scope: WorkspaceFilesScope): string {
  return scope.scope === "org" ? SHARED_OWNER : scope.scopeId;
}

function visibilityForPath(path: string): ResourceVisibility {
  return path === "scratch" || path.startsWith("scratch/")
    ? "agent_scratch"
    : "workspace";
}

function workspaceFileMetadata(scope: WorkspaceFilesScope) {
  return {
    source: "workspace-files",
    scope: scope.scope,
    scopeId: scope.scopeId,
  };
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
 * Enforces per-file limits for the compatibility API; persistence is handled by
 * Resources. Use `scratch/...` for temporary hidden agent files.
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

  const resource = await resourcePut(
    ownerForScope(scope),
    path,
    content,
    contentType,
    {
      createdBy: "agent",
      visibility: visibilityForPath(path),
      metadata: workspaceFileMetadata(scope),
    },
  );

  return resourceToMeta(resource);
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

  const existing = await resourceGetByPath(ownerForScope(scope), path);
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

  const resource = await resourceGetByPath(ownerForScope(scope), path);
  if (!resource) return null;

  let content = resource.content;
  if (opts?.offset || opts?.maxChars) {
    const off = opts.offset ?? 0;
    content = content.slice(
      off,
      opts.maxChars !== undefined ? off + opts.maxChars : undefined,
    );
  }

  return resourceToFile(resource, scope, content);
}

/**
 * Get file metadata without loading content.
 */
export async function getWorkspaceFileMeta(
  scope: WorkspaceFilesScope,
  path: string,
): Promise<WorkspaceFileMeta | null> {
  const pathErr = validatePath(path);
  if (pathErr) throw new Error(`Invalid path: ${pathErr}`);

  const resource = await resourceGetByPath(ownerForScope(scope), path);
  return resource ? resourceToMeta(resource) : null;
}

/**
 * List workspace files, optionally filtered by path prefix.
 * Returns metadata only (no content).
 */
export async function listWorkspaceFiles(
  scope: WorkspaceFilesScope,
  prefix?: string,
): Promise<WorkspaceFileMeta[]> {
  const owner = ownerForScope(scope);
  const normalizedPrefix = normalizePrefix(prefix);
  const resources = await resourceList(owner, normalizedPrefix, {
    includeAgentScratch: true,
  });
  const filtered = normalizedPrefix
    ? resources.filter(
        (resource) =>
          resource.path === normalizedPrefix ||
          resource.path.startsWith(`${normalizedPrefix}/`),
      )
    : resources;

  return filtered
    .map(resourceToMeta)
    .sort((a, b) => a.path.localeCompare(b.path));
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

  return resourceDeleteByPath(ownerForScope(scope), path);
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

function normalizePrefix(prefix?: string): string | undefined {
  if (!prefix) return undefined;
  const normalized = prefix.replace(/\/+$/, "");
  if (!normalized) return undefined;
  const pathErr = validatePath(normalized);
  if (pathErr) throw new Error(pathErr);
  return normalized;
}

function isoTime(value: number): string {
  return new Date(value).toISOString();
}

function resourceToMeta(resource: ResourceMeta): WorkspaceFileMeta {
  return {
    id: resource.id,
    path: resource.path,
    contentType: resource.mimeType,
    sizeBytes: resource.size,
    createdAt: isoTime(resource.createdAt),
    updatedAt: isoTime(resource.updatedAt),
  };
}

function resourceToFile(
  resource: Resource,
  scope: WorkspaceFilesScope,
  content: string,
): WorkspaceFile {
  return {
    id: resource.id,
    scope: scope.scope,
    scopeId: scope.scopeId,
    path: resource.path,
    content,
    contentType: resource.mimeType,
    sizeBytes: resource.size,
    createdAt: isoTime(resource.createdAt),
    updatedAt: isoTime(resource.updatedAt),
  };
}
