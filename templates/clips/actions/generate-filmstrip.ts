/**
 * Generate editor-timeline filmstrip sprites for stored recordings.
 *
 * The editor shows video frames behind the waveform so a trim range can be
 * found visually. Generating them server-side with one ffmpeg pass replaces
 * per-frame decoding in the browser, which cannot read cross-origin media at
 * all and needs one seek per frame.
 *
 * Non-destructive and idempotent: a recording whose sprite already matches its
 * current media is skipped, and any failure leaves the row untouched so the
 * editor keeps its browser-side fallback.
 *
 * Usage:
 *   pnpm action generate-filmstrip --id=<recordingId>
 *   pnpm action generate-filmstrip --id=<recordingId> --force
 *   pnpm action generate-filmstrip --all --limit=20
 */

import { defineAction } from "@agent-native/core";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";
import {
  DEFAULT_FILMSTRIP_FRAME_COUNT,
  MAX_FILMSTRIP_FRAME_COUNT,
} from "../server/lib/video-filmstrip-sprite.js";
import {
  ensureRecordingFilmstrip,
  type EnsureFilmstripResult,
} from "./lib/ensure-recording-filmstrip.js";

const MAX_TARGETS_PER_CALL = 50;
const DEFAULT_ALL_LIMIT = 10;
const cliBoolean = z.preprocess((value) => {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return value;
}, z.boolean());

export default defineAction({
  description:
    "Generate the editor timeline filmstrip (a sprite of evenly-spaced video frames) for one or more of the caller's recordings, so the editor can show frames behind the waveform without decoding video in the browser. Pass `id` for one clip, `ids` for several, or `all: true` to backfill clips that have no filmstrip yet. Recordings whose sprite already matches their current media are skipped unless `force` is true. Requires ffmpeg on the server; without it this reports `skipped-no-ffmpeg` and the editor falls back to browser-side extraction.",
  schema: z.object({
    id: z
      .string()
      .optional()
      .describe("A single recording id to generate a filmstrip for."),
    ids: z
      .array(z.string())
      .optional()
      .describe("Several recording ids to process in one call."),
    all: cliBoolean
      .optional()
      .describe(
        "Backfill the caller's ready clips that have no filmstrip yet, most recent first, up to `limit`.",
      ),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_TARGETS_PER_CALL)
      .optional()
      .describe(
        `Max clips to process when using \`all\` (default ${DEFAULT_ALL_LIMIT}).`,
      ),
    frameCount: z.coerce
      .number()
      .int()
      .min(4)
      .max(MAX_FILMSTRIP_FRAME_COUNT)
      .optional()
      .describe(
        `How many frames to sample across the clip (default ${DEFAULT_FILMSTRIP_FRAME_COUNT}). More frames means finer scrubbing detail and a larger sprite.`,
      ),
    force: cliBoolean
      .optional()
      .describe("Regenerate even when a current filmstrip already exists."),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    let targetIds: string[] = [];
    if (args.id) targetIds.push(args.id);
    if (args.ids?.length) targetIds.push(...args.ids.filter(Boolean));

    if (args.all) {
      const conditions = [
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        eq(schema.recordings.status, "ready"),
        isNotNull(schema.recordings.videoUrl),
      ];
      if (!args.force) {
        conditions.push(isNull(schema.recordings.filmstripUrl));
      }
      const rows = await db
        .select({ id: schema.recordings.id })
        .from(schema.recordings)
        .where(and(...conditions))
        .orderBy(desc(schema.recordings.createdAt))
        .limit(args.limit ?? DEFAULT_ALL_LIMIT);
      targetIds.push(...rows.map((r) => r.id));
    }

    // De-dupe while preserving order, and bound the batch so one call can't run
    // unboundedly under the hosted foreground budget.
    targetIds = Array.from(new Set(targetIds)).slice(0, MAX_TARGETS_PER_CALL);

    if (targetIds.length === 0) {
      return {
        ok: true,
        processed: 0,
        changed: 0,
        results: [] as EnsureFilmstripResult[],
        message:
          "No recordings to process. Pass id / ids, or all: true to backfill clips without a filmstrip.",
      };
    }

    const results: EnsureFilmstripResult[] = [];
    for (const recordingId of targetIds) {
      try {
        results.push(
          await ensureRecordingFilmstrip({
            recordingId,
            ownerEmail,
            frameCount: args.frameCount,
            force: Boolean(args.force),
          }),
        );
      } catch (err) {
        console.warn("[generate-filmstrip] failed for", recordingId, err);
        results.push({
          recordingId,
          status: "failed-ffmpeg",
          changed: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const changed = results.filter((r) => r.changed).length;
    console.log(
      `Processed ${results.length} recording(s); ${changed} filmstrip(s) generated.`,
    );

    return { ok: true, processed: results.length, changed, results };
  },
});
