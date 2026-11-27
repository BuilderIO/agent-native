// guard:allow-api-route — part of the track upload protocol recorders call between chunks, not a CRUD API.
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import {
  createError,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";

import { isRetryableUploadInterruption } from "../../../../../../shared/upload-interruption.js";
import { getDb, schema } from "../../../../../db/index.js";
import { hasBurnedRedactions } from "../../../../../lib/pending-redactions.js";
import { snapshotRichRecordingPolicy } from "../../../../../lib/recording-policy.js";
import {
  readSavedRichDraft,
  saveRichDraft,
  withdrawRichDraft,
} from "../../../../../lib/recording-tracks.js";
import {
  getEventOwnerContext,
  ownerEmailMatches,
} from "../../../../../lib/recordings.js";
import {
  type FinalizeRichRecordingInput,
  finalizeRichRecordingSchema,
  sanitizeTrackMeta,
} from "../../../../../lib/rich-recording-manifest.js";

const SAVE_ATTEMPTS = 3;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function findRecording(recordingId: string, ownerEmail: string) {
  const found = await getDb()
    .select({
      status: schema.recordings.status,
      uploadGenerationId: schema.recordings.uploadGenerationId,
      mediaFormat: schema.recordings.mediaFormat,
      editsJson: schema.recordings.editsJson,
      trashedAt: schema.recordings.trashedAt,
      failureCode: schema.recordings.failureCode,
      failureReason: schema.recordings.failureReason,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    )
    .limit(1);
  const existing = found.length ? found[0] : null;
  if (
    !existing ||
    existing.trashedAt ||
    existing.failureCode === "taken_down"
  ) {
    throw createError({ statusCode: 404, message: "Recording not found" });
  }
  return existing;
}

function staleAttempt(event: H3Event) {
  setResponseStatus(event, 409);
  return {
    ok: false,
    error: "A newer upload of this recording is active.",
    staleAttempt: true,
  };
}

async function refuseDraft(
  event: H3Event,
  params: {
    recordingId: string;
    ownerEmail: string;
    orgId: string | undefined;
    input: FinalizeRichRecordingInput;
  },
) {
  const existing = await findRecording(params.recordingId, params.ownerEmail);
  if (
    (params.input.uploadGenerationId ?? null) !== existing.uploadGenerationId
  ) {
    return staleAttempt(event);
  }
  if (existing.mediaFormat === "rich") {
    setResponseStatus(event, 409);
    return {
      ok: false,
      error: "This recording's tracks are already finalized.",
      tracksFinalized: true,
    };
  }
  if (existing.status === "failed") {
    setResponseStatus(event, 409);
    return isRetryableUploadInterruption(existing.failureReason)
      ? {
          ok: false,
          error:
            "The recording's upload was interrupted. Send this again once it resumes.",
          retryable: true,
        }
      : {
          ok: false,
          error: "The recording failed, so its tracks were not kept.",
          tracksStopped: true,
        };
  }
  if (hasBurnedRedactions(existing.editsJson)) {
    setResponseStatus(event, 409);
    return {
      ok: false,
      error:
        "Redactions were burned into this recording, so Clips stopped keeping its separate tracks.",
      tracksStopped: true,
    };
  }
  if (
    !(await snapshotRichRecordingPolicy(
      params.ownerEmail,
      params.orgId,
      params.recordingId,
    ))
  ) {
    setResponseStatus(event, 403);
    return {
      ok: false,
      error: "Separate tracks are off for this recording.",
      labDisabled: true,
      tracksStopped: true,
    };
  }
  return null;
}

export async function handleTrackDraft(event: H3Event) {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    throw createError({ statusCode: 400, message: "Missing recordingId" });
  }
  let raw: unknown;
  try {
    raw = await readBody(event);
  } catch (err) {
    setResponseStatus(event, 400);
    return {
      ok: false,
      error: `The track draft is not valid JSON: ${errorMessage(err)}`,
    };
  }
  const parsed = finalizeRichRecordingSchema.safeParse(raw);
  if (!parsed.success || parsed.data.status !== "recovered") {
    setResponseStatus(event, 400);
    return {
      ok: false,
      error: "The track draft is not valid.",
      issues: parsed.success
        ? [{ path: "status", message: "A draft's status is recovered." }]
        : parsed.error.issues.slice(0, 10).map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
    };
  }
  const input = parsed.data;
  const draft = {
    ...input,
    tracks: input.tracks.map((track) => ({
      ...track,
      meta: sanitizeTrackMeta(track.id, track.meta),
    })),
  };

  let context: Awaited<ReturnType<typeof getEventOwnerContext>>;
  try {
    context = await getEventOwnerContext(event);
  } catch {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }
  const ownerEmail = context.userEmail;

  return runWithRequestContext(
    {
      userEmail: ownerEmail,
      ...(context.orgId === undefined ? {} : { orgId: context.orgId }),
      ...(context.authUserId === undefined
        ? {}
        : { authUserId: context.authUserId }),
    },
    async () => {
      for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt += 1) {
        const previous = await readSavedRichDraft(recordingId);
        const kept = finalizeRichRecordingSchema.safeParse(previous?.body);
        if (
          kept.success &&
          (kept.data.uploadGenerationId ?? null) ===
            (input.uploadGenerationId ?? null) &&
          kept.data.durationMs > input.durationMs
        ) {
          setResponseStatus(event, 409);
          return {
            ok: false,
            error: "A later draft of this recording is already kept.",
            staleDraft: true,
          };
        }
        const refusal = await refuseDraft(event, {
          recordingId,
          ownerEmail,
          orgId: context.orgId,
          input,
        });
        if (refusal) return refusal;
        const saved = await saveRichDraft(recordingId, previous, draft);
        if (!saved) continue;
        let current: Awaited<ReturnType<typeof findRecording>>;
        try {
          current = await findRecording(recordingId, ownerEmail);
        } catch (error) {
          await withdrawRichDraft(recordingId, saved);
          throw error;
        }
        if ((input.uploadGenerationId ?? null) !== current.uploadGenerationId) {
          await withdrawRichDraft(recordingId, saved);
          return staleAttempt(event);
        }
        return { ok: true, recordingId };
      }
      setResponseStatus(event, 409);
      return {
        ok: false,
        error:
          "Other drafts of this recording kept arriving while this one was saved. Send it again.",
        retryable: true,
      };
    },
  );
}

export default defineEventHandler(handleTrackDraft);
