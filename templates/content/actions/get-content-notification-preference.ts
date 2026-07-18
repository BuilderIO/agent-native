import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { contentDefaultPersonSubscriptionId } from "./_content-database-hooks.js";
import { assertContentNotificationPreferenceTarget } from "./_content-notification-preference-access.js";
import { resolveContentNotificationPreference } from "./_content-notification-preferences.js";

export default defineAction({
  description:
    "Resolve the current user's effective personal notification preference for a Content database, rule, or item.",
  schema: z.object({
    scope: z.enum(["global", "database", "rule", "item"]),
    databaseId: z.string().min(1).optional(),
    subscriptionId: z.string().min(1).optional(),
    documentId: z.string().min(1).optional(),
  }),
  http: { method: "GET" },
  run: async (args, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    if (
      (args.scope === "global" &&
        (args.databaseId || args.subscriptionId || args.documentId)) ||
      (args.scope === "database" && (args.subscriptionId || args.documentId)) ||
      (args.scope === "rule" && args.documentId) ||
      (args.scope === "item" && args.subscriptionId)
    ) {
      throw new Error(`Unexpected identifiers for ${args.scope} scope.`);
    }
    const target = (() => {
      if (args.scope === "global") return { scope: "global" as const };
      if (!args.databaseId) {
        throw new Error(`A database ID is required for ${args.scope} scope.`);
      }
      if (args.scope === "database") {
        return { scope: "database" as const, databaseId: args.databaseId };
      }
      if (args.scope === "rule") {
        if (!args.subscriptionId) {
          throw new Error("A subscription ID is required for rule scope.");
        }
        return {
          scope: "rule" as const,
          databaseId: args.databaseId,
          subscriptionId: args.subscriptionId,
        };
      }
      if (!args.documentId) {
        throw new Error("A document ID is required for item scope.");
      }
      return {
        scope: "item" as const,
        databaseId: args.databaseId,
        documentId: args.documentId,
      };
    })();
    await assertContentNotificationPreferenceTarget(target);
    const databaseId = "databaseId" in target ? target.databaseId : undefined;
    const documentId = "documentId" in target ? target.documentId : undefined;
    const resolvedSubscriptionId =
      target.scope === "rule"
        ? target.subscriptionId
        : databaseId
          ? contentDefaultPersonSubscriptionId(databaseId)
          : undefined;
    const preference = await resolveContentNotificationPreference({
      ownerEmail: ctx.userEmail,
      orgId: ctx.orgId,
      databaseId,
      subscriptionId: resolvedSubscriptionId,
      documentId: documentId ?? "",
    });
    return {
      target,
      documentId: documentId ?? null,
      preference,
    };
  },
});
