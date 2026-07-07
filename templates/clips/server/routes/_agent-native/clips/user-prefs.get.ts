import { getSession } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { defineEventHandler, setResponseStatus } from "h3";

const CLIPS_USER_PREFS_KEY = "clips-user-prefs";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "unauthorized" };
  }

  return (await getUserSetting(session.email, CLIPS_USER_PREFS_KEY)) ?? {};
});
