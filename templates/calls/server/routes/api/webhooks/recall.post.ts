/**
 * Recall.ai bot lifecycle events.
 *
 * We care about:
 *   - bot.status_change with data.status: joining | recording | done | failed
 *   - On `done`: fetch the recording URL from Recall, create a `calls` row
 *     (source=recall-bot), set status=processing, and kick off transcription.
 *   - On `failed`: mark the recall_bots row failed and log.
 *
 * Signature verification: if RECALL_WEBHOOK_SECRET is set, verify a SHA-256
 * HMAC of the raw body as `x-recall-signature`. Otherwise accept with a warning.
 *
 * Route: POST /api/webhooks/recall
 */

import {
  defineEventHandler,
  getRequestHeader,
  readRawBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb, schema } from "../../../db/index.js";
import { nanoid } from "../../../lib/calls.js";
import { writeAppState } from "@agent-native/core/application-state";

interface RecallEvent {
  event?: string;
  data?: {
    bot_id?: string;
    bot?: { id?: string };
    status?: { code?: string } | string;
    meeting_url?: { meeting_id?: string } | string;
  };
}

interface RecallBotDetail {
  id: string;
  meeting_url?: { meeting_id?: string } | string;
  video_url?: string;
  recordings?: Array<{
    media_shortcuts?: {
      video?: { data?: { download_url?: string } };
      video_mixed?: { data?: { download_url?: string } };
    };
  }>;
}

function verifySignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
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

function extractStatus(raw: RecallEvent["data"] | undefined): string | null {
  if (!raw) return null;
  const s = raw.status;
  if (typeof s === "string") return s;
  if (s && typeof s === "object" && typeof s.code === "string") return s.code;
  return null;
}

function extractMeetingUrl(raw: RecallEvent["data"] | undefined): string {
  if (!raw) return "";
  const m = raw.meeting_url;
  if (typeof m === "string") return m;
  if (m && typeof m === "object" && typeof m.meeting_id === "string") {
    return m.meeting_id;
  }
  return "";
}

