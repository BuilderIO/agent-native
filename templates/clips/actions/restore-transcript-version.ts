import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { dispatchPostFinalizeJob } from "../server/lib/post-finalize-dispatch.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import {
  hasTranscriptContent,
  saveTranscriptVersion,
} from "../server/lib/transcript-versions.js";
import {
  parseTranscriptSegments,
  readSegmentEntries,
} from "../shared/transcript-segments.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  description:
    "Bring back a transcript that an import, a regenerate, or an earlier restore replaced. Version IDs are in transcript.versions from get-recording-player-data, and in savedVersionId from import-transcript or this action. The transcript it replaces is kept in turn, so pass this result's savedVersionId back to undo the restore. Leaves chapters alone.",
  // An outside agent that replaced a transcript over MCP needs the undo just
  // as directly as the import it came from.
  mcpApp: { compactCatalog: true },
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    versionId: z
      .string()
      .min(1)
      .max(128)
      .describe("ID of the saved transcript to bring back"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");
    const db = getDb();

    const [rec] = await db
      .select({
        status: schema.recordings.status,
        mediaUpdatedAt: schema.recordings.mediaUpdatedAt,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId))
      .limit(1);
    if (!rec) {
      fail(`Recording not found: ${args.recordingId}`, {
        errorCode: "recording_not_found",
        statusCode: 404,
      });
    }

    const t = schema.recordingTranscripts;
    const v = schema.recordingTranscriptVersions;
    const outcome = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: schema.recordings.id })
        .from(schema.recordings)
        .where(
          and(
            eq(schema.recordings.id, args.recordingId),
            eq(schema.recordings.mediaUpdatedAt, rec.mediaUpdatedAt),
          ),
        )
        .for("update");
      if (!locked) {
        fail(
          "The Clip media changed while the transcript was being restored. Try again.",
          { errorCode: "recording_media_changed", statusCode: 409 },
        );
      }
      // The transcript row is locked before any version, the same order an
      // import takes, so a restore and an import cannot deadlock.
      const [current] = await tx
        .select()
        .from(t)
        .where(eq(t.recordingId, args.recordingId))
        .for("update");
      const [version] = await tx
        .select()
        .from(v)
        .where(
          and(eq(v.id, args.versionId), eq(v.recordingId, args.recordingId)),
        );
      if (!version) return null;
      // Restored anyway, its unreadable cues would drop out of a ready
      // transcript, and the version would be spent on it.
      if (readSegmentEntries(version.segmentsJson) === null) {
        fail(
          `Saved transcript ${version.id} has unreadable segments, so it can't be restored. Both transcripts were left as they were.`,
          { errorCode: "transcript_segments_unreadable", statusCode: 500 },
        );
      }

      // Removed before the current transcript is saved, so keeping that one
      // never prunes an older version to make room for this one.
      await tx.delete(v).where(eq(v.id, version.id));
      const savedVersionId =
        current && hasTranscriptContent(current)
          ? await saveTranscriptVersion(tx, current, {
              reason: "restore",
              replacedBy: getCurrentOwnerEmail(),
            })
          : null;
      const restored = {
        language: version.language,
        segmentsJson: version.segmentsJson,
        fullText: version.fullText,
        status: version.status,
        failureReason: null,
        failureCode: null,
        retryCount: 0,
        source: version.source,
        importId: version.importId,
        updatedAt: new Date().toISOString(),
      };
      await tx
        .insert(t)
        .values({
          recordingId: args.recordingId,
          ownerEmail: version.ownerEmail,
          createdAt: restored.updatedAt,
          ...restored,
        })
        .onConflictDoUpdate({ target: t.recordingId, set: restored });
      return { version, savedVersionId };
    });
    if (!outcome) {
      fail(
        `No saved transcript ${args.versionId} for recording ${args.recordingId}. It may have been restored already; read transcript.versions from get-recording-player-data for the current list.`,
        { errorCode: "transcript_version_not_found", statusCode: 404 },
      );
    }

    // Restored by now. A missed signal only delays other open views.
    await writeAppState("refresh-signal", { ts: Date.now() }).catch(
      (err: unknown) => {
        console.warn(
          `[clips] restored transcript refresh signal failed for ${args.recordingId}:`,
          (err as Error)?.message ?? String(err),
        );
      },
    );

    // Same follow-up as an import: fill a missing title or summary and
    // refresh the brain export from the restored text.
    const followUpQueued =
      rec.status === "ready" &&
      (await dispatchPostFinalizeJob({
        recordingId: args.recordingId,
        kind: "transcript",
      }).then(
        () => true,
        (err: unknown) => {
          console.warn(
            `[clips] restored transcript follow-up dispatch failed for ${args.recordingId}:`,
            (err as Error)?.message ?? String(err),
          );
          return false;
        },
      ));

    return {
      recordingId: args.recordingId,
      status: outcome.version.status,
      source: outcome.version.source ?? null,
      language: outcome.version.language,
      segments: parseTranscriptSegments(outcome.version.segmentsJson).length,
      savedVersionId: outcome.savedVersionId,
      followUpQueued,
    };
  },
});
