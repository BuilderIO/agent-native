import {
  defineEventHandler,
  getMethod,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getSession } from "../server/auth.js";
import {
  listRuns,
  getRun,
  deleteRun,
  resolveProgressSourceAppId,
} from "./store.js";

function parseLimit(value: unknown, fallback = 50): number {
  if (typeof value !== "string" || value.length === 0) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 200);
}

async function resolveOwner(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session?.email) {
    const { createError } = await import("h3");
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  return session.email;
}

export function createProgressHandler(options: { localApp?: boolean } = {}) {
  return defineEventHandler(async (event: H3Event) => {
    const rawMethod = getMethod(event);
    const method = rawMethod === "HEAD" ? "GET" : rawMethod;
    if (rawMethod === "OPTIONS") {
      setResponseStatus(event, 204);
      return "";
    }
    const pathname = (event.url?.pathname || "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    const parts = pathname ? pathname.split("/") : [];
    const runId = parts.length === 1 ? parts.at(0) : undefined;
    const owner = await resolveOwner(event);
    const scope = options.localApp
      ? { sourceAppId: resolveProgressSourceAppId() }
      : undefined;

    if (method === "GET" && parts.length === 0) {
      const q = getQuery(event);
      return listRuns(owner, {
        activeOnly: q.active === "true" || q.active === "1",
        limit: parseLimit(q.limit),
        event,
        ...scope,
      });
    }

    if (method === "GET" && runId !== undefined) {
      const row = scope
        ? await getRun(runId, owner, scope)
        : await getRun(runId, owner);
      if (!row) {
        setResponseStatus(event, 404);
        return { error: "Not found" };
      }
      return row;
    }

    if (method === "DELETE" && runId !== undefined) {
      const ok = scope
        ? await deleteRun(runId, owner, scope)
        : await deleteRun(runId, owner);
      if (!ok) {
        setResponseStatus(event, 404);
        return { error: "Not found" };
      }
      return { ok: true };
    }

    setResponseStatus(event, 404);
    return { error: "Not found" };
  });
}
