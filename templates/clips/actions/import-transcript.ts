import { randomUUID } from "node:crypto";

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
  describeTranscriptImportError,
  IMPORTED_TRANSCRIPT_SOURCE,
  MAX_TRANSCRIPT_IMPORT_CHARS,
  parseTranscriptImport,
  TRANSCRIPT_EXISTS_ERROR_CODE,
  TRANSCRIPT_IMPORT_FORMATS,
} from "../shared/transcript-import.js";
import { booleanParam } from "./lib/cli-params.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  description:
    "Import a transcript file for a recording instead of transcribing its audio: WebVTT, SRT, or timestamped text (a 0:21 or [0:21] start on each line or line pair, as copied from YouTube's transcript panel). Stores the file's own timings, labels the transcript as imported, and automatic transcription never replaces it. Importing over a ready transcript fails with transcript_exists, so nothing is replaced by accident; when the user wants this file to replace it, call again with replace: true and the replaceImportId the error names. The replaced transcript is kept: pass the result's savedVersionId to restore-transcript-version to bring it back. Leaves chapters alone; set those with set-chapters.",
  // Advertised up front like create-recording-upload: an outside agent holding a
  // transcript file has no other way to hand it to Clips.
  mcpApp: { compactCatalog: true },
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    text: z
      .string()
      .max(MAX_TRANSCRIPT_IMPORT_CHARS)
      .describe("The transcript file's full contents"),
    format: z
      .enum(TRANSCRIPT_IMPORT_FORMATS)
      .optional()
      .describe(
        "vtt, srt, or text (timestamped lines). Detected from the contents when omitted.",
      ),
    language: z
      .string()
      .regex(/^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i)
      .optional()
      .describe(
        "BCP 47 language of the transcript, such as en or pt-BR. Defaults to a WebVTT file's Language header, else und (undetermined).",
      ),
    replace: booleanParam
      .default(false)
      .describe("Replace a transcript that is already ready."),
    replaceImportId: z
      .string()
      .min(1)
      .max(128)
      .nullable()
      .optional()
      .describe(
        "With replace: the replaceImportId named in the transcript_exists error, or transcript.importId from get-recording-player-data, for the transcript being replaced (null when it was not imported). A different transcript found there fails with transcript_exists again.",
      ),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");
    const db = getDb();

    const [rec] = await db
      .select({
        status: schema.recordings.status,
        durationMs: schema.recordings.durationMs,
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

    const parsed = parseTranscriptImport(args.text, {
      format: args.format,
      durationMs: rec.durationMs,
    });
    if (!parsed.ok) {
      fail(describeTranscriptImportError(parsed.error), {
        errorCode: "transcript_import_invalid",
        statusCode: 422,
        details: {
          reason: parsed.error.code,
          line: parsed.error.line,
          format: parsed.format,
        },
      });
    }

    const t = schema.recordingTranscripts;
    const now = new Date().toISOString();
    const values = {
      ownerEmail: getCurrentOwnerEmail(),
      fullText: parsed.fullText,
      segmentsJson: JSON.stringify(parsed.segments),
      language: args.language ?? parsed.language ?? "und",
      status: "ready" as const,
      failureReason: null,
      failureCode: null,
      retryCount: 0,
      source: IMPORTED_TRANSCRIPT_SOURCE,
      importId: randomUUID(),
      updatedAt: now,
    };
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
          "The Clip media changed while the transcript was being imported. Try again.",
          {
            errorCode: "recording_media_changed",
            statusCode: 409,
          },
        );
      }

      // Locked, so the checks below see the transcript this write replaces: one
      // that becomes ready meanwhile is never replaced without `replace`, and a
      // replace never reaches a newer import than the one it named.
      const lockCurrent = () =>
        tx
          .select()
          .from(t)
          .where(eq(t.recordingId, args.recordingId))
          .for("update")
          .then((rows) => rows[0]);
      let current = await lockCurrent();
      if (!current) {
        const inserted = await tx
          .insert(t)
          .values({ recordingId: args.recordingId, createdAt: now, ...values })
          .onConflictDoNothing({ target: t.recordingId })
          .returning({ recordingId: t.recordingId });
        if (inserted.length > 0) {
          return {
            written: true as const,
            replaced: false,
            savedVersionId: null,
          };
        }
        // Another writer created the row since the read; check it like any other.
        current = await lockCurrent();
        if (!current) {
          fail(
            `Transcript row for ${args.recordingId} was removed while saving`,
            {
              errorCode: "transcript_removed",
              statusCode: 409,
            },
          );
        }
      }
      const ready = hasTranscriptContent(current);
      if (
        ready &&
        !(args.replace && (args.replaceImportId ?? null) === current.importId)
      ) {
        return {
          written: false as const,
          source: current.source,
          importId: current.importId,
        };
      }
      await tx.update(t).set(values).where(eq(t.recordingId, args.recordingId));
      const savedVersionId = ready
        ? await saveTranscriptVersion(tx, current, {
            reason: "import",
            replacedBy: values.ownerEmail,
          })
        : null;
      return { written: true as const, replaced: ready, savedVersionId };
    });
    if (!outcome.written) {
      // The id goes in the message: agents over MCP and in chat see only the
      // message and errorCode, never `details`.
      const retry = `replace: true and replaceImportId: ${JSON.stringify(outcome.importId)}`;
      fail(
        args.replace
          ? `The transcript changed since you read it. If the user still wants this file to replace it, call again with ${retry}.`
          : `This recording already has a ready transcript. If the user asked for this file to replace it, call again with ${retry}.`,
        {
          errorCode: TRANSCRIPT_EXISTS_ERROR_CODE,
          statusCode: 409,
          details: {
            source: outcome.source ?? "automatic",
            importId: outcome.importId,
          },
        },
      );
    }

    // The import is saved by now. A missed signal only delays other open
    // views, and failing here would make a retry hit transcript_exists.
    await writeAppState("refresh-signal", { ts: Date.now() }).catch(
      (err: unknown) => {
        console.warn(
          `[clips] imported transcript refresh signal failed for ${args.recordingId}:`,
          (err as Error)?.message ?? String(err),
        );
      },
    );

    // The transcript job keeps an imported transcript; from it, it fills a
    // missing title or summary and refreshes the brain export.
    const followUpQueued =
      rec.status === "ready" &&
      (await dispatchPostFinalizeJob({
        recordingId: args.recordingId,
        kind: "transcript",
      }).then(
        () => true,
        (err: unknown) => {
          console.warn(
            `[clips] imported transcript follow-up dispatch failed for ${args.recordingId}:`,
            (err as Error)?.message ?? String(err),
          );
          return false;
        },
      ));

    return {
      recordingId: args.recordingId,
      status: "ready" as const,
      source: IMPORTED_TRANSCRIPT_SOURCE,
      format: parsed.format,
      segments: parsed.segments.length,
      replaced: outcome.replaced,
      savedVersionId: outcome.savedVersionId,
      followUpQueued,
    };
  },
});
