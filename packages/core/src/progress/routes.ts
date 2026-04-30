/**
 * H3 event handlers for the agent-runs progress primitive.
 *
 * Mounted under `/_agent-native/runs/*` by `core-routes-plugin`.
 *
 *   GET    /_agent-native/runs?active=true&limit=50
 *   GET    /_agent-native/runs/:id
 *   DELETE /_agent-native/runs/:id
 *
 * Writes happen through the `manage-progress` agent tool, not HTTP —
 * the agent is the canonical writer, the UI only reads. (We can add write
 * routes later if a non-agent producer needs them.)
 */

import {
  defineEventHandler,
  getMethod,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import { getSession } from "../server/auth.js";
import { listRuns, getRun, deleteRun } from "./store.js";

function parseLimit(value: unknown, fallback = 50): number {
  if (typeof value !== "string" || value.length === 0) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 200);
}

async function resolveOwner(event: H3Event): Promise<string> {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    const { createError } = await import("h3");
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  return session.email;
}

export function createProgressHandler() {
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
    const owner = await resolveOwner(event);

    // GET /  — list
    if (method === "GET" && parts.length === 0) {
      const q = getQuery(event);
      return listRuns(owner, {
        activeOnly: q.active === "true" || q.active === "1",
        limit: parseLimit(q.limit),
      });
    }

    // GET /:id
    if (method === "GET" && parts.length === 1) {
      const row = await getRun(parts[0], owner);
      if (!row) {
        setResponseStatus(event, 404);
        return { error: "Not found" };
      }
      return row;
    }

    // DELETE /:id
    if (method === "DELETE" && parts.length === 1) {
      const ok = await deleteRun(parts[0], owner);
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