async function fetchBotDetail(
  botId: string,
  apiKey: string,
): Promise<RecallBotDetail | null> {
  try {
    const res = await fetch(`https://us-east-1.recall.ai/api/v1/bot/${botId}`, {
      headers: { Authorization: `Token ${apiKey}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as RecallBotDetail;
  } catch {
    return null;
  }
}

function pickVideoUrl(detail: RecallBotDetail): string | null {
  if (typeof detail.video_url === "string" && detail.video_url) {
    return detail.video_url;
  }
  for (const rec of detail.recordings ?? []) {
    const url =
      rec.media_shortcuts?.video?.data?.download_url ||
      rec.media_shortcuts?.video_mixed?.data?.download_url;
    if (url) return url;
  }
  return null;
}

export default defineEventHandler(async (event: H3Event) => {
  const rawBody = await readRawBody(event, false);
  if (!rawBody) {
    setResponseStatus(event, 400);
    return { error: "Empty body" };
  }
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);

  const secret = process.env.RECALL_WEBHOOK_SECRET;
  if (secret) {
    const sig = getRequestHeader(event, "x-recall-signature");
    if (!verifySignature(buf, sig, secret)) {
      setResponseStatus(event, 401);
      return { error: "Invalid signature" };
    }
  } else {
    console.warn(
      "[calls] RECALL_WEBHOOK_SECRET not set — accepting Recall webhook without verification",
    );
  }

  let payload: RecallEvent;
  try {
    payload = JSON.parse(buf.toString("utf8")) as RecallEvent;
  } catch {
    setResponseStatus(event, 400);
    return { error: "Invalid JSON body" };
  }

  const eventType = payload.event || "";
  if (eventType !== "bot.status_change") {
    // Silently accept other event types — we might subscribe to more later.
    return { ok: true, ignored: eventType || "unknown" };
  }

  const botId =
    payload.data?.bot_id ||
    (typeof payload.data?.bot?.id === "string" ? payload.data.bot.id : "");
  if (!botId) {
    setResponseStatus(event, 400);
    return { error: "Missing bot id" };
  }

  const statusCode = extractStatus(payload.data) || "";
  const db = getDb();
  const now = new Date().toISOString();

  const [bot] = await db
    .select()
    .from(schema.recallBots)
    .where(eq(schema.recallBots.id, botId))
    .limit(1);
  if (!bot) {
    // We don't track this bot — acknowledge so Recall stops retrying.
    return { ok: true, unknownBot: true };
  }

  const normalizedMeetingUrl = extractMeetingUrl(payload.data) || bot.meetingUrl;
  const patch: Partial<typeof schema.recallBots.$inferInsert> = {
    updatedAt: now,
    rawJson: JSON.stringify(payload),
    meetingUrl: normalizedMeetingUrl,
  };

  if (statusCode === "joining" || statusCode === "in_call_not_recording") {
    patch.status = "joining";
  } else if (
    statusCode === "in_call_recording" ||
    statusCode === "recording" ||
    statusCode === "in_progress"
  ) {
    patch.status = "recording";
    patch.startedAt = bot.startedAt ?? now;
  } else if (
    statusCode === "done" ||
    statusCode === "call_ended" ||
    statusCode === "done_recording"
  ) {
    patch.status = "done";
    patch.endedAt = now;
  } else if (
    statusCode === "failed" ||
    statusCode === "fatal" ||
    statusCode === "error"
  ) {
    patch.status = "failed";
    patch.endedAt = now;
  }

  await db
    .update(schema.recallBots)
    .set(patch)
    .where(eq(schema.recallBots.id, botId));

  if (patch.status === "failed") {
    console.error("[calls] Recall bot failed:", botId, payload);
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { ok: true, status: "failed" };
  }

  if (patch.status !== "done") {
    // Nothing else to do for in-progress states — just keep the row in sync.
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { ok: true, status: patch.status ?? statusCode };
  }

  // `done` — pull the recording URL and materialize a call row.
  const apiKey = process.env.RECALL_AI_API_KEY;
  if (!apiKey) {
    console.error(
      "[calls] RECALL_AI_API_KEY not set — cannot fetch bot recording URL",
    );
    setResponseStatus(event, 500);
    return { error: "RECALL_AI_API_KEY not configured" };
  }

  const detail = await fetchBotDetail(botId, apiKey);
  const mediaUrl = detail ? pickVideoUrl(detail) : null;

  // Create or reuse the `calls` row associated with this bot.
  let callId = bot.callId;
  if (!callId) {
    callId = nanoid();
    await db.insert(schema.calls).values({
      id: callId,
      workspaceId: bot.workspaceId,
      title: `Meeting recording (${normalizedMeetingUrl || botId})`,
      source: "recall-bot",
      sourceMeta: JSON.stringify({
        botId,
        meetingUrl: normalizedMeetingUrl,
      }),
      status: mediaUrl ? "processing" : "failed",
      mediaUrl: mediaUrl ?? undefined,
      mediaKind: "video",
      mediaFormat: "mp4",
      failureReason: mediaUrl ? null : "No recording URL returned by Recall",
      ownerEmail: bot.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .update(schema.recallBots)
      .set({ callId })
      .where(eq(schema.recallBots.id, botId));
  } else {
    await db
      .update(schema.calls)
      .set({
        status: mediaUrl ? "processing" : "failed",
        mediaUrl: mediaUrl ?? undefined,
        failureReason: mediaUrl ? null : "No recording URL returned by Recall",
        updatedAt: now,
      })
      .where(eq(schema.calls.id, callId));
  }

  if (mediaUrl) {
    // Kick off async transcription via a delegation key — `finalize-call`
    // also writes this shape, so whichever plugin services it works for both.
    await writeAppState(`call-transcribe-${callId}`, {
      callId,
      mediaUrl,
      requestedAt: now,
      source: "recall-bot",
    });
  }
  await writeAppState("refresh-signal", { ts: Date.now() });

  return { ok: true, callId, status: "done" };
});
