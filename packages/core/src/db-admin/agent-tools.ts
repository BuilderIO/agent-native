/**
 * Dev-only agent tools for the database admin.
 *
 * These mirror the HTTP routes and call the SAME `operations.ts` functions, so
 * the agent can introspect and edit the full database during local development.
 * They are spread into the DEV actions surface ONLY (never `prodActions`) and
 * the dev surface itself is gated to dev + localhost upstream.
 *
 * Complex params (sort / filters / inserts / updates / deletes / params) are
 * accepted as JSON strings and parsed here, matching how the framework's other
 * structured CLI-style tools accept JSON-encoded arguments.
 */
import type { ActionEntry } from "../agent/production-agent.js";
import {
  applyMutations,
  getRows,
  getTableSchema,
  listTables,
  runSql,
  DbAdminConfirmRequiredError,
} from "./operations.js";
import type { DbAdminFilter, DbAdminMutation, DbAdminSort } from "./types.js";

function parseJson<T>(value: unknown, field: string): T | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(
      `Invalid JSON for "${field}": ${String(value).slice(0, 200)}`,
    );
  }
}

export function createDbAdminAgentTools(): Record<string, ActionEntry> {
  return {
    "db-admin-tables": {
      tool: {
        description:
          "DEV ONLY. List every table and view in the full database (unscoped) with row counts. Use to see the whole data model before reading or editing rows.",
        parameters: { type: "object", properties: {} },
      },
      readOnly: true,
      run: async () => JSON.stringify(await listTables()),
    },

    "db-admin-schema": {
      tool: {
        description:
          "DEV ONLY. Get the full schema for one table or view: columns, types, nullability, primary key, foreign keys, indexes, and row count.",
        parameters: {
          type: "object",
          properties: {
            table: { type: "string", description: "Table or view name" },
          },
          required: ["table"],
        },
      },
      readOnly: true,
      run: async (args: Record<string, string>) =>
        JSON.stringify(await getTableSchema(String(args.table))),
    },

    "db-admin-rows": {
      tool: {
        description:
          'DEV ONLY. Read rows from one table (unscoped) with pagination, sorting, and filters. Large text/JSON cells are previewed by default; pass includeLargeCells: "true" only when you need the full value.',
        parameters: {
          type: "object",
          properties: {
            table: { type: "string", description: "Table or view name" },
            page: {
              type: "string",
              description: "1-based page number (default 1)",
            },
            pageSize: {
              type: "string",
              description: "Rows per page (default 50, max 1000)",
            },
            sort: {
              type: "string",
              description:
                'JSON array of sort specs, e.g. \'[{"column":"created_at","dir":"desc"}]\'',
            },
            filters: {
              type: "string",
              description:
                'JSON array of filters, e.g. \'[{"column":"status","op":"eq","value":"draft"}]\'. Ops: eq, neq, lt, lte, gt, gte, like, ilike, in, is_null, not_null.',
            },
            includeLargeCells: {
              type: "string",
              description:
                'Set to "true" to return full large text/JSON cells instead of previews.',
            },
          },
          required: ["table"],
        },
      },
      readOnly: true,
      run: async (args: Record<string, string>) => {
        const result = await getRows(String(args.table), {
          page: Number(args.page) || 1,
          pageSize: Number(args.pageSize) || 50,
          sort: parseJson<DbAdminSort[]>(args.sort, "sort"),
          filters: parseJson<DbAdminFilter[]>(args.filters, "filters"),
          includeLargeCells: String(args.includeLargeCells) === "true",
        });
        return JSON.stringify(result);
      },
    },

    "db-admin-mutate": {
      tool: {
        description:
          'DEV ONLY. Insert, update, and/or delete rows in one table (unscoped — full database access). PREFER THIS over db-exec/db-patch for any database-admin edit, and ALWAYS use it (not db-exec) for tables without owner_email/org_id columns — db-exec auto-scopes to the current user and will match 0 rows on unscoped tables. Pass `dryRun: "true"` to get the SQL without executing. Each update/delete must include a where clause.',
        parameters: {
          type: "object",
          properties: {
            table: { type: "string", description: "Table name" },
            inserts: {
              type: "string",
              description:
                'JSON array of row objects to insert, e.g. \'[{"id":"1","title":"Hi"}]\'',
            },
            updates: {
              type: "string",
              description:
                'JSON array of {where, set} objects, e.g. \'[{"where":{"id":"1"},"set":{"title":"Bye"}}]\'',
            },
            deletes: {
              type: "string",
              description: 'JSON array of where objects, e.g. \'[{"id":"1"}]\'',
            },
            dryRun: {
              type: "string",
              description: 'Set to "true" to return SQL without executing',
            },
          },
          required: ["table"],
        },
      },
      run: async (args: Record<string, string>) => {
        const mutation: DbAdminMutation = {
          inserts: parseJson<Record<string, unknown>[]>(
            args.inserts,
            "inserts",
          ),
          updates: parseJson<
            { where: Record<string, unknown>; set: Record<string, unknown> }[]
          >(args.updates, "updates"),
          deletes: parseJson<Record<string, unknown>[]>(
            args.deletes,
            "deletes",
          ),
          dryRun: String(args.dryRun) === "true",
        };
        return JSON.stringify(
          await applyMutations(String(args.table), mutation),
        );
      },
    },

    "db-admin-query": {
      tool: {
        description:
          'DEV ONLY. Run arbitrary SQL against the full database (unscoped). PREFER this over db-query/db-exec for database-admin work and for tables without owner_email/org_id scoping. Bare SELECTs are auto-limited to 100 rows, and large string cells are truncated in the tool result. Destructive statements require confirmDestructive: "true".',
        parameters: {
          type: "object",
          properties: {
            sql: { type: "string", description: "SQL statement to run" },
            params: {
              type: "string",
              description:
                "Optional JSON array of positional bind args for ? placeholders",
            },
            confirmDestructive: {
              type: "string",
              description: 'Set to "true" to allow destructive statements',
            },
          },
          required: ["sql"],
        },
      },
      run: async (args: Record<string, string>) => {
        try {
          const result = await runSql(
            String(args.sql),
            parseJson<unknown[]>(args.params, "params"),
            { confirmDestructive: String(args.confirmDestructive) === "true" },
          );
          return JSON.stringify(result);
        } catch (err) {
          if (err instanceof DbAdminConfirmRequiredError) {
            return JSON.stringify({ needsConfirm: true, error: err.message });
          }
          throw err;
        }
      },
    },
  };
}
