import { getSession } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { defineEventHandler, setResponseStatus } from "h3";

import { ASSETS_USER_PREFS_KEY } from "../../../../shared/assets-user-prefs.js";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "unauthorized" };
  }

  const stored = await getUserSetting(session.email, ASSETS_USER_PREFS_KEY);
  // coercion-ok: a null read means this user has no preferences yet, which is a real state.
  return stored ?? {};
});
