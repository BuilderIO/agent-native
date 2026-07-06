/**
 * Overwrite the chapters on a recording.
 *
 * Chapters are stored as a JSON array of `{ startMs, title }` in
 * `recordings.chaptersJson`. The editor sidebar calls this on every change
 * (add / rename / reorder / delete).
 *
 * Usage:
 *   pnpm action set-chapters --recordingId=<id> --chapters='[{"startMs":0,"title":"Intro"}]'
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

const ChapterSchema = z.object({
  startMs: z.coerce.number().int().min(0),
  title: z.string().min(1),
});

const MAX_CAS_ATTEMPTS = 5;

export default defineAction({
  description:
    "Overwrite the chapters on a recording. Chapters are {startMs,title} entries that appear as markers on the timeline and in the player.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    chapters: z
      .union([z.string(), z.array(ChapterSchema)])
      .describe(
        "Array of {startMs,title} — either a JSON-encoded string (CLI) or an array (agent).",
      ),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();

    let chapters: Array<{ startMs: number; title: string }> = [];
    if (typeof args.chapters === "string") {
      try {
        const parsed = JSON.parse(args.chapters);
        chapters = z.array(ChapterSchema).parse(parsed);
      } catch (e: any) {
        throw new Error(`Invalid --chapters JSON: ${e.message ?? e}`);
      }
    } else {
      chapters = args.chapters as any;
    }

    // Sort and dedupe by startMs
    chapters = [...chapters]
      .map((c) => ({ startMs: Math.max(0, c.startMs), title: c.title.trim() }))
      .filter((c) => c.title.length > 0)
      .sort((a, b) => a.startMs - b.startMs);

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const [existing] = await db
        .select()
        .from(schema.recordings)
        .where(eq(schema.recordings.id, args.recordingId));
      if (!existing) {
        throw new Error(`Recording not found: ${args.recordingId}`);
      }

      const previousChaptersJson = existing.chaptersJson;

      const result = await db
        .update(schema.recordings)
        .set({
          chaptersJson: JSON.stringify(chapters),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.recordings.id, args.recordingId),
            previousChaptersJson == null
              ? isNull(schema.recordings.chaptersJson)
              : eq(schema.recordings.chaptersJson, previousChaptersJson),
          ),
        )
        .returning({ id: schema.recordings.id });

      if (result.length > 0) {
        await writeAppState("refresh-signal", { ts: Date.now() });
        console.log(`Set ${chapters.length} chapter(s) on ${args.recordingId}`);
        return { id: args.recordingId, chapters };
      }
      // Someone else changed chaptersJson between our read and write — retry
      // against the now-current value.
    }

    throw new Error(
      `Could not set chapters on recording ${args.recordingId} after ${MAX_CAS_ATTEMPTS} concurrent attempts.`,
    );
  },
});
