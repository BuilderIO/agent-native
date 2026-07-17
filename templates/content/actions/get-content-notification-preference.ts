import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { contentDefaultPersonSubscriptionId } from "./_content-database-hooks.js";
import { assertContentNotificationPreferenceTarget } from "./_content-notification-preference-access.js";
import { resolveContentNotificationPreference } from "./_content-notification-preferences.js";

export default defineAction({
  description:
    "Resolve the current user's effective personal notification preference for a Content database, rule, or item.",
  schema: z.object({
    target: z.discriminatedUnion("scope", [
      z.object({ scope: z.literal("global") }),
      z.object({
        scope: z.literal("database"),
        databaseId: z.string().min(1),
      }),
      z.object({
        scope: z.literal("rule"),
        databaseId: z.string().min(1),
        subscriptionId: z.string().min(1),
      }),
      z.object({
        scope: z.literal("item"),
        databaseId: z.string().min(1),
        documentId: z.string().min(1),
      }),
    ]),
  }),
  http: { method: "GET" },
  run: async ({ target }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    await assertContentNotificationPreferenceTarget(target);
    const databaseId = "databaseId" in target ? target.databaseId : undefined;
    const documentId = "documentId" in target ? target.documentId : undefined;
    const resolvedSubscriptionId =
      target.scope === "rule"
        ? target.subscriptionId
        : databaseId
          ? contentDefaultPersonSubscriptionId(databaseId)
          : undefined;
    return {
      target,
      documentId: documentId ?? null,
      preference: await resolveContentNotificationPreference({
        ownerEmail: ctx.userEmail,
        orgId: ctx.orgId,
        databaseId,
        subscriptionId: resolvedSubscriptionId,
        documentId: documentId ?? "",
      }),
    };
  },
});
