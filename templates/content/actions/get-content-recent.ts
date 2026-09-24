import { defineAction, fail } from "@agent-native/core/action";
import { getRequestOrgId } from "@agent-native/core/server/request-context";
import { getUserSetting, mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { readContentRecentState } from "../shared/content-personal-navigation.js";
import {
  contentRecentSettingKey,
  resolveContentRecentEntries,
  withRecentPinnedState,
} from "./_content-recent.js";

export default defineAction({
  description:
    "Read the current user's recently visited Pages and exact Views in the current context, resolving every target under current access.",
  schema: z.object({
    scopeKey: z.string().optional(),
    spaceId: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe(
        "Optional Content space whose authoritative Files membership scopes the returned destinations.",
      ),
  }),
  http: { method: "GET" },
  run: async (args, ctx) => {
    if (!ctx?.userEmail) fail("Not authenticated.", { statusCode: 401 });
    const scopeKey = JSON.stringify([
      ctx.userEmail.trim().toLowerCase(),
      getRequestOrgId() ?? null,
      args.spaceId ?? null,
    ]);
    if (args.scopeKey && args.scopeKey !== scopeKey)
      fail("Navigation context changed.", {
        statusCode: 409,
        errorCode: "context_changed",
      });
    const settingKey = contentRecentSettingKey();
    const stored = await getUserSetting(ctx.userEmail, settingKey);
    let state = readContentRecentState(stored);
    if (stored !== null && (stored as { version?: unknown }).version === 1) {
      state = readContentRecentState(
        await mutateUserSetting(ctx.userEmail, settingKey, (latest) =>
          readContentRecentState(latest),
        ),
      );
    }
    const entries = await resolveContentRecentEntries(
      ctx.userEmail,
      state.entries,
      args.spaceId,
    );
    return {
      scopeKey,
      entries: await withRecentPinnedState(ctx.userEmail, entries),
    };
  },
});
