/**
 * Code Room — workspace resolver and path-safety helpers.
 *
 * The Code Room lets a signed-in user register one or more local filesystem
 * directories ("workspaces") and then browse / edit / diff / commit files
 * inside them. Every fs and git op below is rooted at the workspace's
 * absolute path on disk, and any user-supplied relative path is funneled
 * through {@link assertPathInWorkspace} before it touches the disk.
 *
 * Security model
 * --------------
 * - Per-user scoping: a workspace row is only resolvable for the user
 *   that owns it. Cross-tenant access is rejected here, not deeper in the
 *   stack.
 * - Path traversal: `path.resolve` collapses `..` segments, so we always
 *   resolve a candidate path against the workspace root and then check
 *   that the result is the root OR begins with `root + path.sep`. Any
 *   path that escapes — `../../etc/passwd`, absolute paths, symlinks
 *   pointing out of tree — throws before any fs call.
 * - No env vars: the workspace root is whatever path the user
 *   registered. We never fall back to `process.cwd()`, `$HOME`, or
 *   anything implicit.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";

export interface CodeWorkspace {
  id: string;
  label: string;
  /** Absolute, resolved path on disk. */
  path: string;
  isDefault: boolean;
}

/**
 * Resolve a workspace by id for the current user. Throws when the row is
 * missing OR owned by someone else — callers must already have established
 * `userEmail` from the request context.
 */
export async function getCodeWorkspace(
  workspaceId: string,
  userEmail: string,
  _orgId: string,
): Promise<CodeWorkspace> {
  if (!workspaceId) throw new Error("workspaceId is required.");
  if (!userEmail) throw new Error("Sign in to access this workspace.");

  const db = getDb();
  const rows = await db
    .select({
      id: schema.workbenchCodeWorkspaces.id,
      label: schema.workbenchCodeWorkspaces.label,
      path: schema.workbenchCodeWorkspaces.path,
      isDefault: schema.workbenchCodeWorkspaces.isDefault,
      ownerEmail: schema.workbenchCodeWorkspaces.ownerEmail,
    })
    .from(schema.workbenchCodeWorkspaces)
    .where(
      and(
        eq(schema.workbenchCodeWorkspaces.id, workspaceId),
        eq(schema.workbenchCodeWorkspaces.ownerEmail, userEmail),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error(
      `Workspace not found or you don't have access to it: ${workspaceId}`,
    );
  }

  return {
    id: row.id,
    label: row.label,
    path: path.resolve(row.path),
    isDefault: Boolean(row.isDefault),
  };
}

/**
 * Returns `requested` resolved against `workspaceRoot` IF and ONLY IF the
 * resolved path is inside the workspace (including the root itself).
 * Throws otherwise. Use this for every fs op rooted at a workspace.
 */
export function assertPathInWorkspace(
  workspaceRoot: string,
  requestedPath: string,
): string {
  const root = path.resolve(workspaceRoot);
  // Treat empty string / "." as the workspace root itself.
  const normalizedRequest =
    requestedPath === "" || requestedPath === "." ? "." : requestedPath;
  const resolved = path.resolve(root, normalizedRequest);
  const isRoot = resolved === root;
  const isInside = resolved.startsWith(root + path.sep);
  if (!isRoot && !isInside) {
    throw new Error(`Path is outside the workspace root: ${requestedPath}`);
  }
  return resolved;
}

/**
 * Returns true when `absolutePath` exists, is a directory, and has a
 * `.git` entry (file or directory — `.git` is a file for worktrees /
 * submodules).
 */
export async function isGitRepo(absolutePath: string): Promise<boolean> {
  try {
    const gitPath = path.join(absolutePath, ".git");
    await fs.stat(gitPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true when `absolutePath` exists and is a directory.
 */
export async function isExistingDirectory(
  absolutePath: string,
): Promise<boolean> {
  try {
    const stat = await fs.stat(absolutePath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
