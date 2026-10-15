import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { dispatchPostFinalizeJob } from "../server/lib/post-finalize-dispatch.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
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
  description:
    "Import a transcript file for a recording instead of transcribing its audio: WebVTT, SRT, or timestamped text (a 0:21 or [0:21] start on each line or line pair, as copied from YouTube's transcript panel). Stores the file's own timings, labels the transcript as imported, and automatic transcription never replaces it. Importing over a ready transcript fails unless replace is true; ask the user before replacing. Leaves chapters alone; set those with set-chapters.",
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
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");
    const db = getDb();

    const [rec] = await db
      .select({
        status: schema.recordings.status,
        durationMs: schema.recordings.durationMs,
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
    const [previous] = await db
      .select({ status: t.status, source: t.source })
      .from(t)
      .where(eq(t.recordingId, args.recordingId))
      .limit(1);
    // The ready check sits in the upsert itself so a transcript that becomes
    // ready between the read above and this write is still never replaced
    // without `replace`.
    const written = await db
      .insert(t)
      .values({
        recordingId: args.recordingId,
        createdAt: now,
        ...values,
      })
      .onConflictDoUpdate({
        target: t.recordingId,
        set: values,
        ...(args.replace
          ? {}
          : {
              setWhere: sql`NOT (${t.status} = 'ready' AND (TRIM(${t.fullText}) <> '' OR ${t.segmentsJson} <> '[]'))`,
            }),
      })
      .returning({ recordingId: t.recordingId });
    if (written.length === 0) {
      fail(
        "This recording already has a ready transcript. Ask the user before replacing it, then call again with replace: true.",
        {
          errorCode: TRANSCRIPT_EXISTS_ERROR_CODE,
          statusCode: 409,
          details: { source: previous?.source ?? "automatic" },
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
      replaced: previous?.status === "ready",
      followUpQueued,
    };
  },
});
