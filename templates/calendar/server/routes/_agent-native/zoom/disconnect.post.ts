import { getSession } from "@agent-native/core/server";
/**
 * Disconnect the current user's Zoom account(s).
 */
import { defineEventHandler, setResponseStatus, type H3Event } from "h3";

import { disconnectZoom } from "../../../lib/zoom.js";

export default defineEventHandler(async (event: H3Event) => {
  const session = await getSession(event);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Not authenticated" };
  }
  await disconnectZoom(session.email);
  return { success: true };
});
