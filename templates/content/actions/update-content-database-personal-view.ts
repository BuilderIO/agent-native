import { defineAction } from "@agent-native/core";
import { mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  assertContentDatabaseViewerAccess,
  normalizeStoredPersonalDatabaseViewState,
  orderedPersonalDatabaseViewState,
  personalDatabaseViewSettingKey,
  personalViewOverridesSchema,
} from "./_content-database-personal-view.js";

export default defineAction({
  description:
    "Update or clear the current user's personal saved filter, sort, and active view overrides for a content database.",
  schema: z
    .object({
      databaseId: z.string().describe("Database ID"),
      overrides: personalViewOverridesSchema.nullable(),
      mutationSource: z.string().min(1).max(200).optional(),
      mutationSequence: z.number().int().nonnegative().optional(),
    })
    .refine(
      ({ mutationSource, mutationSequence }) =>
        (mutationSource == null) === (mutationSequence == null),
      {
        message:
          "mutationSource and mutationSequence must be provided together.",
      },
    ),
  run: async (
    { databaseId, overrides, mutationSource, mutationSequence },
    ctx,
  ) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    await assertContentDatabaseViewerAccess(databaseId);

    const key = personalDatabaseViewSettingKey(databaseId);
    if (mutationSource != null && mutationSequence != null) {
      const stored = await mutateUserSetting(
        ctx.userEmail,
        key,
        (current) =>
          orderedPersonalDatabaseViewState({
            current,
            mutationSource,
            mutationSequence,
            overrides,
          }),
        { requestSource: mutationSource },
      );
      return {
        databaseId,
        overrides: normalizeStoredPersonalDatabaseViewState(stored).overrides,
      };
    }
    await mutateUserSetting(ctx.userEmail, key, (current) => ({
      ...normalizeStoredPersonalDatabaseViewState(current),
      overrides,
    }));

    return { databaseId, overrides };
  },
});
