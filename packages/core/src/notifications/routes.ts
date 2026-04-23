/**
 * H3 event handlers for the notifications inbox.
 *
 * Mounted under `/_agent-native/notifications/*` by `core-routes-plugin`.
 *
 *   GET  /_agent-native/notifications?unread=true&limit=50&before=ISO
 *                                                   — list for the session owner
 *   GET  /_agent-native/notifications/count         — unread count
 *   POST /_agent-native/notifications/:id/read      — mark as read
 *   POST /_agent-native/notifications/read-all      — mark all read
 *   DELETE /_agent-native/notifications/:id         — delete
 */

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

async function resolveOwner(event: H3Event): Promise<string> {
  const session = await getSession(event).catch(() => null);
  return session?.email || "local@localhost";
}

export function createNotificationsHandler() {
  return defineEventHandler(async (event: H3Event) => {
    const method = getMethod(event);
    const pathname = (event.url?.pathname || "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    const parts = pathname ? pathname.split("/") : [];
    const owner = await resolveOwner(event);

    // GET /  — list
    if (method === "GET" && parts.length === 0) {
      const q = getQuery(event);
      return listNotifications(owner, {
        unreadOnly: q.unread === "true" || q.unread === "1",
        limit: q.limit ? Math.min(Number(q.limit) || 50, 200) : 50,
        before: typeof q.before === "string" ? q.before : undefined,
      });
    }

    // GET /count
    if (method === "GET" && parts.length === 1 && parts[0] === "count") {
      const count = await countUnread(owner);
      return { count };
    }

    // POST /read-all
    if (method === "POST" && parts.length === 1 && parts[0] === "read-all") {
      const updated = await markAllNotificationsRead(owner);
      return { updated };
    }

    // POST /:id/read
    if (method === "POST" && parts.length === 2 && parts[1] === "read") {
      const ok = await markNotificationRead(parts[0], owner);
      if (!ok) {
        setResponseStatus(event, 404);
        return { error: "Not found or already read" };
      }
      return { ok: true };
    }

    // DELETE /:id
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
