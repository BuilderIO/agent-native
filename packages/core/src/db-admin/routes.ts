/**
 * HTTP routes for the dev-mode database admin.
 *
 * Mounted under `/_agent-native/db-admin/*`. EVERY handler self-gates on
 * `NODE_ENV === "development"` (this is the authoritative gate — see
 * `isDevEnvironment`). Real logins work locally; there is no localhost or
 * `AUTH_MODE=local` shim. The DB admin exposes raw, unscoped full-database
 * access and must NEVER be reachable in a deployed / production-mode app.
 */
import {
  defineEventHandler,
  getMethod,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import type { H3Event } from "h3";

import { getH3App } from "../server/framework-request-handler.js";
import { readBody } from "../server/h3-helpers.js";
import {
  applyMutations,
  getRows,
  getTableSchema,
  listTables,
  runSql,
  DbAdminConfirmRequiredError,
} from "./operations.js";
import type { DbAdminMutation, DbAdminRowsRequest } from "./types.js";

export interface MountDbAdminRoutesOptions {
  routePrefix?: string;
}

/** Authoritative gate for the DB admin: development mode only.
 *  Available purely on `NODE_ENV === "development"` — real logins work locally
 *  and there is no localhost / `AUTH_MODE=local` shim. The normal
 *  `/_agent-native/*` auth layer still requires a signed-in user on top of this. */
function isDevEnvironment(): boolean {
  return process.env.NODE_ENV === "development";
}

function decodeSegment(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function mountDbAdminRoutes(
  nitroApp: any,
  options: MountDbAdminRoutesOptions = {},
): void {
  const routePrefix = options.routePrefix ?? "/_agent-native";
  const basePath = `${routePrefix}/db-admin`;

  getH3App(nitroApp).use(
    basePath,
    defineEventHandler(async (event: H3Event) => {
      setResponseHeader(event, "Cache-Control", "no-store");

      // Authoritative gate: development mode only (NODE_ENV === "development").
      if (!isDevEnvironment()) {
        setResponseStatus(event, 403);
        return {
          ok: false,
          error: "DB admin is only available in development mode.",
        };
      }

      const method = getMethod(event);
      // event.path is relative to the mount base path under h3's .use().
      const raw = (event.path || "/").split("?")[0];
      const segments = raw
        .replace(/^\/+/, "")
        .split("/")
        .filter(Boolean)
        .map(decodeSegment);

      try {
        // GET /overview
        if (segments[0] === "overview" && segments.length === 1) {
          if (method !== "GET") return methodNotAllowed(event);
          const result = await listTables();
          return { ok: true, ...result };
        }

        // /table/:name/...
        if (segments[0] === "table") {
          const name = segments[1];
          if (!name) return badRequest(event, "Table name is required");
          const sub = segments[2];

          if (sub === "schema" && segments.length === 3) {
            if (method !== "GET") return methodNotAllowed(event);
            const table = await getTableSchema(name);
            return { ok: true, table };
          }

          if (sub === "rows" && segments.length === 3) {
            if (method !== "POST") return methodNotAllowed(event);
            const body = await readBody<Partial<DbAdminRowsRequest>>(event);
            const result = await getRows(name, {
              page: Number(body.page) || 1,
              pageSize: Number(body.pageSize) || 50,
              sort: body.sort,
              filters: body.filters,
            });
            return { ok: true, ...result };
          }

          if (sub === "mutate" && segments.length === 3) {
            if (method !== "POST") return methodNotAllowed(event);
            const body = await readBody<DbAdminMutation>(event);
            const result = await applyMutations(name, body ?? {});
            return { ok: true, ...result };
          }

          return notFound(event, "Unknown db-admin table route");
        }

        // POST /query
        if (segments[0] === "query" && segments.length === 1) {
          if (method !== "POST") return methodNotAllowed(event);
          const body = await readBody<{
            sql?: string;
            params?: unknown[];
            confirmDestructive?: boolean;
          }>(event);
          try {
            const result = await runSql(
              String(body.sql ?? ""),
              Array.isArray(body.params) ? body.params : undefined,
              { confirmDestructive: body.confirmDestructive === true },
            );
            return { ok: true, ...result };
          } catch (err) {
            if (err instanceof DbAdminConfirmRequiredError) {
              setResponseStatus(event, 400);
              return {
                ok: false,
                error: err.message,
                needsConfirm: true,
              };
            }
            throw err;
          }
        }

        return notFound(event, "Unknown db-admin route");
      } catch (err) {
        setResponseStatus(event, 500);
        return { ok: false, error: String(err) };
      }
    }),
  );
}

function methodNotAllowed(event: H3Event) {
  setResponseStatus(event, 405);
  return { ok: false, error: "Method not allowed" };
}

function badRequest(event: H3Event, error: string) {
  setResponseStatus(event, 400);
  return { ok: false, error };
}

function notFound(event: H3Event, error: string) {
  setResponseStatus(event, 404);
  return { ok: false, error };
}
