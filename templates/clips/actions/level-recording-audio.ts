import { defineAction, fail } from "@agent-native/core/action";
import { and, desc, eq, isNotNull, lt, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  AUDIO_LEVEL_QUIET_THRESHOLD_LUFS,
  AUDIO_LEVEL_TARGET_LUFS,
  ensureRecordingAudioLevel,
  isRetryableAudioLevelStatus,
  type AudioLevelResult,
} from "../server/lib/audio-level.js";
import { listAudioLevelRepairIds } from "../server/lib/audio-level-repair-state.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";

const MAX_TARGETS_PER_CALL = 50;

const AUDIO_LEVEL_STATUSES = [
  "boosted",
  "already-normal",
  "silent",
  "skipped-not-ready",
  "skipped-no-audio",
  "skipped-no-media",
  "skipped-local-media",
  "skipped-no-ffmpeg",
  "skipped-too-large",
  "skipped-fetch-failed",
  "skipped-measure-failed",
  "skipped-boost-failed",
  "skipped-multiple-audio",
  "skipped-upload-failed",
  "not-found",
] as const satisfies readonly AudioLevelResult["status"][];

const resultSchema = z.object({
  recordingId: z.string(),
  status: z.enum(AUDIO_LEVEL_STATUSES),
  changed: z.boolean(),
  integratedLufs: z.number().nullable().optional(),
  gainDb: z.number().optional(),
  detail: z.string().optional(),
});

const outputSchema = z.object({
  ok: z.literal(true),
  processed: z.number().int(),
  changed: z.number().int(),
  results: z.array(resultSchema),
  message: z.string().optional(),
  nextBefore: z.string().optional(),
  unprocessedIds: z.array(z.string()).optional(),
  /** True when the sweep has more clips; call again (with nextBefore if set). */
  moreRemaining: z.boolean().optional(),
  /** Clips that failed in a retryable way; pass them as `ids` to try again. */
  retryIds: z.array(z.string()).optional(),
});
const DEFAULT_ALL_LIMIT = 20;
const cliBoolean = z.preprocess((value) => {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return value;
}, z.boolean());

const MAX_IDS_INPUT_CHARS = 8_000;
/**
 * Stop starting new clips after this long, so the call returns its results
 * and a cursor well before a request timeout. One clip may still run past it.
 */
export const LEVEL_CALL_BUDGET_MS = 4 * 60 * 1000;
const CURSOR_SEPARATOR = "|";

function itemAt<T>(items: readonly T[], index: number): T | undefined {
  return index >= 0 && index < items.length ? items[index] : undefined;
}

/** `nextBefore` is `<createdAt>|<id>`, so clips with the same time are not skipped. */
export function encodeSweepCursor(createdAt: string, id: string): string {
  return `${createdAt}${CURSOR_SEPARATOR}${id}`;
}

/**
 * A cursor is a timestamp, optionally followed by `|<recording id>`. The date
 * and time parts are checked strictly, so an impossible day such as 30
 * February is refused instead of rolled over. Both `T` and the space that SQL
 * defaults write are accepted, since the cursor echoes the stored value.
 */
export function isValidSweepCursor(value: string): boolean {
  const at = value.lastIndexOf(CURSOR_SEPARATOR);
  const createdAt = at < 0 ? value : value.slice(0, at);
  const id = at < 0 ? null : value.slice(at + 1);
  if (id !== null && id.trim() === "") return false;
  // Offsets are limited to real ones (-23:59..+23:59); `Z` or none is the norm.
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?$/.exec(
      createdAt,
    );
  if (!match) return false;
  const parts = match.map(Number);
  const y = itemAt(parts, 1);
  const mo = itemAt(parts, 2);
  const d = itemAt(parts, 3);
  const h = itemAt(parts, 4);
  const mi = itemAt(parts, 5);
  const se = itemAt(parts, 6);
  if (
    y === undefined ||
    mo === undefined ||
    d === undefined ||
    h === undefined ||
    mi === undefined ||
    se === undefined
  ) {
    return false;
  }
  // setUTCFullYear, not Date.UTC: Date.UTC maps years 0-99 to 1900-1999.
  const day = new Date(0);
  day.setUTCFullYear(y, mo - 1, d);
  return (
    day.getUTCFullYear() === y &&
    day.getUTCMonth() === mo - 1 &&
    day.getUTCDate() === d &&
    h < 24 &&
    mi < 60 &&
    se < 60
  );
}

