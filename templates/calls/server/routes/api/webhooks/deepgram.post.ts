/**
 * Deepgram async-transcription callback.
 *
 * When we kick off transcription with `?callback=<this-url>?callId=<id>`
 * Deepgram POSTs the response here once transcription is ready.
 *
 * This handler:
 *   1. Optionally verifies `dg-signature` if DEEPGRAM_WEBHOOK_SECRET is set.
 *   2. Parses the response via parseDeepgramResponse.
 *   3. Upserts `call_transcripts` (status="ready", segments, fullText).
 *   4. Materializes `call_participants` from unique speakerLabels.
 *   5. Flips `calls.status` transcribing → analyzing and bumps refresh-signal.
 *   6. Queues `ai-delegations:<callId>` in app-state so the agent chat picks
 *      up the summary / tracker pipeline.
 *
 * Route: POST /api/webhooks/deepgram?callId=<id>
 */

import {
  defineEventHandler,
  getQuery,
  getRequestHeader,
  readRawBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb, schema } from "../../../db/index.js";
import {
  colorForSpeaker,
  computeTalkStats,
  nanoid,
} from "../../../lib/calls.js";
import { parseDeepgramResponse } from "../../../lib/transcription/deepgram.js";
import { writeAppState } from "@agent-native/core/application-state";

function verifySignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  // Deepgram signs as hex; support both "sha256=<hex>" and plain hex.
  const supplied = signature.replace(/^sha256=/, "").trim();
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(supplied, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export default defineEventHandler(async (event: H3Event) => {
  const q = getQuery(event) as { callId?: string };
  const callId = q.callId;
  if (!callId) {
    setResponseStatus(event, 400);
    return { error: "callId is required" };
  }

  const rawBody = await readRawBody(event, false);
  if (!rawBody) {
    setResponseStatus(event, 400);
    return { error: "Empty body" };
  }
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);

  const secret = process.env.DEEPGRAM_WEBHOOK_SECRET;
  if (secret) {
    const sig = getRequestHeader(event, "dg-signature");
    if (!verifySignature(buf, sig, secret)) {
      setResponseStatus(event, 401);
      return { error: "Invalid signature" };
    }
  } else {
    console.warn(
      "[calls] DEEPGRAM_WEBHOOK_SECRET not set — accepting webhook without verification",
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(buf.toString("utf8"));
  } catch {
    setResponseStatus(event, 400);
    return { error: "Invalid JSON body" };
  }

  const parsed = parseDeepgramResponse(json);
  const db = getDb();

  const [call] = await db
    .select({ id: schema.calls.id, status: schema.calls.status })
    .from(schema.calls)
    .where(eq(schema.calls.id, callId))
    .limit(1);
  if (!call) {
    setResponseStatus(event, 404);
    return { error: "Call not found" };
  }

  const now = new Date().toISOString();

  const [existingTranscript] = await db
    .select({ callId: schema.callTranscripts.callId })
    .from(schema.callTranscripts)
    .where(eq(schema.callTranscripts.callId, callId))
    .limit(1);

  if (existingTranscript) {
    await db
      .update(schema.callTranscripts)
      .set({
        provider: "deepgram",
        status: "ready",
        language: parsed.language || "en",
        segmentsJson: JSON.stringify(parsed.segments),
        fullText: parsed.fullText,
        failureReason: null,
        updatedAt: now,
      })
      .where(eq(schema.callTranscripts.callId, callId));
  } else {
    await db.insert(schema.callTranscripts).values({
      callId,
      provider: "deepgram",
      status: "ready",
      language: parsed.language || "en",
      segmentsJson: JSON.stringify(parsed.segments),
      fullText: parsed.fullText,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Materialize participants from diarized segments. Replace the whole set
  // so a re-transcribe collapses any leftover rows from an earlier pass.
  const talkStats = computeTalkStats(parsed.segments);
  await db
    .delete(schema.callParticipants)
    .where(eq(schema.callParticipants.callId, callId));
  for (const p of talkStats.participants) {
    await db.insert(schema.callParticipants).values({
      id: nanoid(),
      callId,
      speakerLabel: p.speakerLabel,
      color: colorForSpeaker(p.speakerLabel),
      talkMs: p.talkMs,
      talkPct: p.talkPct,
      longestMonologueMs: p.longestMonologueMs,
      interruptionsCount: p.interruptionsCount,
      questionsCount: p.questionsCount,
      createdAt: now,
    });
  }

  await db
    .update(schema.calls)
    .set({ status: "analyzing", updatedAt: now })
    .where(eq(schema.calls.id, callId));

  // Queue the AI pipeline — the agent chat polls for ai-delegations-* keys.
  await writeAppState(`ai-delegations-${callId}`, {
    callId,
    kind: "call-ready-for-analysis",
    requestedAt: now,
    tasks: ["summary", "trackers", "topics", "questions"],
  });
  await writeAppState("refresh-signal", { ts: Date.now() });

  return {
    ok: true,
    callId,
    segments: parsed.segments.length,
    participants: talkStats.participants.length,
  };
});
