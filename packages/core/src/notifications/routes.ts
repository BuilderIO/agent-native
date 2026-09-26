import {
  defineEventHandler,
  getMethod,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getSession } from "../server/auth.js";
import {
  listNotifications,
  countUnread,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} from "./store.js";

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

export function createNotificationsHandler() {
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

    if (method === "GET" && parts.length === 0) {
      const q = getQuery(event);
      return listNotifications(owner, {
        unreadOnly: q.unread === "true" || q.unread === "1",
        limit: parseLimit(q.limit),
        before: typeof q.before === "string" ? q.before : undefined,
      });
    }

    if (method === "GET" && parts.length === 1 && parts[0] === "count") {
      const count = await countUnread(owner);
      return { count };
    }

    if (method === "POST" && parts.length === 1 && parts[0] === "read-all") {
      const updated = await markAllNotificationsRead(owner);
      return { updated };
    }

    if (method === "POST" && parts.length === 2 && parts[1] === "read") {
      const ok = await markNotificationRead(parts[0], owner);
      if (!ok) {
        setResponseStatus(event, 404);
        return { error: "Not found or already read" };
      }
      return { ok: true };
    }

    if (method === "DELETE" && parts.length === 1) {
      const ok = await deleteNotification(parts[0], owner);
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
