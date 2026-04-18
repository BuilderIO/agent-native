/**
 * Public read endpoint used by the share page to fetch a call's metadata
 * without an authenticated session.
 *
 * GET /api/public-call?callId=<id>[&password=<pw>]
 *
 * Returns the call + media URL + (optionally) summary + (optionally)
 * transcript based on `share_includes_summary` / `share_includes_transcript`.
 *
 * Returns 404 for unknown IDs, non-public calls without a valid share grant,
 * expired calls, and missing/invalid passwords — we do not distinguish
 * between those states so we don't leak call existence.
 */

import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../db/index.js";
import { resolveAccess } from "@agent-native/core/sharing";
import { parseJson, parseSpaceIds } from "../../lib/calls.js";

function notFound(event: H3Event) {
  setResponseStatus(event, 404);
  return { error: "Not found" };
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event) as { callId?: string; password?: string };
  const callId = q.callId;
  const password = typeof q.password === "string" ? q.password : "";

  if (!callId) {
    setResponseStatus(event, 400);
    return { error: "callId is required" };
  }

  // `resolveAccess` returns non-null when the caller is the owner, the row is
  // public, or there's a matching share grant — exactly the set we want to
  // admit here. For non-public, non-shared calls it returns null and we 404.
  const access = await resolveAccess("call", callId);
  if (!access) return notFound(event);
  const call = access.resource as typeof schema.calls.$inferSelect;

  if (call.expiresAt) {
    const expires = new Date(call.expiresAt).getTime();
    if (Number.isFinite(expires) && expires < Date.now()) return notFound(event);
  }

  if (call.password && access.role !== "owner") {
    if (!password || password !== call.password) return notFound(event);
  }

  const db = getDb();
  const includeSummary = Boolean(call.shareIncludesSummary);
  const includeTranscript = Boolean(call.shareIncludesTranscript);

  const [summary] = includeSummary
    ? await db
        .select()
        .from(schema.callSummaries)
        .where(eq(schema.callSummaries.callId, callId))
        .limit(1)
    : [];

  const [transcript] = includeTranscript
    ? await db
        .select()
        .from(schema.callTranscripts)
        .where(eq(schema.callTranscripts.callId, callId))
        .limit(1)
    : [];

  const participants = await db
    .select()
    .from(schema.callParticipants)
    .where(eq(schema.callParticipants.callId, callId));

  let mediaUrl = call.mediaUrl ?? null;
  if (mediaUrl && !/^https?:\/\//i.test(mediaUrl) && call.password) {
    const sep = mediaUrl.includes("?") ? "&" : "?";
    mediaUrl = `${mediaUrl}${sep}p=${encodeURIComponent(call.password)}`;
  }

  return {
    call: {
      id: call.id,
      workspaceId: call.workspaceId,
      title: call.title,
      description: call.description,
      mediaUrl,
      mediaKind: call.mediaKind,
      mediaFormat: call.mediaFormat,
      thumbnailUrl: call.thumbnailUrl,
      durationMs: call.durationMs,
      width: call.width,
      height: call.height,
      status: call.status,
      source: call.source,
      recordedAt: call.recordedAt,
      hasPassword: Boolean(call.password),
      expiresAt: call.expiresAt,
      visibility: call.visibility,
      defaultSpeed: call.defaultSpeed,
      enableComments: Boolean(call.enableComments),
      enableDownloads: Boolean(call.enableDownloads),
      shareIncludesSummary: Boolean(call.shareIncludesSummary),
      shareIncludesTranscript: Boolean(call.shareIncludesTranscript),
      spaceIds: parseSpaceIds(call.spaceIds),
      createdAt: call.createdAt,
      updatedAt: call.updatedAt,
    },
    participants: participants.map((p) => ({
      id: p.id,
      speakerLabel: p.speakerLabel,
      displayName: p.displayName,
      email: p.email,
      isInternal: Boolean(p.isInternal),
      avatarUrl: p.avatarUrl,
      color: p.color,
      talkMs: p.talkMs,
      talkPct: p.talkPct,
      longestMonologueMs: p.longestMonologueMs,
      interruptionsCount: p.interruptionsCount,
      questionsCount: p.questionsCount,
    })),
    summary: summary
      ? {
          recap: summary.recap,
          keyPoints: parseJson(summary.keyPointsJson, [] as unknown[]),
          nextSteps: parseJson(summary.nextStepsJson, [] as unknown[]),
          topics: parseJson(summary.topicsJson, [] as unknown[]),
          questions: parseJson(summary.questionsJson, [] as unknown[]),
          actionItems: parseJson(summary.actionItemsJson, [] as unknown[]),
          sentiment: summary.sentiment,
          generatedAt: summary.generatedAt,
        }
      : null,
    transcript: transcript
      ? {
          status: transcript.status,
          language: transcript.language,
          fullText: transcript.fullText,
          segments: parseJson(transcript.segmentsJson, [] as unknown[]),
        }
      : null,
  };
});
