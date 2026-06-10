/**
 * SQL schema for workspace_files — durable scratch storage for the agent.
 *
 * Files are scoped to either a user (scope="user", scope_id=email) or a
 * workspace / org (scope="org", scope_id=orgId), mirroring the secrets table
 * pattern. Paths are unique per scope+scope_id pair and may include path
 * separators (e.g. "analysis/2026-q2/step1.md").
 *
 * Size limits:
 *   - Per-file content: 2 MB (enforced in the store layer).
 *   - Per-scope total: 200 MB (enforced in the store layer).
 */

import { table, text, integer } from "../db/schema.js";

export const workspaceFiles = table("workspace_files", {
  id: text("id").primaryKey(),
  /** "user" or "org" */
  scope: text("scope").notNull(),
  /** Email for user-scope; orgId for org-scope. */
  scopeId: text("scope_id").notNull(),
  /** Relative path within the scope, e.g. "memos/q2.md". Unique per scope+scopeId. */
  path: text("path").notNull(),
  /** File content (text). */
  content: text("content").notNull().default(""),
  /** MIME type, e.g. "text/plain", "application/json". */
  contentType: text("content_type").notNull().default("text/plain"),
  /** Byte length of content (utf-8). */
  sizeBytes: integer("size_bytes").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Raw CREATE TABLE SQL used by the on-demand migration path.
 * Written for SQLite; the migration runner adapts it for Postgres.
 */
export const WORKSPACE_FILES_CREATE_SQL = `CREATE TABLE IF NOT EXISTS workspace_files (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'text/plain',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope, scope_id, path)
)`;

export const WORKSPACE_FILES_INDEX_SQL = `CREATE INDEX IF NOT EXISTS workspace_files_scope_idx ON workspace_files (scope, scope_id, updated_at)`;
