import { defineAction } from "@agent-native/core";
import {
  getWorkflowEvent,
  getWorkflowSubscription,
} from "@agent-native/core/workflow";
import { z } from "zod";

import {
  contentHookConfigFromJson,
  requireContentDatabaseAccess,
} from "./_content-database-hooks.js";
import { previewContentDatabaseHook } from "./_content-hook-execution.js";

export default defineAction({
  description:
    "Preview a deterministic Content database Rule against one committed change without running its actions.",
  schema: z.object({
    databaseId: z.string().min(1),
    hookId: z.string().min(1),
    eventId: z.string().min(1),
  }),
  readOnly: true,
  run: async ({ databaseId, hookId, eventId }) => {
    await requireContentDatabaseAccess(databaseId, "viewer");
    const [event, subscription] = await Promise.all([
      getWorkflowEvent(eventId),
      getWorkflowSubscription(hookId),
    ]);
    if (!event) throw new Error("Committed change not found.");
    if (!subscription || subscription.kind !== "deterministic") {
      throw new Error("Content Rule not found.");
    }
    const config = contentHookConfigFromJson(
      JSON.stringify(subscription.config),
    );
    if (!config || "system" in config || config.databaseId !== databaseId) {
      throw new Error("The Rule does not belong to this database.");
    }
    if (event.payload.databaseId !== databaseId) {
      throw new Error("The committed change does not belong to this database.");
    }
    const preview = previewContentDatabaseHook({ event, subscription });
    if (!preview) throw new Error("The Rule cannot be previewed.");
    return { databaseId, hookId, preview };
  },
});
