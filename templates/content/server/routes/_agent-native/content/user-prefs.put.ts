import { getSession } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { defineEventHandler, getHeader, readBody, setResponseStatus } from "h3";

import { CONTENT_USER_PREFS_KEY } from "../../../../shared/content-user-prefs.js";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "unauthorized" };
  }

  // coercion-ok: an unparsable body is rejected with 400 immediately below.
  const body = await readBody(event).catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    setResponseStatus(event, 400);
    return { error: "Invalid settings payload" };
  }

  // Merge so a partial save never wipes preferences written elsewhere.
  const stored = await getUserSetting(session.email, CONTENT_USER_PREFS_KEY);
  // coercion-ok: a null read means this user has no preferences yet, which is a real state.
  const existing = stored ?? {};
  const next = {
    ...(typeof existing === "object" && !Array.isArray(existing)
      ? existing
      : {}),
    ...(body as Record<string, unknown>),
  };

  await putUserSetting(session.email, CONTENT_USER_PREFS_KEY, next, {
    requestSource: getHeader(event, "x-request-source") || undefined,
  });
  return next;
});
