/**
 * Repair the playback of already-stored recordings.
 *
 * Clips uploaded via the streaming path (or before the seekable rewrite
 * existed) can ship raw MediaRecorder output: an MP4 with a trailing `moov`
 * atom or a WebM with no Cues index. Those load slowly and re-buffer on every
 * seek even though the file downloads fine. This action re-fetches the stored
 * media, rewrites it to be start-playable and seekable (MP4 faststart / WebM
 * Cues remux), re-uploads the fixed file, and repoints the recording at it.
 *
 * It's idempotent and non-destructive: clips that are already seekable are
 * skipped, and any clip we can't improve or re-upload is left untouched.
 *
 * Usage:
 *   pnpm action reprocess-recording --id=<recordingId>
 *   pnpm action reprocess-recording --ids='["id1","id2"]'
 *   pnpm action reprocess-recording --all --limit=20
 *   pnpm action reprocess-recording --id=<recordingId> --force
 */

import { defineAction } from "@agent-native/core";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";
import {
  ensureRecordingSeekable,
  type EnsureSeekableResult,
} from "./lib/ensure-seekable-video.js";

const MAX_TARGETS_PER_CALL = 100;
const DEFAULT_ALL_LIMIT = 20;

function parseIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && !!v);
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string" && !!v);
      }
    } catch {
      // Fall back to a single comma-separated / plain id string.
      return value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

export default defineAction({
  description:
    "Repair slow-loading or buffering recordings by rewriting their stored video to be start-playable and seekable (MP4 faststart / WebM Cues remux) and re-uploading it. Use for clips that take a long time to load or re-buffer when scrubbing. Pass `id` for one clip, `ids` for several, or `all: true` to sweep the caller's ready clips (bounded by `limit`). Already-seekable clips are skipped unless `force` is true.",
  schema: z.object({
    id: z.string().optional().describe("A single recording id to repair."),
    ids: z
      .union([z.array(z.string()), z.string()])
      .optional()
      .describe(
        "Multiple recording ids (array, or JSON/comma string for CLI).",
      ),
    all: z.coerce
      .boolean()
      .optional()
      .describe(
        "Repair the caller's own ready clips, most recent first, up to `limit`.",
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
    force: z.coerce
      .boolean()
      .optional()
      .describe("Re-run even on clips already marked seekable."),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const force = Boolean(args.force);

    let targetIds: string[] = [];
    if (args.id) targetIds.push(args.id);
    targetIds.push(...parseIds(args.ids));

    if (args.all) {
      const limit = args.limit ?? DEFAULT_ALL_LIMIT;
      const rows = await db
        .select({ id: schema.recordings.id })
        .from(schema.recordings)
        .where(
          and(
            ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
            eq(schema.recordings.status, "ready"),
            isNotNull(schema.recordings.videoUrl),
          ),
        )
        .orderBy(desc(schema.recordings.createdAt))
        .limit(limit);
      targetIds.push(...rows.map((r) => r.id));
    }

    // De-dupe while preserving order, and bound the batch so a single call
    // can't run unboundedly under the hosted foreground budget.
    targetIds = Array.from(new Set(targetIds)).slice(0, MAX_TARGETS_PER_CALL);

    if (targetIds.length === 0) {
      return {
        ok: true,
        processed: 0,
        changed: 0,
        results: [] as EnsureSeekableResult[],
        message:
          "No recordings to reprocess. Pass id / ids, or all: true to sweep your clips.",
      };
    }

    const results: EnsureSeekableResult[] = [];
    for (const recordingId of targetIds) {
      try {
        results.push(
          await ensureRecordingSeekable({ recordingId, ownerEmail, force }),
        );
      } catch (err) {
        console.warn("[reprocess-recording] failed for", recordingId, err);
        results.push({
          recordingId,
          status: "skipped-fetch-failed",
          changed: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const changed = results.filter((r) => r.changed).length;
    console.log(
      `Reprocessed ${results.length} recording(s); ${changed} rewritten for smoother playback.`,
    );

    return {
      ok: true,
      processed: results.length,
      changed,
      results,
    };
  },
});
