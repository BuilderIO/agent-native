import {
  defineEventHandler,
  getRouterParam,
  createError,
  type H3Event,
} from "h3";
import { getSession } from "@agent-native/core/server";
import { getTrackingStats } from "../../../../lib/email-tracking.js";

export default defineEventHandler(async (event: H3Event) => {
  const session = await getSession(event);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
  const messageId = getRouterParam(event, "id") as string;
  const stats = await getTrackingStats(messageId, session.email);
  return (
    stats ?? {
      opens: 0,
      linkClicks: [],
      totalClicks: 0,
    }
  );
});
