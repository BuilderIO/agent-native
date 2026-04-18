/**
 * Update a tracker definition.
 *
 * Usage:
 *   pnpm action update-tracker --id=<id> --name="..." --keywords='[...]' --enabled=true
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";

const KeywordArray = z.array(z.string().min(1));

export default defineAction({
  description:
    "Update tracker fields. Any subset of name/description/keywords/classifierPrompt/color/enabled may be provided.",
  schema: z.object({
    id: z.string().describe("Tracker ID"),
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(500).optional(),
    keywords: z.union([z.string(), KeywordArray]).optional(),
    classifierPrompt: z.string().optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    enabled: z.coerce.boolean().optional(),
  }),
  run: async (args) => {
    const db = getDb();

    const [existing] = await db
      .select()
      .from(schema.trackerDefinitions)
      .where(eq(schema.trackerDefinitions.id, args.id))
      .limit(1);
    if (!existing) throw new Error(`Tracker not found: ${args.id}`);

    const patch: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.description !== undefined)
      patch.description = args.description.trim();
    if (args.color !== undefined) patch.color = args.color;
    if (args.enabled !== undefined) patch.enabled = args.enabled;
    if (args.classifierPrompt !== undefined) {
      patch.classifierPrompt =
        args.classifierPrompt.trim().length > 0
          ? args.classifierPrompt.trim()
          : null;
    }
    if (args.keywords !== undefined) {
      let keywords: string[];
      if (typeof args.keywords === "string") {
        let raw: unknown;
        try {
          raw = JSON.parse(args.keywords);
        } catch {
          raw = args.keywords
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        }
        keywords = KeywordArray.parse(raw);
      } else {
        keywords = KeywordArray.parse(args.keywords);
      }
      keywords = keywords.map((k) => k.trim()).filter((k) => k.length > 0);
      patch.keywordsJson = JSON.stringify(keywords);
    }

    await db
      .update(schema.trackerDefinitions)
      .set(patch)
      .where(eq(schema.trackerDefinitions.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Updated tracker ${args.id}`);
    return { id: args.id, updated: Object.keys(patch) };
  },
});
