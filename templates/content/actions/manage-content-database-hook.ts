import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  contentHookEffectSchema,
  contentHookEffectsSchema,
  contentHookConditionsSchema,
  contentHookTimingSchema,
  contentHookTriggerSchema,
  deleteContentDatabaseHook,
  getContentDatabaseHook,
  requireContentDatabaseOwner,
  saveContentDatabaseHook,
} from "./_content-database-hooks.js";

const schema = z
  .object({
    action: z.enum(["create", "update", "delete"]),
    databaseId: z.string().min(1),
    hookId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
    trigger: contentHookTriggerSchema.optional(),
    conditions: contentHookConditionsSchema.nullable().optional(),
    effect: contentHookEffectSchema.optional(),
    effects: contentHookEffectsSchema.optional(),
    timing: contentHookTimingSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.effect && value.effects) {
      ctx.addIssue({
        code: "custom",
        message: "Provide effect or effects, not both.",
      });
    }
    if (value.action === "create") {
      if (!value.name) {
        ctx.addIssue({ code: "custom", path: ["name"], message: "Required" });
      }
      if (!value.trigger) {
        ctx.addIssue({
          code: "custom",
          path: ["trigger"],
          message: "Required",
        });
      }
      if (!value.effect && !value.effects) {
        ctx.addIssue({
          code: "custom",
          path: ["effects"],
          message: "At least one effect is required.",
        });
      }
    } else if (!value.hookId) {
      ctx.addIssue({ code: "custom", path: ["hookId"], message: "Required" });
    }
  });

export default defineAction({
  description:
    "Create, update, or delete an owner-managed deterministic Content database Rule. Use Automations instead when an agent must exercise judgment.",
  schema,
  run: async (args) => {
    if (args.action === "delete") {
      await deleteContentDatabaseHook(args.databaseId, args.hookId!);
      return { databaseId: args.databaseId, deletedHookId: args.hookId };
    }
    if (args.action === "update") {
      await requireContentDatabaseOwner(args.databaseId);
    }
    const existing =
      args.action === "update"
        ? await getContentDatabaseHook(args.databaseId, args.hookId!)
        : undefined;
    if (args.action === "update" && !existing) {
      throw new Error(`Rule "${args.hookId}" not found.`);
    }
    const hook = await saveContentDatabaseHook({
      id: args.action === "update" ? args.hookId! : undefined,
      databaseId: args.databaseId,
      name: args.name ?? existing!.name,
      enabled: args.enabled ?? existing?.enabled ?? true,
      trigger: args.trigger ?? existing!.trigger,
      conditions:
        "conditions" in args && args.conditions !== undefined
          ? (args.conditions ?? undefined)
          : existing?.conditions,
      effects:
        "effects" in args && args.effects
          ? args.effects
          : "effect" in args && args.effect
            ? [args.effect]
            : existing!.effects,
      timing: args.timing ?? existing?.timing ?? { kind: "immediate" },
      createdBy: existing?.createdBy,
    });
    return { databaseId: args.databaseId, hook };
  },
});
