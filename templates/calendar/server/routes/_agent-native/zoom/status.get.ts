import { getSession } from "@agent-native/core/server";
import { defineEventHandler, type H3Event } from "h3";

import { getZoomStatus } from "../../../lib/zoom.js";

export default defineEventHandler(async (event: H3Event) => {
  const session = await getSession(event);
  return getZoomStatus(session?.email ?? null);
});
