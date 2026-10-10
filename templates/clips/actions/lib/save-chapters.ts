import { fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  cutRangesOf,
  parseEdits,
  type CutRange,
} from "../../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../../server/db/index.js";
import {
  CHAPTERS_BUSY,
  CHAPTERS_CHANGED,
  CHAPTERS_UNREADABLE,
  EXPECTED_CHAPTERS_REQUIRED,
  parseStoredChapters,
  readStoredChapters,
  sameChapters,
  sameCuts,
  type StoredChapter,
} from "../../shared/stored-chapters.js";
import { chaptersVersionOf } from "./chapters-version.js";

/** Guarded updates that keep missing give up rather than spin. */
const MAX_ATTEMPTS = 4;

const cutRanges = (editsJson: string) => cutRangesOf(parseEdits(editsJson));

export const ChapterSchema = z.object({
  // .int() also refuses anything past the safe-integer range, which
  // readStoredChapters would read back as unreadable.
  startMs: z.coerce.number().int().min(0),
  title: z.string().min(1),
});

// Compared with the stored list, not written, so it takes anything the
// player can show — a fractional time or an empty title included.
export const StoredChapterSchema = z.object({
  startMs: z.number(),
  title: z.string(),
});

export const CutRangeSchema = z.object({
  startMs: z.number(),
  endMs: z.number(),
});

/** A list passed as an array (agent) or a JSON-encoded string (CLI). */
export function parseList<T>(
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

/**
 * Writes a recording's chapters, only over the stored list it was checked
 * against (and the cuts, when given), so it never replaces chapters changed
 * elsewhere; a refusal carries the current chapters and cuts.
 */
export async function saveChapters(options: {
  recordingId: string;
  chapters: readonly z.infer<typeof ChapterSchema>[];
  expectedChapters: readonly StoredChapter[] | null;
  expectedVersion: string | null;
  expectedCuts: readonly CutRange[] | null;
  /** Replace stored chapters that can't be read, rather than refuse. */
  discardUnreadable?: boolean;
}): Promise<{ id: string; chapters: StoredChapter[] }> {
  const { recordingId, expectedVersion } = options;
  const expected = options.expectedChapters;
  const expectedCuts = options.expectedCuts;
  await assertAccess("recording", recordingId, "editor");
  if (expected === null && expectedVersion === null) {
    fail(
      "Pass expectedChapters (the chapters this edit started from) or expectedVersion, so the save can't replace chapters changed elsewhere.",
      { errorCode: EXPECTED_CHAPTERS_REQUIRED, statusCode: 400 },
    );
  }
  const db = getDb();

  const chapters = options.chapters
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
    .where(eq(schema.recordings.id, recordingId));
  if (!existing) {
    fail(`Recording not found: ${recordingId}`, {
      errorCode: "recording_not_found",
      statusCode: 404,
    });
  }

  // The current list and cuts go back with a refusal, so the editor can
  // check against them without reloading the page's data. A stored list
  // that already holds what was asked for is no conflict.
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
  const done = () => ({ id: recordingId, chapters });

  // A write can land between a check and the update. The update only
  // matches the row as checked; on a miss the row is read and checked
  // again, so an unrelated edit (a thumbnail, say) doesn't refuse the save.
  let row: { chaptersJson: string; editsJson: string } = existing;
  for (let attempt = 1; ; attempt++) {
    const { chapters: stored, unreadable } = readStoredChapters(
      row.chaptersJson,
    );
    if (unreadable && !options.discardUnreadable) {
      fail(
        "The stored chapters include entries that can't be read, and this save would delete them. Nothing was saved. If the user asked to replace them, call again with discardUnreadable.",
        { errorCode: CHAPTERS_UNREADABLE, statusCode: 409 },
      );
    }
    // The unreadable entries still have to go, even when the rest match.
    if (!unreadable && sameChapters(stored, chapters)) return done();
    if (
      (expected && !sameChapters(stored, expected)) ||
      (expectedVersion !== null &&
        chaptersVersionOf(row.chaptersJson) !== expectedVersion) ||
      (expectedCuts && !sameCuts(cutRanges(row.editsJson), expectedCuts))
    ) {
      refuse(row);
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
          eq(schema.recordings.id, recordingId),
          eq(schema.recordings.chaptersJson, row.chaptersJson),
          // Cuts only when the caller guarded them: otherwise the editor's
          // autosaved trims would make the update miss.
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
      .where(eq(schema.recordings.id, recordingId));
    if (!latest) {
      fail(`Recording not found: ${recordingId}`, {
        errorCode: "recording_not_found",
        statusCode: 404,
      });
    }
    row = latest;
  }

  await writeAppState("refresh-signal", { ts: Date.now() });
  console.log(`Set ${chapters.length} chapter(s) on ${recordingId}`);
  return done();
}
