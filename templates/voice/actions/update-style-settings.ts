import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail, nanoid } from "../server/lib/helpers.js";

export default defineAction({
  description:
    "Update the style preset and/or custom prompt for a dictation category. Creates the row if it does not exist.",
  schema: z.object({
    category: z
      .enum(["personal_messages", "work_messages", "email", "other"])
      .describe("Communication category"),
    preset: z
      .enum(["formal", "casual", "very_casual", "excited"])
      .optional()
      .describe("Tone preset"),
    customPrompt: z
      .string()
      .nullish()
      .describe("Custom formatting prompt (overrides preset behavior)"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const now = new Date().toISOString();

    const [existing] = await db
      .select()
      .from(schema.dictationStyles)
      .where(
        and(
          eq(schema.dictationStyles.category, args.category),
          eq(schema.dictationStyles.ownerEmail, ownerEmail),
        ),
      );

    if (existing) {
      const updates: Record<string, unknown> = { updatedAt: now };
      if (args.preset !== undefined) updates.preset = args.preset;
      if (args.customPrompt !== undefined)
        updates.customPrompt = args.customPrompt;

      await db
        .update(schema.dictationStyles)
        .set(updates)
        .where(eq(schema.dictationStyles.id, existing.id));

      await writeAppState("refresh-signal", { ts: Date.now() });
      return { id: existing.id, ...updates };
    }

    const id = nanoid();
    await db.insert(schema.dictationStyles).values({
      id,
      category: args.category,
      preset: args.preset ?? "casual",
      customPrompt: args.customPrompt ?? null,
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });
    return { id, category: args.category, preset: args.preset ?? "casual" };
  },
});
