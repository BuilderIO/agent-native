/**
 * Dev-mode script registry.
 *
 * Provides file system, shell, and database tools for the agent
 * when running in development mode. These tools should NEVER be
 * registered in production.
 */

import type { ActionTool } from "../../agent/types.js";
import type { ActionEntry } from "../../agent/production-agent.js";
import { tool as readFileTool, run as readFileRun } from "./read-file.js";
import { tool as writeFileTool, run as writeFileRun } from "./write-file.js";
import { tool as listFilesTool, run as listFilesRun } from "./list-files.js";
import {
  tool as searchFilesTool,
  run as searchFilesRun,
} from "./search-files.js";
import { tool as shellTool, run as shellRun } from "./shell.js";

/**
 * Wraps a core CLI script (that writes to console.log) as a ActionEntry
 * by capturing stdout.
 */
function wrapCliScript(
  tool: ActionTool,
  cliDefault: (args: string[]) => Promise<void>,
  opts?: { readOnly?: boolean },
): ActionEntry {
  return {
    tool,
    ...(opts?.readOnly ? { readOnly: true as const } : {}),
    run: async (args: Record<string, string>): Promise<string> => {
      const cliArgs: string[] = [];
      for (const [k, v] of Object.entries(args)) {
        const raw = v as unknown;
        const value =
          raw != null && typeof raw === "object"
            ? JSON.stringify(raw)
            : String(raw);
        cliArgs.push(`--${k}`, value);
      }

      // Capture console.log output
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      };

      try {
        await cliDefault(cliArgs);
      } catch (err: any) {
        logs.push(`Error: ${err?.message ?? String(err)}`);
      } finally {
        console.log = origLog;
      }

      return logs.join("\n") || "(no output)";
    },
  };
}

/**
 * Creates the dev-mode script registry with file system, shell,
 * and database tools. Call this and merge with your app's registry
 * when NODE_ENV !== "production".
 */
export async function createDevScriptRegistry(): Promise<
  Record<string, ActionEntry>
> {
  // Lazy-import DB scripts to avoid requiring libsql in non-DB apps
  let dbEntries: Record<string, ActionEntry> = {};
  try {
    // Dynamic imports — these are part of @agent-native/core
    const [dbSchema, dbQuery, dbExec, dbPatch, dbCheckScoping] =
      await Promise.all([
        import("../db/schema.js"),
        import("../db/query.js"),
        import("../db/exec.js"),
        import("../db/patch.js"),
        import("../db/check-scoping.js"),
      ]);

    dbEntries = {
      "db-schema": wrapCliScript(
        {
          description:
            "Show all database tables, columns, types, and foreign keys",
          parameters: {
            type: "object",
            properties: {
              format: {
                type: "string",
                description: 'Output format: "json" or "text" (default: text)',
                enum: ["json", "text"],
              },
            },
          },
        },
        dbSchema.default,
        { readOnly: true },
      ),
      "db-query": wrapCliScript(
        {
          description:
            "Run a read-only SQL query (SELECT, WITH, EXPLAIN, PRAGMA) against the app database",
          parameters: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description: "The SQL SELECT query to execute",
              },
              args: {
                type: "string",
                description:
                  'Optional JSON array of positional bind args for parameterized placeholders. Example: \'["draft","form-123"]\'',
              },
              format: {
                type: "string",
                description:
                  'Output format: "json" or "table" (default: table)',
                enum: ["json", "table"],
              },
            },
            required: ["sql"],
          },
        },
        dbQuery.default,
        { readOnly: true },
      ),
      "db-exec": wrapCliScript(
        {
          description:
            "Execute app-database write SQL (INSERT, UPDATE, DELETE, REPLACE). For multiple related writes, pass `statements` so they run sequentially in one transaction instead of issuing several db-exec calls. Schema changes (CREATE/ALTER/DROP) are blocked.",
          parameters: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description:
                  "Single INSERT / UPDATE / DELETE / REPLACE statement. Use parameterized placeholders (?) where possible.",
              },
              args: {
                type: "string",
                description:
                  'Optional JSON array of positional bind args for `sql`. Example: \'["published","form-123"]\'',
              },
              statements: {
                type: "string",
                description:
                  'Optional JSON array of write statements to execute in one transaction. Prefer this over multiple db-exec calls. Example: \'[{"sql":"INSERT INTO notes (id,title) VALUES (?,?)","args":["n1","One"]},{"sql":"UPDATE counters SET value = value + 1 WHERE key = ?","args":["notes"]}]\'',
              },
              format: {
                type: "string",
                description: 'Output format: "json" or "text" (default: text)',
                enum: ["json", "text"],
              },
            },
          },
        },
        dbExec.default,
      ),
      "db-patch": wrapCliScript(
        {
          description:
            "Surgical search-and-replace on a text column in a SQL table. Prefer over `db-exec UPDATE` for large text fields (documents, slides, dashboards, JSON blobs) where you only need to change a small slice — avoids re-sending the full column value. Targets exactly one row at a time (narrow --where by primary key). If a template-specific action exists for the table (e.g. `edit-document`, `update-slide`), use that instead — it will also push live updates to open collaborative editors.",
          parameters: {
            type: "object",
            properties: {
              table: {
                type: "string",
                description: "Target table name (plain identifier, no quoting)",
              },
              column: {
                type: "string",
                description:
                  "Target text column name (plain identifier, no quoting)",
              },
              where: {
                type: "string",
                description:
                  "SQL WHERE clause that matches exactly one row, e.g. \"id = 'abc123'\". Must not contain semicolons or DDL keywords.",
              },
              find: {
                type: "string",
                description:
                  "Text to find (single-edit mode). Pair with --replace.",
              },
              replace: {
                type: "string",
                description:
                  'Replacement text (single-edit mode). Defaults to "" (delete the match).',
              },
              edits: {
                type: "string",
                description:
                  'Batch mode: JSON array of {find, replace} objects. Example: \'[{"find":"Q3","replace":"Q4"},{"find":"$1M","replace":"$1.2M"}]\'',
              },
              all: {
                type: "string",
                description:
                  'Set to "true" to replace every occurrence of each find (default: first occurrence only).',
                enum: ["true", "false"],
              },
              format: {
                type: "string",
                description: 'Output format: "json" or "text" (default: text)',
                enum: ["json", "text"],
              },
            },
            required: ["table", "column", "where"],
          },
        },
        dbPatch.default,
      ),
      "db-check-scoping": wrapCliScript(
        {
          description:
            "Validate that all template tables have owner_email and org_id columns for data scoping",
          parameters: {
            type: "object",
            properties: {
              "require-org": {
                type: "string",
                description:
                  'Set to "true" to also require org_id columns (for multi-org apps)',
                enum: ["true", "false"],
              },
              format: {
                type: "string",
                description: 'Output format: "json" or "text" (default: text)',
                enum: ["json", "text"],
              },
            },
          },
        },
        dbCheckScoping.default,
        { readOnly: true },
      ),
    };
  } catch {
    // DB scripts not available (no libsql) — skip silently
  }

  return {
    "read-file": { tool: readFileTool, run: readFileRun, readOnly: true },
    "write-file": { tool: writeFileTool, run: writeFileRun },
    "list-files": { tool: listFilesTool, run: listFilesRun, readOnly: true },
    "search-files": {
      tool: searchFilesTool,
      run: searchFilesRun,
      readOnly: true,
    },
    shell: { tool: shellTool, run: shellRun },
    ...dbEntries,
  };
}
