import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  CHAPTERS_CHANGED,
  parseStoredChapters,
  sameChapters,
} from "../shared/stored-chapters.js";

const ChapterSchema = z.object({
  startMs: z.coerce.number().int().min(0),
  title: z.string().min(1),
});

// Compared with the stored list, not written, so it takes anything the
// player can show — a fractional time or an empty title included.
const StoredChapterSchema = z.object({
  startMs: z.number(),
  title: z.string(),
});

type Chapter = { startMs: number; title: string };

function parseChapterList(
  value: unknown,
  label: string,
  itemSchema: z.ZodType<Chapter>,
): Chapter[] {
  if (typeof value !== "string") return value as Chapter[];
  try {
    return z.array(itemSchema).parse(JSON.parse(value));
  } catch (e: any) {
    fail(`Invalid --${label} JSON: ${e.message ?? e}`, {
      errorCode: "invalid_chapters",
      statusCode: 400,
    });
  }
}

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
    expectedChapters: z
      .union([z.string(), z.array(StoredChapterSchema)])
      .optional()
      .describe(
        "Optional. The chapters this edit started from; if the stored chapters differ, nothing is written and the call fails with errorCode chapters_changed.",
      ),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();

    const expected =
      args.expectedChapters === undefined
        ? null
        : parseChapterList(
            args.expectedChapters,
            "expectedChapters",
            StoredChapterSchema,
          );
    const chapters = [
      ...parseChapterList(args.chapters, "chapters", ChapterSchema),
    ]
      .map((c) => ({ startMs: Math.max(0, c.startMs), title: c.title.trim() }))
      .filter((c) => c.title.length > 0)
      .sort((a, b) => a.startMs - b.startMs);

    const [existing] = await db
      .select({
        id: schema.recordings.id,
        chaptersJson: schema.recordings.chaptersJson,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId));
    if (!existing) {
      throw new Error(`Recording not found: ${args.recordingId}`);
    }
    // The current list goes back with the refusal, so the editor can check
    // against it without reloading the page's data. A list that already
    // holds what was asked for is no conflict.
    const checkAgainst = (stored: Chapter[]): "write" | "done" => {
      if (sameChapters(stored, chapters)) return "done";
      if (expected && !sameChapters(stored, expected)) {
        fail(
          "The chapters changed since this edit started. Read them again before saving.",
          {
            errorCode: CHAPTERS_CHANGED,
            statusCode: 409,
            details: { chapters: stored },
          },
        );
      }
      return "write";
    };
    if (
      expected &&
      checkAgainst(parseStoredChapters(existing.chaptersJson)) === "done"
    ) {
      return { id: args.recordingId, chapters };
    }

    const written = await db
      .update(schema.recordings)
      .set({
        chaptersJson: JSON.stringify(chapters),
        updatedAt: new Date().toISOString(),
      })
      .where(
        expected
          ? and(
              eq(schema.recordings.id, args.recordingId),
              eq(schema.recordings.chaptersJson, existing.chaptersJson),
            )
          : eq(schema.recordings.id, args.recordingId),
      )
      .returning({ id: schema.recordings.id });
    // A write that landed between the read and this update.
    if (expected && written.length === 0) {
      const [latest] = await db
        .select({ chaptersJson: schema.recordings.chaptersJson })
        .from(schema.recordings)
        .where(eq(schema.recordings.id, args.recordingId));
      if (!latest) {
        fail(`Recording not found: ${args.recordingId}`, {
          errorCode: "recording_not_found",
          statusCode: 404,
        });
      }
      // Anything else was refused above, so this list matches the request.
      checkAgainst(parseStoredChapters(latest.chaptersJson));
      return { id: args.recordingId, chapters };
    }

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Set ${chapters.length} chapter(s) on ${args.recordingId}`);
    return { id: args.recordingId, chapters };
  },
});
