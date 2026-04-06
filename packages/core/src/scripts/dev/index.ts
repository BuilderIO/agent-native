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
): ActionEntry {
  return {
    tool,
    run: async (args: Record<string, string>): Promise<string> => {
      const cliArgs: string[] = [];
      for (const [k, v] of Object.entries(args)) {
        cliArgs.push(`--${k}`, v);
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
    const [dbSchema, dbQuery, dbExec, dbCheckScoping] = await Promise.all([
      import("../db/schema.js"),
      import("../db/query.js"),
      import("../db/exec.js"),
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
      ),
      "db-exec": wrapCliScript(
        {
          description:
            "Execute a write SQL statement (INSERT, UPDATE, DELETE) against the app database",
          parameters: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description: "The SQL statement to execute",
              },
            },
            required: ["sql"],
          },
        },
        dbExec.default,
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
      ),
    };
  } catch {
    // DB scripts not available (no libsql) — skip silently
  }

  return {
    "read-file": { tool: readFileTool, run: readFileRun },
    "write-file": { tool: writeFileTool, run: writeFileRun },
    "list-files": { tool: listFilesTool, run: listFilesRun },
    "search-files": { tool: searchFilesTool, run: searchFilesRun },
    shell: { tool: shellTool, run: shellRun },
    ...dbEntries,
  };
}
