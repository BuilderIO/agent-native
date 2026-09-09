import { defineAction, fail } from "@agent-native/core/action";
import { mutateUserSetting } from "@agent-native/core/settings";

import {
  contentRecentTargetSchema,
  readContentRecentState,
  recordContentRecentVisit,
} from "../shared/content-personal-navigation.js";
import {
  contentRecentSettingKey,
  resolveContentRecentEntries,
} from "./_content-recent.js";

export default defineAction({
  description:
    "Record a successfully opened foreground Page or exact database View in the current user's Recent navigation. Does not edit or pin the target.",
  schema: contentRecentTargetSchema,
  agentTool: false,
  run: async (target, ctx) => {
    if (!ctx?.userEmail) fail("Not authenticated.", { statusCode: 401 });
    const entry = { target, visitedAt: new Date().toISOString() };
    const resolved = await resolveContentRecentEntries(ctx.userEmail, [entry]);
    if (resolved.length !== 1)
      fail("This location is unavailable.", {
        statusCode: 404,
        errorCode: "location_unavailable",
      });
    await mutateUserSetting(
      ctx.userEmail,
      contentRecentSettingKey(),
      (current) =>
        recordContentRecentVisit(readContentRecentState(current), entry),
    );
    return { recorded: true };
  },
});
