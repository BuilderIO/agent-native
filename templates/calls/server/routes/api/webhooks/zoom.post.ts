/**
 * Zoom cloud-recording webhook.
 *
 * Zoom sends two flavors that we care about:
 *   1. `endpoint.url_validation` — Zoom's handshake when you register the
 *      endpoint. We echo back `{ plainToken, encryptedToken }` using HMAC-SHA256
 *      of the plain token with ZOOM_WEBHOOK_SECRET.
 *   2. `recording.completed` — a cloud recording is available. We create a
 *      `calls` row (source=zoom-cloud) with the download URL and kick off
 *      transcription. The host's user-level `zoom_connections` access token
 *      is used later by the finalize pipeline to actually fetch the bytes.
 *
 * Signature: standard Zoom signature is
 *   v0:<timestamp>:<body>  →  sha256 HMAC with ZOOM_WEBHOOK_SECRET
 *   x-zm-signature: "v0=<hex>"
 *   x-zm-request-timestamp: <unix seconds>
 *
 * Route: POST /api/webhooks/zoom
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
import { nanoid, resolveDefaultWorkspaceId } from "../../../lib/calls.js";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { writeAppState } from "@agent-native/core/application-state";

interface ZoomPayload {
  event?: string;
  payload?: {
    plainToken?: string;
    account_id?: string;
    object?: {
      host_email?: string;
      host_id?: string;
      uuid?: string;
      id?: string;
      topic?: string;
      start_time?: string;
      timezone?: string;
      duration?: number;
      share_url?: string;
      recording_files?: Array<{
        id?: string;
        meeting_id?: string;
        recording_start?: string;
        recording_end?: string;
        file_type?: string;
        file_extension?: string;
        file_size?: number;
        download_url?: string;
        play_url?: string;
        recording_type?: string;
        status?: string;
      }>;
    };
  };
  download_token?: string;
}

function verifyZoomSignature(
  rawBody: Buffer,
  timestamp: string | undefined,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!timestamp || !signature) return false;
  // Build the canonical message: "v0:<timestamp>:<rawBody>"
  const canonical = Buffer.concat([Buffer.from(`v0:${timestamp}:`), rawBody]);
  const expected = createHmac("sha256", secret).update(canonical).digest("hex");
  const supplied = signature.replace(/^v0=/, "").trim();
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(supplied, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function pickRecordingFile(
  files: NonNullable<
    NonNullable<ZoomPayload["payload"]>["object"]
  >["recording_files"],
): {
  downloadUrl: string;
  fileType: string;
  fileExtension: string;
  fileSize: number;
} | null {
  if (!files) return null;
  // Prefer shared-screen-with-speaker MP4 > MP4 > M4A.
  const score = (f: NonNullable<typeof files>[number]): number => {
    const t = (f.recording_type ?? "").toLowerCase();
    const ext = (f.file_extension ?? f.file_type ?? "").toLowerCase();
    let s = 0;
    if (ext === "mp4") s += 10;
    if (ext === "m4a") s += 5;
    if (t.includes("shared_screen_with_speaker")) s += 20;
    else if (t.includes("speaker")) s += 10;
    else if (t.includes("gallery")) s += 5;
    return s;
  };
  const sorted = [...files]
    .filter((f) => typeof f.download_url === "string" && f.download_url)
    .sort((a, b) => score(b) - score(a));
  const best = sorted[0];
  if (!best) return null;
  return {
    downloadUrl: best.download_url as string,
    fileType: (best.file_type ?? "").toUpperCase() || "MP4",
    fileExtension: (
      best.file_extension ??
      best.file_type ??
      "mp4"
    ).toLowerCase(),
    fileSize: Number(best.file_size ?? 0) || 0,
  };
}

export default defineEventHandler(async (event: H3Event) => {
  const rawBody = await readRawBody(event, false);
  if (!rawBody) {
    setResponseStatus(event, 400);
    return { error: "Empty body" };
  }
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);

  const secret = process.env.ZOOM_WEBHOOK_SECRET;
  if (secret) {
    const timestamp = getRequestHeader(event, "x-zm-request-timestamp");
    const signature = getRequestHeader(event, "x-zm-signature");
    if (!verifyZoomSignature(buf, timestamp, signature, secret)) {
      setResponseStatus(event, 401);
      return { error: "Invalid signature" };
    }
  } else {
    console.warn(
      "[calls] ZOOM_WEBHOOK_SECRET not set — accepting Zoom webhook without verification",
    );
  }

  let payload: ZoomPayload;
  try {
    payload = JSON.parse(buf.toString("utf8")) as ZoomPayload;
  } catch {
    setResponseStatus(event, 400);
    return { error: "Invalid JSON body" };
  }

  // Zoom URL validation handshake.
  if (payload.event === "endpoint.url_validation") {
    const plainToken = payload.payload?.plainToken;
    if (!plainToken) {
      setResponseStatus(event, 400);
      return { error: "Missing plainToken" };
    }
    const hashKey = secret ?? "dev-zoom-secret";
    const encryptedToken = createHmac("sha256", hashKey)
      .update(plainToken)
      .digest("hex");
    return { plainToken, encryptedToken };
  }

  if (payload.event !== "recording.completed") {
    return { ok: true, ignored: payload.event ?? "unknown" };
  }

  const obj = payload.payload?.object;
  if (!obj) {
    setResponseStatus(event, 400);
    return { error: "Missing payload.object" };
  }

  const hostEmail = (obj.host_email ?? "").toLowerCase();
  if (!hostEmail) {
    setResponseStatus(event, 400);
    return { error: "Missing host_email" };
  }

  const picked = pickRecordingFile(obj.recording_files);
  if (!picked) {
    console.error("[calls] zoom webhook had no usable recording file");
    setResponseStatus(event, 422);
    return { error: "No usable recording file" };
  }

  const db = getDb();
  const [connection] = await db
    .select()
    .from(schema.zoomConnections)
    .where(eq(schema.zoomConnections.email, hostEmail))
    .limit(1);

  if (!connection) {
    console.warn(
      `[calls] Zoom recording for ${hostEmail} but no zoom_connections row — skipping`,
    );
    return { ok: true, ignored: "no-zoom-connection" };
  }

  if (!connection.autoImport) {
    return { ok: true, ignored: "auto-import-disabled" };
  }

  // Resolve workspace — use the connection's owner context.
  const originalEmail = getRequestUserEmail();
  process.env.AGENT_USER_EMAIL = hostEmail;
  let workspaceId: string;
  try {
    workspaceId = await resolveDefaultWorkspaceId();
  } finally {
    if (originalEmail) process.env.AGENT_USER_EMAIL = originalEmail;
    else delete process.env.AGENT_USER_EMAIL;
  }

  const callId = nanoid();
  const now = new Date().toISOString();
  await db.insert(schema.calls).values({
    id: callId,
    workspaceId,
    title: obj.topic?.trim() || "Zoom recording",
    source: "zoom-cloud",
    sourceMeta: JSON.stringify({
      meetingId: obj.id,
      meetingUuid: obj.uuid,
      hostEmail,
      shareUrl: obj.share_url,
      downloadToken: payload.download_token,
      downloadUrl: picked.downloadUrl,
    }),
    mediaUrl: picked.downloadUrl,
    mediaKind: picked.fileExtension === "m4a" ? "audio" : "video",
    mediaFormat: picked.fileExtension,
    mediaSizeBytes: picked.fileSize,
    recordedAt: obj.start_time ?? null,
    timezone: obj.timezone ?? null,
    durationMs: Math.max(0, Math.round((obj.duration ?? 0) * 60 * 1000)),
    status: "processing",
    ownerEmail: hostEmail,
    createdAt: now,
    updatedAt: now,
  });

  await writeAppState(`call-transcribe-${callId}`, {
    callId,
    mediaUrl: picked.downloadUrl,
    downloadToken: payload.download_token,
    source: "zoom-cloud",
    requestedAt: now,
  });
  await writeAppState("refresh-signal", { ts: Date.now() });

  return { ok: true, callId };
});
