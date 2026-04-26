/**
 * Create a text expansion snippet.
 *
 * Usage:
 *   pnpm action create-snippet --trigger="@@sig" --expansion="Best regards, Steve"
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail, nanoid } from "../server/lib/helpers.js";

export default defineAction({
  description:
    "Create a text expansion snippet. When the user types the trigger text during dictation, it expands to the full expansion text.",
  schema: z.object({
    trigger: z.string().min(1).describe("Trigger text (e.g. '@@sig')"),
    expansion: z
      .string()
      .min(1)
      .describe("Expansion text (e.g. 'Best regards, Steve')"),
    isTeam: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether this snippet is shared with the team"),
    organizationId: z
      .string()
      .nullish()
      .describe("Organization ID for team snippets"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const id = nanoid();
    const now = new Date().toISOString();

    await db.insert(schema.dictationSnippets).values({
      id,
      organizationId: args.organizationId ?? null,
      trigger: args.trigger.trim(),
      expansion: args.expansion,
      isTeam: args.isTeam ?? false,
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Created snippet "${args.trigger}" -> "${args.expansion}"`);

    return { id, trigger: args.trigger, expansion: args.expansion };
  },
});
