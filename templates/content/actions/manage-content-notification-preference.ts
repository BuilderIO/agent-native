import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { assertContentNotificationPreferenceTarget } from "./_content-notification-preference-access.js";
import {
  removeContentNotificationPreference,
  setContentNotificationPreference,
} from "./_content-notification-preferences.js";

const targetSchema = z.discriminatedUnion("scope", [
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
]);

export default defineAction({
  description:
    "Set or remove the current user's personal Content notification preference. Item overrides rule, database, then global preferences. This never changes shared team destinations.",
  schema: z
    .object({
      action: z.enum(["set", "remove"]),
      target: targetSchema,
      enabled: z.boolean().optional(),
    })
    .superRefine((value, ctx) => {
      if (value.action === "set" && value.enabled === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["enabled"],
          message: "Required when setting a preference.",
        });
      }
    }),
  run: async (args, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    await assertContentNotificationPreferenceTarget(args.target);
    if (args.action === "remove") {
      await removeContentNotificationPreference({
        ownerEmail: ctx.userEmail,
        orgId: ctx.orgId,
        target: args.target,
      });
      return { target: args.target, preference: null };
    }
    const preference = await setContentNotificationPreference({
      ownerEmail: ctx.userEmail,
      orgId: ctx.orgId,
      target: args.target,
      enabled: args.enabled!,
    });
    return { target: args.target, preference };
  },
});
