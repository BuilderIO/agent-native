import { defineAction, fail } from "@agent-native/core/action";
import { and, desc, eq, isNotNull, lt, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  AUDIO_LEVEL_QUIET_THRESHOLD_LUFS,
  AUDIO_LEVEL_TARGET_LUFS,
  ensureRecordingAudioLevel,
  type AudioLevelResult,
} from "../server/lib/audio-level.js";
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
});
const DEFAULT_ALL_LIMIT = 20;
const cliBoolean = z.preprocess((value) => {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return value;
}, z.boolean());

const MAX_IDS_INPUT_CHARS = 8_000;
const CURSOR_SEPARATOR = "|";

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
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(
      createdAt,
    );
  if (!match) return false;
  const [, y, mo, d, h, mi, se] = match.map(Number);
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
  const day = new Date(Date.UTC(y, mo - 1, d));
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
    let nextBefore: string | undefined;
    if (args.all) {
      const cursor = args.before ? decodeSweepCursor(args.before) : null;
      const limit = Math.min(
        args.limit ?? DEFAULT_ALL_LIMIT,
        MAX_TARGETS_PER_CALL - targetIds.length,
      );
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
      for (const row of rows) {
        if (!targetIds.includes(row.id)) targetIds.push(row.id);
      }
      const last = rows.length === limit ? rows[rows.length - 1] : undefined;
      nextBefore = last
        ? encodeSweepCursor(last.createdAt, last.id)
        : undefined;
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
    for (const recordingId of targetIds) {
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

    const changed = results.filter((r) => r.changed).length;
    return {
      ok: true as const,
      processed: results.length,
      changed,
      results,
      ...(nextBefore ? { nextBefore } : {}),
    };
  },
});
