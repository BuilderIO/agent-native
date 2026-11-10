import { defineAction } from "@agent-native/core/action";
import { and, desc, eq, isNotNull } from "drizzle-orm";
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
});
const DEFAULT_ALL_LIMIT = 20;
const cliBoolean = z.preprocess((value) => {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return value;
}, z.boolean());

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
  description: `Raise the audio of quiet recordings to a normal speech level. Clips quieter than ${AUDIO_LEVEL_QUIET_THRESHOLD_LUFS} LUFS get a fixed boost toward ${AUDIO_LEVEL_TARGET_LUFS} LUFS with a peak limiter; the video is copied, and clips that already sound normal are left untouched. New uploads are leveled automatically; use this for older clips. Pass \`id\` for one clip, \`ids\` for several, or \`all: true\` for a bounded sweep of the caller's own clips. Clips already checked are skipped unless \`force\` is true.`,
  schema: z.object({
    id: z.string().optional().describe("A single recording id to level."),
    ids: z
      .union([z.array(z.string()), z.string()])
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
    force: cliBoolean
      .optional()
      .describe("Measure again even on clips already checked."),
  }),
  outputSchema,
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const force = Boolean(args.force);

    let targetIds: string[] = [];
    if (args.id) targetIds.push(args.id);
    targetIds.push(...parseIds(args.ids));

    if (args.all) {
      const rows = await db
        .select({ id: schema.recordings.id })
        .from(schema.recordings)
        .where(
          and(
            ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
            eq(schema.recordings.status, "ready"),
            eq(schema.recordings.hasAudio, true),
            isNotNull(schema.recordings.videoUrl),
          ),
        )
        .orderBy(desc(schema.recordings.createdAt))
        .limit(args.limit ?? DEFAULT_ALL_LIMIT);
      targetIds.push(...rows.map((r) => r.id));
    }

    targetIds = Array.from(new Set(targetIds)).slice(0, MAX_TARGETS_PER_CALL);
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
    };
  },
});
