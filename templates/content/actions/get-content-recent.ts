import { defineAction, fail } from "@agent-native/core/action";
import { getRequestOrgId } from "@agent-native/core/server/request-context";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { readContentRecentState } from "../shared/content-personal-navigation.js";
import {
  contentRecentSettingKey,
  resolveContentRecentEntries,
} from "./_content-recent.js";

export default defineAction({
  description:
    "Read the current user's recently visited Pages and exact Views in the current context, resolving every target under current access.",
  schema: z.object({ scopeKey: z.string().optional() }),
  http: { method: "GET" },
  run: async (args, ctx) => {
    if (!ctx?.userEmail) fail("Not authenticated.", { statusCode: 401 });
    const scopeKey = JSON.stringify([
      ctx.userEmail.trim().toLowerCase(),
      getRequestOrgId() ?? null,
    ]);
    if (args.scopeKey && args.scopeKey !== scopeKey)
      fail("Navigation context changed.", {
        statusCode: 409,
        errorCode: "context_changed",
      });
    const state = readContentRecentState(
      await getUserSetting(ctx.userEmail, contentRecentSettingKey()),
    );
    return {
      scopeKey,
      entries: await resolveContentRecentEntries(ctx.userEmail, state.entries),
    };
  },
});
