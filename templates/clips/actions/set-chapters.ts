import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  cutRangesOf,
  parseEdits,
  type CutRange,
} from "../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../server/db/index.js";
import {
  CHAPTERS_BUSY,
  CHAPTERS_CHANGED,
  CHAPTERS_UNREADABLE,
  parseStoredChapters,
  readStoredChapters,
  sameChapters,
  sameCuts,
} from "../shared/stored-chapters.js";
import { chaptersVersionOf } from "./lib/chapters-version.js";

/** Guarded updates that keep missing give up rather than spin. */
const MAX_ATTEMPTS = 4;

const cutRanges = (editsJson: string) => cutRangesOf(parseEdits(editsJson));

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

const CutRangeSchema = z.object({ startMs: z.number(), endMs: z.number() });

/** A list passed as an array (agent) or a JSON-encoded string (CLI). */
function parseList<T>(
  value: unknown,
  label: string,
  itemSchema: z.ZodType<T>,
  errorCode: string,
): T[] {
  if (typeof value !== "string") return value as T[];
  try {
    return z.array(itemSchema).parse(JSON.parse(value));
  } catch (e: any) {
    fail(`Invalid --${label} JSON: ${e.message ?? e}`, {
      errorCode,
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
    expectedVersion: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional. The chapters' version token this edit started from (regenerate-chapters gives one); if the stored chapters' version differs, nothing is written and the call fails with errorCode chapters_changed.",
      ),
    expectedCuts: z
      .union([z.string(), z.array(CutRangeSchema)])
      .optional()
      .describe(
        "Optional. The cut ranges ({startMs,endMs}, original-media ms) the chapter times were mapped through; if the recording's cuts differ, nothing is written and the call fails with errorCode chapters_changed.",
      ),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();

    const expected =
      args.expectedChapters === undefined
        ? null
        : parseList(
            args.expectedChapters,
            "expectedChapters",
            StoredChapterSchema,
            "invalid_chapters",
          );
    const expectedCuts: CutRange[] | null =
      args.expectedCuts === undefined
        ? null
        : parseList(
            args.expectedCuts,
            "expectedCuts",
            CutRangeSchema,
            "invalid_cuts",
          );
    const chapters = [
      ...parseList(
        args.chapters,
        "chapters",
        ChapterSchema,
        "invalid_chapters",
      ),
    ]
      .map((c) => ({ startMs: Math.max(0, c.startMs), title: c.title.trim() }))
      .sort((a, b) => a.startMs - b.startMs);
    if (chapters.some((c) => c.title.length === 0)) {
      fail("Every chapter needs a title.", {
        errorCode: "invalid_chapters",
        statusCode: 400,
      });
    }

    const [existing] = await db
      .select({
        id: schema.recordings.id,
        chaptersJson: schema.recordings.chaptersJson,
        editsJson: schema.recordings.editsJson,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId));
    if (!existing) {
      throw new Error(`Recording not found: ${args.recordingId}`);
    }

    // The current list and cuts go back with a refusal, so the editor can
    // check against them without reloading the page's data. A stored list
    // that already holds what was asked for is no conflict.
    const expectedVersion = args.expectedVersion ?? null;
    const guardChapters = expected !== null || expectedVersion !== null;
    const guarded = guardChapters || expectedCuts !== null;
    const refuse = (row: { chaptersJson: string; editsJson: string }) =>
      fail(
        "The chapters or cuts changed since this edit started. Read them again before saving.",
        {
          errorCode: CHAPTERS_CHANGED,
          statusCode: 409,
          details: {
            chapters: parseStoredChapters(row.chaptersJson),
            cuts: cutRanges(row.editsJson),
          },
        },
      );
    const done = () => ({ id: args.recordingId, chapters });

    // A write can land between a check and the update. The update only
    // matches the row as checked; on a miss the row is read and checked
    // again, so an unrelated edit (a thumbnail, say) doesn't refuse the save.
    let row: { chaptersJson: string; editsJson: string } = existing;
    for (let attempt = 1; ; attempt++) {
      if (guarded) {
        const { chapters: stored, unreadable } = readStoredChapters(
          row.chaptersJson,
        );
        if (unreadable) {
          fail(
            "The stored chapters include entries that can't be read, and this save would delete them. Nothing was saved.",
            { errorCode: CHAPTERS_UNREADABLE, statusCode: 409 },
          );
        }
        if (sameChapters(stored, chapters)) return done();
        if (
          (expected && !sameChapters(stored, expected)) ||
          (expectedVersion !== null &&
            chaptersVersionOf(row.chaptersJson) !== expectedVersion) ||
          (expectedCuts && !sameCuts(cutRanges(row.editsJson), expectedCuts))
        ) {
          refuse(row);
        }
      }
      if (attempt > MAX_ATTEMPTS) {
        fail("The recording kept changing during the save. Try again.", {
          errorCode: CHAPTERS_BUSY,
          statusCode: 409,
        });
      }
      const written = await db
        .update(schema.recordings)
        .set({
          chaptersJson: JSON.stringify(chapters),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.recordings.id, args.recordingId),
            // Only what the caller guarded: an unguarded field changing
            // (the editor's autosaved trims, say) mustn't miss the update.
            guardChapters
              ? eq(schema.recordings.chaptersJson, row.chaptersJson)
              : undefined,
            expectedCuts
              ? eq(schema.recordings.editsJson, row.editsJson)
              : undefined,
          ),
        )
        .returning({ id: schema.recordings.id });
      if (written.length > 0) break;

      const [latest] = await db
        .select({
          chaptersJson: schema.recordings.chaptersJson,
          editsJson: schema.recordings.editsJson,
        })
        .from(schema.recordings)
        .where(eq(schema.recordings.id, args.recordingId));
      if (!latest) {
        fail(`Recording not found: ${args.recordingId}`, {
          errorCode: "recording_not_found",
          statusCode: 404,
        });
      }
      row = latest;
    }

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Set ${chapters.length} chapter(s) on ${args.recordingId}`);
    return done();
  },
});
