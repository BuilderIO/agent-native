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

      if (!isDevEnvironment()) {
        setResponseStatus(event, 403);
        return {
          ok: false,
          error: "DB admin is only available in development mode.",
        };
      }

      const method = getMethod(event);
      const raw = (event.path || "/").split("?")[0];
      const segments = raw
        .replace(/^\/+/, "")
        .split("/")
        .filter(Boolean)
        .map(decodeSegment);

      try {
        if (segments[0] === "overview" && segments.length === 1) {
          if (method !== "GET") return methodNotAllowed(event);
          const result = await listTables();
          return { ok: true, ...result };
        }

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
              includeLargeCells: body.includeLargeCells === true,
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
