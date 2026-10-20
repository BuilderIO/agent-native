import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  mergeExcluded,
  parseEdits,
  serializeEdits,
} from "../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../server/db/index.js";
import { readEditsRecord } from "../server/lib/pending-redactions.js";
import { assertNativeRecordingMedia } from "./lib/native-media.js";
import { findSilenceTrimRanges } from "./lib/silence-trim-ranges.js";

const MAX_CAS_ATTEMPTS = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidStoredTrim(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.startMs) &&
    value.startMs >= 0 &&
    isFiniteNumber(value.endMs) &&
    value.endMs >= value.startMs &&
    typeof value.excluded === "boolean" &&
    (value.id === undefined ||
      (typeof value.id === "string" && value.id.length > 0))
  );
}

function isValidStoredBlur(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    isFiniteNumber(value.startMs) &&
    isFiniteNumber(value.endMs) &&
    value.endMs >= value.startMs &&
    isFiniteNumber(value.x) &&
    value.x >= 0 &&
    value.x <= 1 &&
    isFiniteNumber(value.y) &&
    value.y >= 0 &&
    value.y <= 1 &&
    isFiniteNumber(value.w) &&
    value.w >= 0 &&
    value.w <= 1 &&
    isFiniteNumber(value.h) &&
    value.h >= 0 &&
    value.h <= 1 &&
    isFiniteNumber(value.intensity)
  );
}

function hasValidStoredEditFields(edits: Record<string, unknown>): boolean {
  return (
    (edits.version === undefined || edits.version === 1) &&
    (edits.trims === undefined ||
      (Array.isArray(edits.trims) && edits.trims.every(isValidStoredTrim))) &&
    (edits.blurs === undefined ||
      (Array.isArray(edits.blurs) && edits.blurs.every(isValidStoredBlur))) &&
    (edits.thumbnail === undefined ||
      edits.thumbnail === null ||
      (isRecord(edits.thumbnail) &&
        (edits.thumbnail.kind === "url" ||
          edits.thumbnail.kind === "frame" ||
          edits.thumbnail.kind === "gif") &&
        typeof edits.thumbnail.value === "string")) &&
    (edits.stitchedFrom === undefined ||
      (Array.isArray(edits.stitchedFrom) &&
        edits.stitchedFrom.every((id) => typeof id === "string"))) &&
    (edits.mediaStorageLayout === undefined ||
      edits.mediaStorageLayout === "external") &&
    (edits.rewindOriginalStartMs === undefined ||
      (isFiniteNumber(edits.rewindOriginalStartMs) &&
        edits.rewindOriginalStartMs > 0)) &&
    (edits.overlays === undefined || Array.isArray(edits.overlays)) &&
    (edits.burnedRedactions === undefined ||
      Array.isArray(edits.burnedRedactions))
  );
}

function parseStoredEdits(editsJson: string | null | undefined) {
  const edits = readEditsRecord(editsJson);
  if (
    (typeof editsJson === "string" && !editsJson.trim()) ||
    !edits ||
    !hasValidStoredEditFields(edits)
  ) {
    fail(
      "Saved recording edits are unreadable or malformed; silence removal was not applied.",
      {
        errorCode: "edits_unreadable",
        statusCode: 422,
      },
    );
  }
  return parseEdits(editsJson);
}

export default defineAction({
  description:
    "Find long gaps between transcript segments and apply all silence trims in one recording update.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    thresholdMs: z
      .number()
      .int()
      .min(300)
      .default(1200)
      .describe("Minimum gap (ms) to be considered a silence"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();
    const [transcript] = await db
      .select()
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
      .limit(1);

    if (!transcript || transcript.status !== "ready") {
      fail(
        "Transcript must be ready before removing silences. Call request-transcript first.",
        { errorCode: "transcript_not_ready", statusCode: 409 },
      );
    }

    let ranges: ReturnType<typeof findSilenceTrimRanges> | undefined;
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const [recording] = await db
        .select()
        .from(schema.recordings)
        .where(eq(schema.recordings.id, args.recordingId))
        .limit(1);
      if (!recording) {
        fail(`Recording not found: ${args.recordingId}`, {
          errorCode: "recording_not_found",
          statusCode: 404,
        });
      }
      assertNativeRecordingMedia(recording);

      const currentEdits = parseStoredEdits(recording.editsJson);
      ranges ??= findSilenceTrimRanges(
        transcript.segmentsJson,
        args.thresholdMs,
        recording.durationMs,
      );
      if (ranges.length === 0) {
        return {
          id: args.recordingId,
          status: "completed" as const,
          removedRangeCount: 0,
          trimCount: currentEdits.trims.filter((trim) => trim.excluded).length,
        };
      }

      const previousEditsJson = recording.editsJson;
      const next = ranges.reduce(
        (edits, range) => mergeExcluded(edits, range.startMs, range.endMs),
        currentEdits,
      );
      const nextEditsJson = serializeEdits(next);
      if (nextEditsJson === previousEditsJson) {
        return {
          id: args.recordingId,
          status: "completed" as const,
          removedRangeCount: 0,
          trimCount: next.trims.filter((trim) => trim.excluded).length,
        };
      }

      const result = await db
        .update(schema.recordings)
        .set({ editsJson: nextEditsJson, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(schema.recordings.id, args.recordingId),
            previousEditsJson == null
              ? isNull(schema.recordings.editsJson)
              : eq(schema.recordings.editsJson, previousEditsJson),
          ),
        )
        .returning({ id: schema.recordings.id });

      if (result.length > 0) {
        try {
          await writeAppState("refresh-signal", { ts: Date.now() });
        } catch (error) {
          console.warn("[clips] failed to publish silence-trim refresh", {
            recordingId: args.recordingId,
            error,
          });
        }
        return {
          id: args.recordingId,
          status: "completed" as const,
          removedRangeCount: ranges.length,
          trimCount: next.trims.filter((trim) => trim.excluded).length,
        };
      }
    }

    fail(
      `Could not remove silences from ${args.recordingId} after ${MAX_CAS_ATTEMPTS} concurrent attempts.`,
      { errorCode: "recording_update_conflict", statusCode: 409 },
    );
  },
});