export function decodeSweepCursor(value: string): {
  createdAt: string;
  id: string | null;
} {
  const at = value.lastIndexOf(CURSOR_SEPARATOR);
  if (at < 0) return { createdAt: value, id: null };
  return { createdAt: value.slice(0, at), id: value.slice(at + 1) || null };
}

function parseIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && !!v);
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string" && !!v);
      }
    } catch {
      return value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

export default defineAction({
  description: `Raise the audio of quiet recordings to a normal speech level. Clips quieter than ${AUDIO_LEVEL_QUIET_THRESHOLD_LUFS} LUFS get a fixed boost toward ${AUDIO_LEVEL_TARGET_LUFS} LUFS with a peak limiter; the video is copied, and clips that already sound normal are left untouched. New uploads are leveled automatically; use this for older clips. Pass \`id\` for one clip, \`ids\` for up to 50, or \`all: true\` for a bounded sweep of the caller's own clips, newest first; pass the returned \`nextBefore\` as \`before\` to continue. Clips already checked are skipped unless \`force\` is true.`,
  schema: z.object({
    id: z.string().optional().describe("A single recording id to level."),
    ids: z
      .union([
        z.array(z.string().max(200)).max(MAX_TARGETS_PER_CALL),
        z.string().max(MAX_IDS_INPUT_CHARS),
      ])
      .optional()
      .describe(
        "Multiple recording ids (array, or JSON/comma string for CLI).",
      ),
    all: cliBoolean
      .optional()
      .describe(
        "Level the caller's own ready clips, most recent first, up to `limit`.",
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
    before: z
      .string()
      .max(300)
      .refine(isValidSweepCursor, "Invalid sweep cursor")
      .optional()
      .describe(
        "With `all`, continue after this point. Pass the previous call's `nextBefore` unchanged.",
      ),
    force: cliBoolean
      .optional()
      .describe("Measure again even on clips already checked."),
  }),
  outputSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const force = Boolean(args.force);

    const explicitIds = Array.from(
      new Set([...(args.id ? [args.id] : []), ...parseIds(args.ids)]),
    );
    if (explicitIds.length > MAX_TARGETS_PER_CALL) {
      fail(
        `Pass at most ${MAX_TARGETS_PER_CALL} recording ids per call; ${explicitIds.length} were given. Split them into smaller batches.`,
        { errorCode: "too_many_recordings", statusCode: 400 },
      );
    }

    const targetIds = [...explicitIds];
    if (args.all) {
      // Clips whose leveling job could not be queued come first, so a failed
      // dispatch is retried by the next sweep.
      const repairIds = await listAudioLevelRepairIds().catch(
        (err: unknown) => {
          console.warn("[level-recording-audio] could not list repairs", err);
          return [] as string[];
        },
      );
      for (const id of repairIds) {
        if (targetIds.length >= MAX_TARGETS_PER_CALL) break;
        if (!targetIds.includes(id)) targetIds.push(id);
      }
    }
    let nextBefore: string | undefined;
    let sweepRows: { id: string; createdAt: string }[] = [];
    let sweepFilledBatch = false;
    let sweepLimit = 0;
    if (args.all) {
      const cursor = args.before ? decodeSweepCursor(args.before) : null;
      const limit = Math.min(
        args.limit ?? DEFAULT_ALL_LIMIT,
        MAX_TARGETS_PER_CALL - targetIds.length,
      );
      sweepLimit = limit;
      const rows =
        limit > 0
          ? await db
              .select({
                id: schema.recordings.id,
                createdAt: schema.recordings.createdAt,
              })
              .from(schema.recordings)
              .where(
                and(
                  ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
                  eq(schema.recordings.status, "ready"),
                  eq(schema.recordings.hasAudio, true),
                  isNotNull(schema.recordings.videoUrl),
                  ...(cursor
                    ? [
                        cursor.id
                          ? or(
                              lt(schema.recordings.createdAt, cursor.createdAt),
                              and(
                                eq(
                                  schema.recordings.createdAt,
                                  cursor.createdAt,
                                ),
                                lt(schema.recordings.id, cursor.id),
                              ),
                            )
                          : lt(schema.recordings.createdAt, cursor.createdAt),
                      ]
                    : []),
                ),
              )
              .orderBy(
                desc(schema.recordings.createdAt),
                desc(schema.recordings.id),
              )
              .limit(limit)
          : [];
      sweepRows = rows;
      sweepFilledBatch = limit > 0 && rows.length === limit;
      for (const row of rows) {
        if (!targetIds.includes(row.id)) targetIds.push(row.id);
      }
    }

    if (targetIds.length === 0) {
      return {
        ok: true as const,
        processed: 0,
        changed: 0,
        results: [] as AudioLevelResult[],
        message:
          "No recordings to level. Pass id / ids, or all: true to sweep your clips.",
      };
    }

    const results: AudioLevelResult[] = [];
    const deadline = Date.now() + LEVEL_CALL_BUDGET_MS;
    let stoppedAt = targetIds.length;
    for (const [index, recordingId] of targetIds.entries()) {
      if (index > 0 && Date.now() > deadline) {
        stoppedAt = index;
        break;
      }
      try {
        results.push(
          await ensureRecordingAudioLevel({ recordingId, ownerEmail, force }),
        );
      } catch (err) {
        console.warn("[level-recording-audio] failed for", recordingId, err);
        results.push({
          recordingId,
          status: "skipped-measure-failed",
          changed: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const unprocessedIds = targetIds.slice(stoppedAt);

    // Continue the sweep after the last swept clip this call reached: the
    // whole batch when it finished, or fewer when the time budget ran out.
    // Only the unbroken run of processed rows from the top counts: an explicit
    // id that also sits further down the sweep must not move the cursor past
    // clips that were never reached.
    let reachedCount = 0;
    const statusById = new Map(results.map((r) => [r.recordingId, r.status]));
    for (;;) {
      const row = itemAt(sweepRows, reachedCount);
      if (!row || !statusById.has(row.id)) break;
      reachedCount += 1;
    }
    const lastReached = itemAt(sweepRows, reachedCount - 1);
    if (lastReached && (sweepFilledBatch || reachedCount < sweepRows.length)) {
      nextBefore = encodeSweepCursor(lastReached.createdAt, lastReached.id);
    }
    // The cursor moves past clips that failed in a retryable way, so one broken
    // clip cannot block the rest of the sweep. They are listed separately for
    // a retry with `ids`.
    const retryIds = results
      .filter((r) => isRetryableAudioLevelStatus(r.status))
      .map((r) => r.recordingId);
    // 50 explicit ids leave no room for the sweep; it still has to run.
    const sweepPending = Boolean(args.all) && sweepLimit === 0;

    const changed = results.filter((r) => r.changed).length;
    return {
      ok: true as const,
      processed: results.length,
      changed,
      results,
      ...(nextBefore ? { nextBefore } : {}),
      ...(unprocessedIds.length > 0 ? { unprocessedIds } : {}),
      ...(retryIds.length > 0 ? { retryIds } : {}),
      ...(args.all &&
      (sweepPending || sweepFilledBatch || reachedCount < sweepRows.length)
        ? { moreRemaining: true }
        : {}),
    };
  },
});
