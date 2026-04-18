/**
 * Return a presigned S3/R2 PUT URL for direct browser-to-cloud media uploads.
 *
 * Input:  { callId, contentType, sizeBytes }
 * Output (when S3/R2 env configured):
 *   { mode: "direct", uploadUrl, publicUrl, expiresInSeconds, headers }
 * Output (when env missing):
 *   { mode: "chunked", chunkUrl: "/api/uploads/<callId>/chunk" }
 *
 * We generate a minimal SigV4 PUT URL inline using Web Crypto so we don't
 * pull in `@aws-sdk/client-s3`. If any required env var is missing we fall
 * back to the chunked endpoint rather than erroring — this route should be
 * safe to call from the client without any configuration.
 *
 * Env (any one of S3_* or R2_* is enough):
 *   S3_REGION               (default: "auto")
 *   S3_BUCKET | R2_BUCKET
 *   S3_ACCESS_KEY_ID | R2_ACCESS_KEY_ID
 *   S3_SECRET_ACCESS_KEY | R2_SECRET_ACCESS_KEY
 *   S3_ENDPOINT | R2_ENDPOINT    (e.g. https://<acct>.r2.cloudflarestorage.com)
 *   S3_PUBLIC_BASE_URL | R2_PUBLIC_BASE_URL (optional — for the public read URL)
 *
 * Route: POST /api/uploads/direct
 */

import {
  defineEventHandler,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { assertAccess } from "@agent-native/core/sharing";

interface DirectUploadBody {
  callId?: string;
  contentType?: string;
  sizeBytes?: number;
}

interface CloudConfig {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  publicBaseUrl: string | null;
  service: "s3";
}

function readCloudConfig(): CloudConfig | null {
  const env = process.env;
  const bucket = env.S3_BUCKET || env.R2_BUCKET;
  const accessKeyId = env.S3_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY;
  const endpoint = env.S3_ENDPOINT || env.R2_ENDPOINT;
  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) {
    return null;
  }
  const region = env.S3_REGION || env.R2_REGION || "auto";
  const publicBaseUrl =
    env.S3_PUBLIC_BASE_URL || env.R2_PUBLIC_BASE_URL || null;
  return {
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint: endpoint.replace(/\/+$/, ""),
    publicBaseUrl: publicBaseUrl ? publicBaseUrl.replace(/\/+$/, "") : null,
    service: "s3",
  };
}

const EXT_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/webm": "webm",
  "audio/wav": "wav",
};

function extFor(contentType: string): string {
  return EXT_BY_MIME[contentType] ?? "bin";
}

async function hmac(key: ArrayBuffer, msg: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(msg));
}

async function sha256Hex(msg: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(msg),
  );
  return toHex(buf);
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

async function deriveSigningKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> {
  const kSecret = new TextEncoder().encode(`AWS4${secret}`);
  const kDate = await hmac(kSecret.buffer, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  return kSigning;
}

function rfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

async function presignPutUrl(
  cfg: CloudConfig,
  key: string,
  contentType: string,
  expiresInSeconds: number,
): Promise<string> {
  const now = new Date();
  const amzDate =
    now
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, "")
      .slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${cfg.region}/${cfg.service}/aws4_request`;

  const hostUrl = new URL(cfg.endpoint);
  const host = hostUrl.host;
  const canonicalUri = `/${rfc3986(cfg.bucket)}/${key
    .split("/")
    .map(rfc3986)
    .join("/")}`;

  const query = new URLSearchParams();
  query.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  query.set("X-Amz-Credential", `${cfg.accessKeyId}/${credentialScope}`);
  query.set("X-Amz-Date", amzDate);
  query.set("X-Amz-Expires", String(expiresInSeconds));
  query.set("X-Amz-SignedHeaders", "host");

  const canonicalHeaders = `host:${host}\n`;
  const canonicalQueryString = Array.from(query.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .join("&");

  const payloadHash = "UNSIGNED-PAYLOAD";
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    "host",
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await deriveSigningKey(
    cfg.secretAccessKey,
    dateStamp,
    cfg.region,
    cfg.service,
  );
  const signature = toHex(await hmac(signingKey, stringToSign));

  query.set("X-Amz-Signature", signature);

  return `${cfg.endpoint}${canonicalUri}?${query.toString()}`;
}

export default defineEventHandler(async (event: H3Event) => {
  const body = (await readBody(event).catch(
    () => null,
  )) as DirectUploadBody | null;

  const callId = body?.callId;
  const contentType = body?.contentType ?? "application/octet-stream";
  const sizeBytes = body?.sizeBytes ?? 0;

  if (!callId || typeof callId !== "string") {
    setResponseStatus(event, 400);
    return { error: "callId is required" };
  }

  try {
    await assertAccess("call", callId, "editor");
  } catch {
    setResponseStatus(event, 403);
    return { error: "Forbidden" };
  }

  const cfg = readCloudConfig();
  if (!cfg) {
    // Safe fallback — let the client degrade to the chunked endpoint.
    return {
      mode: "chunked" as const,
      chunkUrl: `/api/uploads/${callId}/chunk`,
      reason:
        "Cloud storage is not configured. Set S3_* or R2_* env vars (bucket, access key, secret, endpoint) to enable direct uploads.",
    };
  }

  const ext = extFor(contentType);
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const objectKey = `calls/${callId}/media-${stamp}-${rand}.${ext}`;
  const expiresInSeconds = 15 * 60;

  let uploadUrl: string;
  try {
    uploadUrl = await presignPutUrl(
      cfg,
      objectKey,
      contentType,
      expiresInSeconds,
    );
  } catch (err) {
    console.error("[calls] presign failed:", err);
    return {
      mode: "chunked" as const,
      chunkUrl: `/api/uploads/${callId}/chunk`,
      reason:
        err instanceof Error ? err.message : "Failed to presign upload URL",
    };
  }

  const publicUrl = cfg.publicBaseUrl
    ? `${cfg.publicBaseUrl}/${objectKey}`
    : `${cfg.endpoint}/${cfg.bucket}/${objectKey}`;

  return {
    mode: "direct" as const,
    uploadUrl,
    publicUrl,
    objectKey,
    expiresInSeconds,
    headers: { "content-type": contentType },
    sizeBytes,
  };
});
