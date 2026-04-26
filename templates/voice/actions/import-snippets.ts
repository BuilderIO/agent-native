/**
 * Bulk import snippets from a JSON array.
 *
 * Usage:
 *   pnpm action import-snippets --snippets='[{"trigger":"@@sig","expansion":"Best regards"}]'
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail, nanoid } from "../server/lib/helpers.js";

export default defineAction({
  description:
    "Bulk import text expansion snippets from a JSON array. Each entry needs a trigger and expansion.",
  schema: z.object({
    snippets: z
      .array(
        z.object({
          trigger: z.string().min(1),
          expansion: z.string().min(1),
          isTeam: z.boolean().optional(),
        }),
      )
      .min(1)
      .describe("Array of snippets to import"),
    organizationId: z
      .string()
      .nullish()
      .describe("Organization ID for team snippets"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const now = new Date().toISOString();

    const values = args.snippets.map((s) => ({
      id: nanoid(),
      organizationId: args.organizationId ?? null,
      trigger: s.trigger.trim(),
      expansion: s.expansion,
      isTeam: s.isTeam ?? false,
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    }));

    await db.insert(schema.dictationSnippets).values(values);

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Imported ${values.length} snippets`);

    return { imported: values.length, ids: values.map((v) => v.id) };
  },
});
