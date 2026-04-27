/**
 * Store a new dictation result.
 *
 * Usage:
 *   pnpm action create-dictation --text="Hello world" --rawText="hello world"
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail, nanoid } from "../server/lib/helpers.js";

export default defineAction({
  description:
    "Store a new dictation result. Saves both the polished text and raw transcript, along with metadata like app context, style, language, and duration.",
  schema: z.object({
    id: z
      .string()
      .optional()
      .describe("Pre-generated dictation ID (for optimistic UI)"),
    text: z.string().min(1).describe("Polished/formatted text"),
    rawText: z.string().min(1).describe("Raw transcript from Whisper"),
    audioPath: z.string().nullish().describe("Path to the audio file"),
    appContext: z
      .string()
      .nullish()
      .describe("Context of the app where dictation was used"),
    style: z.string().nullish().describe("Style preset used for formatting"),
    language: z.string().default("en").describe("Language code"),
    durationMs: z.coerce
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Duration of the dictation in milliseconds"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const id = args.id || nanoid();
    const now = new Date().toISOString();

    await db.insert(schema.dictations).values({
      id,
      text: args.text,
      rawText: args.rawText,
      audioPath: args.audioPath ?? null,
      appContext: args.appContext ?? null,
      style: args.style ?? null,
      language: args.language,
      durationMs: args.durationMs,
      ownerEmail,
      createdAt: now,
    });

    // Update daily stats
    const today = new Date().toISOString().slice(0, 10);
    const wordCount = args.text.split(/\s+/).filter(Boolean).length;
    try {
      const [existing] = await db
        .select()
        .from(schema.dictationStats)
        .where(
          and(
            eq(schema.dictationStats.date, today),
            eq(schema.dictationStats.ownerEmail, ownerEmail),
          ),
        );
      if (existing) {
        await db
          .update(schema.dictationStats)
          .set({
            totalWords: existing.totalWords + wordCount,
            sessionsCount: existing.sessionsCount + 1,
          })
          .where(eq(schema.dictationStats.id, existing.id));
      } else {
        await db.insert(schema.dictationStats).values({
          id: nanoid(),
          date: today,
          totalWords: wordCount,
          sessionsCount: 1,
          streak: 1,
          ownerEmail,
          createdAt: now,
        });
      }
    } catch {
      // Stats update is best-effort — don't fail the dictation
    }

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Created dictation ${id} (${wordCount} words)`);

    return { id, text: args.text, rawText: args.rawText, createdAt: now };
  },
});
