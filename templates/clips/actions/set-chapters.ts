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
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";

const ChapterSchema = z.object({
  startMs: z.coerce.number().int().min(0),
  title: z.string().min(1),
});

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
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

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

    const [existing] = await db
      .select()
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, args.recordingId),
          eq(schema.recordings.ownerEmail, ownerEmail),
        ),
      );
    if (!existing) {
      throw new Error(`Recording not found: ${args.recordingId}`);
    }

    await db
      .update(schema.recordings)
      .set({
        chaptersJson: JSON.stringify(chapters),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.recordings.id, args.recordingId));

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Set ${chapters.length} chapter(s) on ${args.recordingId}`);

    return { id: args.recordingId, chapters };
  },
});
