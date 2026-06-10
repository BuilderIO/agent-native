/**
 * `workspace-files` agent tool.
 *
 * A single tool with an `action` discriminator covering write, append, read,
 * list, delete, and grep. Files persist across conversations; the agent uses
 * them to stage large intermediate results (fetched pages, per-item memos)
 * and then read back selectively for synthesis.
 *
 * Scope is automatically resolved from the active request context:
 *  - org scope when a request orgId is present (shared across users in the org)
 *  - user scope otherwise (personal to the requesting user's email)
 */

import type { ActionEntry } from "../agent/production-agent.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import {
  writeWorkspaceFile,
  appendWorkspaceFile,
  readWorkspaceFile,
  listWorkspaceFiles,
  deleteWorkspaceFile,
  grepWorkspaceFiles,
  type WorkspaceFilesScope,
} from "./store.js";

const MAX_READ_CHARS = 100_000;
const DEFAULT_READ_CHARS = 40_000;

/** Resolve scope from the current request context (org-preferred). */
function resolveScope(): WorkspaceFilesScope | null {
  const orgId = getRequestOrgId();
  if (orgId) return { scope: "org", scopeId: orgId };
  const email = getRequestUserEmail();
  if (email) return { scope: "user", scopeId: email };
  return null;
}

export function createWorkspaceFilesTool(): Record<string, ActionEntry> {
  return {
    "workspace-files": {
      readOnly: false,
      tool: {
        description: [
          "Durable scratch-file storage for the agent. Files persist across conversations and are scoped to the current org/user.",
          "Use this to stage large intermediate results (fetched pages, per-item analysis memos, API payloads) so they don't consume context window, then read them back selectively for synthesis.",
          "",
          "Typical fusion-style workflow:",
          "  1. Fan out: for each item, fetch data and `write` a per-item memo file.",
          "  2. Synthesize: `list` files, then `read` each memo (with offset/maxChars to page large ones).",
          "  3. Optionally `grep` across all memos to find patterns.",
          "  4. `delete` temp files when no longer needed.",
          "",
          "Actions:",
          "  write   — create or overwrite a file. Max 2 MB per file, 200 MB total.",
          "  append  — append text to a file (or create if absent).",
          "  read    — read content, optionally with offset/maxChars for paging large files.",
          "  list    — list files (with optional path prefix filter) showing name, size, updated.",
          "  delete  — delete a file by path.",
          "  grep    — search content across files for a substring or regex.",
        ].join("\n"),
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["write", "append", "read", "list", "delete", "grep"],
              description: "Operation to perform.",
            },
            path: {
              type: "string",
              description:
                'File path relative to the scope root, e.g. "analysis/q2-memos/acme.md". Required for write/append/read/delete. Optional for list/grep (acts as prefix filter).',
            },
            content: {
              type: "string",
              description:
                "Text content to write or append. Required for write/append.",
            },
            contentType: {
              type: "string",
              description:
                'MIME type for new files. Default: "text/plain". Use "application/json" for JSON, "text/markdown" for Markdown.',
            },
            offset: {
              type: "number",
              description:
                "Character offset to start reading from (for paging large files). Default: 0.",
            },
            maxChars: {
              type: "number",
              description: `Maximum characters to return when reading. Default: ${DEFAULT_READ_CHARS}. Max: ${MAX_READ_CHARS}.`,
            },
            pattern: {
              type: "string",
              description:
                "Search pattern for grep. Required for grep action. A plain substring by default; set useRegex to true for a regex.",
            },
            useRegex: {
              type: "boolean",
              description:
                "When true, treat `pattern` as a JavaScript regex (case-insensitive). Default: false.",
            },
          },
          required: ["action"],
        },
      },

      run: async (args: Record<string, unknown>): Promise<string> => {
        const scope = resolveScope();
        if (!scope) {
          return "Error: workspace-files requires an authenticated request context.";
        }

        const action = String(args.action ?? "").trim();

        try {
          switch (action) {
            case "write": {
              const path = String(args.path ?? "").trim();
              if (!path) return "Error: path is required for write.";
              const content = String(args.content ?? "");
              const contentType = String(args.contentType ?? "text/plain");
              const meta = await writeWorkspaceFile(
                scope,
                path,
                content,
                contentType,
              );
              return JSON.stringify({
                ok: true,
                action: "write",
                path: meta.path,
                sizeBytes: meta.sizeBytes,
                updatedAt: meta.updatedAt,
              });
            }

            case "append": {
              const path = String(args.path ?? "").trim();
              if (!path) return "Error: path is required for append.";
              const content = String(args.content ?? "");
              const contentType = String(args.contentType ?? "text/plain");
              const meta = await appendWorkspaceFile(
                scope,
                path,
                content,
                contentType,
              );
              return JSON.stringify({
                ok: true,
                action: "append",
                path: meta.path,
                sizeBytes: meta.sizeBytes,
                updatedAt: meta.updatedAt,
              });
            }

            case "read": {
              const path = String(args.path ?? "").trim();
              if (!path) return "Error: path is required for read.";
              const rawOffset = Number(args.offset);
              const offset =
                Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
              const rawMax = Number(args.maxChars);
              const maxChars =
                Number.isFinite(rawMax) && rawMax > 0
                  ? Math.min(rawMax, MAX_READ_CHARS)
                  : DEFAULT_READ_CHARS;

              const file = await readWorkspaceFile(scope, path, {
                offset,
                maxChars,
              });
              if (!file) {
                return JSON.stringify({
                  ok: false,
                  error: `File not found: "${path}"`,
                });
              }

              const truncated = file.content.length >= maxChars;
              return JSON.stringify({
                ok: true,
                path: file.path,
                contentType: file.contentType,
                sizeBytes: file.sizeBytes,
                updatedAt: file.updatedAt,
                content: file.content,
                ...(truncated
                  ? {
                      truncated: true,
                      nextOffset: offset + file.content.length,
                      hint: `File has more content. Call again with offset: ${offset + file.content.length}`,
                    }
                  : {}),
              });
            }

            case "list": {
              const prefix = args.path ? String(args.path).trim() : undefined;
              const files = await listWorkspaceFiles(
                scope,
                prefix || undefined,
              );
              return JSON.stringify({
                ok: true,
                count: files.length,
                files: files.map((f) => ({
                  path: f.path,
                  sizeBytes: f.sizeBytes,
                  contentType: f.contentType,
                  updatedAt: f.updatedAt,
                })),
              });
            }

            case "delete": {
              const path = String(args.path ?? "").trim();
              if (!path) return "Error: path is required for delete.";
              const deleted = await deleteWorkspaceFile(scope, path);
              return JSON.stringify({
                ok: true,
                deleted,
                path,
              });
            }

            case "grep": {
              const pattern = String(args.pattern ?? "").trim();
              if (!pattern) return "Error: pattern is required for grep.";
              const prefix = args.path ? String(args.path).trim() : undefined;
              const useRegex =
                args.useRegex === true || String(args.useRegex) === "true";
              const matches = await grepWorkspaceFiles(scope, pattern, {
                pathPrefix: prefix || undefined,
                useRegex,
                maxMatchesPerFile: 20,
                maxFiles: 50,
              });
              return JSON.stringify({
                ok: true,
                pattern,
                matchCount: matches.length,
                matches: matches.map((m) => ({
                  path: m.path,
                  line: m.lineNumber,
                  text: m.line,
                })),
              });
            }

            default:
              return `Error: unknown action "${action}". Valid actions: write, append, read, list, delete, grep.`;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ ok: false, error: msg });
        }
      },
    },
  };
}
