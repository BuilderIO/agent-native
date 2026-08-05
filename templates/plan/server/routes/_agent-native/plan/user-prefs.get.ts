import { getSession } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { defineEventHandler, setResponseStatus } from "h3";

import { PLAN_USER_PREFS_KEY } from "../../../../shared/plan-user-prefs.js";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "unauthorized" };
  }

  // coercion-ok: no stored blob means no preferences set yet, which is a real state, not a read failure.
  return (await getUserSetting(session.email, PLAN_USER_PREFS_KEY)) ?? {};
});
