import {
  applyMutations,
  DbAdminConfirmRequiredError,
  getRows,
  getTableSchema,
  listTables,
  runSql,
  type DbAdminMutation,
  type DbAdminRowsRequest,
} from "@agent-native/core/db-admin";
import { readBody } from "@agent-native/core/server";
import {
  defineEventHandler,
  getMethod,
  getRequestURL,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  DbAdminConnectionError,
  redactDbAdminError,
  runWithDbAdminEventContext,
  withDbAdminConnectionRuntime,
} from "../../../lib/db-admin-connections";

function decodeSegment(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pathSegments(event: H3Event): string[] {
  const url = getRequestURL(event);
  const marker = "/_agent-native/analytics-db-admin";
  const markerIndex = url.pathname.indexOf(marker);
  const suffix =
    markerIndex === -1 ? "" : url.pathname.slice(markerIndex + marker.length);
  return suffix
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map(decodeSegment)
    .filter((segment): segment is string => Boolean(segment));
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

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");

  const method = getMethod(event);
  const [connectionId, ...segments] = pathSegments(event);
  if (!connectionId) {
    return badRequest(event, "Connection id is required");
  }

  try {
    return await runWithDbAdminEventContext(event, async (admin) =>
      withDbAdminConnectionRuntime(admin, connectionId, async (runtime) => {
        if (segments[0] === "overview" && segments.length === 1) {
          if (method !== "GET") return methodNotAllowed(event);
          const result = await listTables(runtime);
          return { ok: true, ...result };
        }

        if (segments[0] === "table") {
          const name = segments[1];
          if (!name) return badRequest(event, "Table name is required");
          const sub = segments[2];

          if (sub === "schema" && segments.length === 3) {
            if (method !== "GET") return methodNotAllowed(event);
            const table = await getTableSchema(name, runtime);
            return { ok: true, table };
          }

          if (sub === "rows" && segments.length === 3) {
            if (method !== "POST") return methodNotAllowed(event);
            const body = await readBody<Partial<DbAdminRowsRequest>>(event);
            const result = await getRows(
              name,
              {
                page: Number(body.page) || 1,
                pageSize: Number(body.pageSize) || 50,
                sort: body.sort,
                filters: body.filters,
              },
              runtime,
            );
            return { ok: true, ...result };
          }

          if (sub === "mutate" && segments.length === 3) {
            if (method !== "POST") return methodNotAllowed(event);
            const body = await readBody<DbAdminMutation>(event);
            const result = await applyMutations(name, body ?? {}, runtime);
            return { ok: true, ...result };
          }

          return notFound(event, "Unknown analytics db-admin table route");
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
              runtime,
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

        return notFound(event, "Unknown analytics db-admin route");
      }),
    );
  } catch (err) {
    if (err instanceof DbAdminConnectionError) {
      setResponseStatus(event, err.statusCode);
      return { ok: false, error: err.message };
    }
    setResponseStatus(event, 500);
    return { ok: false, error: redactDbAdminError(err) };
  }
});
