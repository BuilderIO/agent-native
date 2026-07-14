import {
  runWithRequestContext,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { z } from "zod";

import { ensureRecordingSeekable } from "../../../../actions/lib/ensure-seekable-video.js";
import requestTranscript from "../../../../actions/request-transcript.js";
import { getDb, schema } from "../../../db/index.js";
import {
  dispatchPostFinalizeJob,
  POST_FINALIZE_JOB_TOKEN_KIND,
  postFinalizeJobResourceId,
} from "../../../lib/post-finalize-dispatch.js";

const bodySchema = z.object({
  recordingId: z.string().min(1).max(200),
  kind: z.enum(["seekable", "transcript"]),
  token: z.string().min(1),
  delayMs: z.number().int().min(0).max(30_000).optional(),
  retryAttempt: z.number().int().min(1).max(10).optional(),
  regenerate: z.boolean().optional(),
});

export default defineEventHandler(async (event: H3Event) => {
  const parsed = bodySchema.safeParse(await readBody(event).catch(() => null));
  if (!parsed.success) {
    setResponseStatus(event, 400);
    return { ok: false, error: "Invalid post-finalize job" };
  }

  const { recordingId, kind, token, delayMs, retryAttempt, regenerate } =
    parsed.data;
  const verified = verifyScopedAgentAccessToken(token, {
    resourceKind: POST_FINALIZE_JOB_TOKEN_KIND,
    resourceId: postFinalizeJobResourceId(recordingId, kind),
  });
  if (!verified.ok) {
    setResponseStatus(event, 401);
    return { ok: false, error: "Invalid or expired post-finalize job token" };
  }

  const [recording] = await getDb()
    .select({
      id: schema.recordings.id,
      ownerEmail: schema.recordings.ownerEmail,
      orgId: schema.recordings.orgId,
      status: schema.recordings.status,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId))
    .limit(1);
  if (!recording) {
    setResponseStatus(event, 404);
    return { ok: false, error: "Recording not found" };
  }
  if (recording.status !== "ready") {
    return {
      ok: true,
      recordingId,
      kind,
      skipped: true,
      reason: `recording-${recording.status}`,
    };
  }

  return runWithRequestContext(
    {
      userEmail: recording.ownerEmail,
      orgId: recording.orgId ?? undefined,
    },
    async () => {
      if (delayMs) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        await dispatchPostFinalizeJob({
          recordingId,
          kind,
          retryAttempt,
          regenerate,
        });
        return {
          ok: true,
          recordingId,
          kind,
          retryAttempt,
          dispatchedAfterMs: delayMs,
        };
      }
      if (kind === "seekable") {
        const result = await ensureRecordingSeekable({
          recordingId,
          ownerEmail: recording.ownerEmail,
        });
        return { ok: true, kind, result };
      }

      const result = await requestTranscript.run({
        recordingId,
        force: true,
        retryAttempt,
        regenerate,
      });
      return { ok: true, kind, result };
    },
  );
});
