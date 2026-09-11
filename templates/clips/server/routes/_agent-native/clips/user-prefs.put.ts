import { getSession } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { defineEventHandler, getHeader, readBody, setResponseStatus } from "h3";

const CLIPS_USER_PREFS_KEY = "clips-user-prefs";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "unauthorized" };
  }

  const body = await readBody(event).catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    setResponseStatus(event, 400);
    return { error: "Invalid settings payload" };
  }

  // Merge so partial Settings saves (playback, notifications, …) don't wipe
  // AI-tool prefs written from the recording page popover.
  const existing =
    (await getUserSetting(session.email, CLIPS_USER_PREFS_KEY)) ?? {};
  const next = {
    ...(typeof existing === "object" && existing && !Array.isArray(existing)
      ? existing
      : {}),
    ...(body as Record<string, unknown>),
  };

  await putUserSetting(session.email, CLIPS_USER_PREFS_KEY, next, {
    requestSource: getHeader(event, "x-request-source") || undefined,
  });
  return next;
});
