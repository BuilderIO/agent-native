/**
 * S3-compatible file upload provider.
 *
 * Works with AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO, Backblaze B2,
 * and any other S3-compatible object storage. Uses SigV4 signing via Web Crypto
 * — no SDK dependency.
 *
 * Env vars (S3_* or R2_* prefix, first found wins):
 *   S3_BUCKET | R2_BUCKET                — required
 *   S3_ACCESS_KEY_ID | R2_ACCESS_KEY_ID  — required
 *   S3_SECRET_ACCESS_KEY | R2_SECRET_ACCESS_KEY — required
 *   S3_ENDPOINT | R2_ENDPOINT            — required (e.g. https://s3.us-east-1.amazonaws.com
 *                                           or https://<acct>.r2.cloudflarestorage.com)
 *   S3_REGION | R2_REGION                — optional, default "auto"
 *   S3_PUBLIC_BASE_URL | R2_PUBLIC_BASE_URL — optional (for public read URLs)
 */

import type { FileUploadProvider } from "@agent-native/core/file-upload";

interface S3Config {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  publicBaseUrl: string | null;
}

function readS3Config(): S3Config | null {
  const env = process.env;
  const bucket = env.S3_BUCKET || env.R2_BUCKET;
  const accessKeyId = env.S3_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY;
  const endpoint = env.S3_ENDPOINT || env.R2_ENDPOINT;
  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) return null;
  return {
    region: env.S3_REGION || env.R2_REGION || "auto",
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint: endpoint.replace(/\/+$/, ""),
    publicBaseUrl:
      (env.S3_PUBLIC_BASE_URL || env.R2_PUBLIC_BASE_URL || "").replace(
        /\/+$/,
        "",
      ) || null,
  };
}

// ── SigV4 helpers (Web Crypto, no SDK) ────────────────────────────────

async function hmac(key: ArrayBuffer, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
}

async function sha256(data: Uint8Array): Promise<string> {
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  const buf = await crypto.subtle.digest("SHA-256", ab);
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
): Promise<ArrayBuffer> {
  const kSecret = new TextEncoder().encode(`AWS4${secret}`);
  const kDate = await hmac(kSecret.buffer as ArrayBuffer, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function rfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

async function putObject(
  cfg: S3Config,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<string> {
  const now = new Date();
  const amzDate =
    now
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, "")
      .slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;

  const hostUrl = new URL(cfg.endpoint);
  const host = hostUrl.host;
  const canonicalUri = `/${cfg.bucket}/${key.split("/").map(rfc3986).join("/")}`;

  const payloadHash = await sha256(body);

  const headers: Record<string, string> = {
    host,
    "content-type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };

  const signedHeaderKeys = Object.keys(headers).sort();
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders =
    signedHeaderKeys.map((k) => `${k}:${headers[k]}`).join("\n") + "\n";

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "", // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const crHash = await sha256(new TextEncoder().encode(canonicalRequest));
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    crHash,
  ].join("\n");

  const signingKey = await deriveSigningKey(
    cfg.secretAccessKey,
    dateStamp,
    cfg.region,
  );
  const signature = toHex(await hmac(signingKey, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${cfg.endpoint}${canonicalUri}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      ...headers,
      Authorization: authorization,
      "Content-Length": String(body.byteLength),
    },
    body: body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength,
    ) as BodyInit,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `S3 PutObject failed (${res.status}): ${text || res.statusText}`,
    );
  }

  return cfg.publicBaseUrl
    ? `${cfg.publicBaseUrl}/${key}`
    : `${cfg.endpoint}/${cfg.bucket}/${key}`;
}

// ── Provider ──────────────────────────────────────────────────────────

export const s3FileUploadProvider: FileUploadProvider = {
  id: "s3",
  name: "S3-compatible storage",
  isConfigured: () => readS3Config() !== null,
  upload: async ({ data, filename, mimeType }) => {
    const cfg = readS3Config();
    if (!cfg) throw new Error("S3 env vars not configured");

    const ext = filename?.split(".").pop() ?? "bin";
    const stamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 10);
    const objectKey = `clips/${stamp}-${rand}.${ext}`;
    const contentType = mimeType || "application/octet-stream";

    const bytes =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(data as unknown as ArrayBuffer);

    const publicUrl = await putObject(cfg, objectKey, bytes, contentType);
    return { url: publicUrl, provider: "s3" };
  },
};
