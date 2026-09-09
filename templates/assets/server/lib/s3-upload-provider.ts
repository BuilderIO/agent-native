/**
 * S3-compatible file upload provider for the Assets template.
 *
 * Mirrors the clips template's provider but reads `ASSETS_STORAGE_*` env vars
 * first (with legacy `IMAGES_STORAGE_*` and `S3_*` fallbacks) so an
 * assets-only deploy can configure storage
 * without leaking into other apps' env. SigV4 signing via Web Crypto — no SDK.
 *
 * Env vars (first found wins, ASSETS_STORAGE_* preferred):
 *   ASSETS_STORAGE_BUCKET | IMAGES_STORAGE_BUCKET | S3_BUCKET — required
 *   ASSETS_STORAGE_ACCESS_KEY_ID | IMAGES_STORAGE_ACCESS_KEY_ID | S3_ACCESS_KEY_ID — required
 *   ASSETS_STORAGE_SECRET_ACCESS_KEY | IMAGES_STORAGE_SECRET_ACCESS_KEY | S3_SECRET_ACCESS_KEY — required
 *   ASSETS_STORAGE_ENDPOINT | IMAGES_STORAGE_ENDPOINT | S3_ENDPOINT — required
 *   ASSETS_STORAGE_REGION | IMAGES_STORAGE_REGION | S3_REGION — optional, default "auto"
 *   ASSETS_STORAGE_PUBLIC_BASE_URL | IMAGES_STORAGE_PUBLIC_BASE_URL | S3_PUBLIC_BASE_URL — optional
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

const S3_STORAGE_PREFIX = "s3:";

export function s3StorageKey(objectKey: string): string {
  return `${S3_STORAGE_PREFIX}${objectKey}`;
}

export function isS3StorageKey(key: string): boolean {
  return key.startsWith(S3_STORAGE_PREFIX);
}

function objectKeyFromStorageKey(key: string): string {
  return isS3StorageKey(key) ? key.slice(S3_STORAGE_PREFIX.length) : key;
}

function readS3Config(): S3Config | null {
  const env = process.env;
  const bucket =
    env.ASSETS_STORAGE_BUCKET || env.IMAGES_STORAGE_BUCKET || env.S3_BUCKET;
  const accessKeyId =
    env.ASSETS_STORAGE_ACCESS_KEY_ID ||
    env.IMAGES_STORAGE_ACCESS_KEY_ID ||
    env.S3_ACCESS_KEY_ID;
  const secretAccessKey =
    env.ASSETS_STORAGE_SECRET_ACCESS_KEY ||
    env.IMAGES_STORAGE_SECRET_ACCESS_KEY ||
    env.S3_SECRET_ACCESS_KEY;
  const endpoint =
    env.ASSETS_STORAGE_ENDPOINT ||
    env.IMAGES_STORAGE_ENDPOINT ||
    env.S3_ENDPOINT;
  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) return null;
  return {
    region:
      env.ASSETS_STORAGE_REGION ||
      env.IMAGES_STORAGE_REGION ||
      env.S3_REGION ||
      "auto",
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint: endpoint.replace(/\/+$/, ""),
    publicBaseUrl:
      (
        env.ASSETS_STORAGE_PUBLIC_BASE_URL ||
        env.IMAGES_STORAGE_PUBLIC_BASE_URL ||
        env.S3_PUBLIC_BASE_URL ||
        ""
      ).replace(/\/+$/, "") || null,
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

  return key;
}

function publicObjectUrl(cfg: S3Config, key: string): string | null {
  if (!cfg.publicBaseUrl) return null;
  return `${cfg.publicBaseUrl}/${key.split("/").map(rfc3986).join("/")}`;
}

function canonicalObjectUri(cfg: S3Config, key: string): string {
  return `/${cfg.bucket}/${key.split("/").map(rfc3986).join("/")}`;
}

function s3Timestamp() {
  const amzDate =
    new Date()
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, "")
      .slice(0, 15) + "Z";
  return {
    amzDate,
    dateStamp: amzDate.slice(0, 8),
  };
}

async function authorizationHeader(input: {
  cfg: S3Config;
  method: "GET" | "PUT";
  key: string;
  headers: Record<string, string>;
  payloadHash: string;
  query?: string;
  dateStamp: string;
  amzDate: string;
}): Promise<string> {
  const credentialScope = `${input.dateStamp}/${input.cfg.region}/s3/aws4_request`;
  const signedHeaderKeys = Object.keys(input.headers).sort();
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders =
    signedHeaderKeys.map((k) => `${k}:${input.headers[k]}`).join("\n") + "\n";
  const canonicalRequest = [
    input.method,
    canonicalObjectUri(input.cfg, input.key),
    input.query ?? "",
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const crHash = await sha256(new TextEncoder().encode(canonicalRequest));
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    input.amzDate,
    credentialScope,
    crHash,
  ].join("\n");
  const signingKey = await deriveSigningKey(
    input.cfg.secretAccessKey,
    input.dateStamp,
    input.cfg.region,
  );
  const signature = toHex(await hmac(signingKey, stringToSign));
  return (
    `AWS4-HMAC-SHA256 Credential=${input.cfg.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  );
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? leftValue.localeCompare(rightValue)
        : leftKey.localeCompare(rightKey),
    )
    .map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`)
    .join("&");
}

export async function getS3Object(key: string): Promise<Buffer> {
  const cfg = readS3Config();
  if (!cfg) throw new Error("S3 env vars not configured");
  const objectKey = objectKeyFromStorageKey(key);
  const { amzDate, dateStamp } = s3Timestamp();
  const hostUrl = new URL(cfg.endpoint);
  const headers: Record<string, string> = {
    host: hostUrl.host,
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    "x-amz-date": amzDate,
  };
  const authorization = await authorizationHeader({
    cfg,
    method: "GET",
    key: objectKey,
    headers,
    payloadHash: "UNSIGNED-PAYLOAD",
    dateStamp,
    amzDate,
  });
  const res = await fetch(
    `${cfg.endpoint}${canonicalObjectUri(cfg, objectKey)}`,
    {
      headers: {
        ...headers,
        Authorization: authorization,
      },
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `S3 GetObject failed (${res.status}): ${text || res.statusText}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function getPresignedS3ObjectUrl(
  key: string,
  expiresIn = 60 * 30,
): Promise<{ url: string; expiresAt: string }> {
  const cfg = readS3Config();
  if (!cfg) throw new Error("S3 env vars not configured");
  const objectKey = objectKeyFromStorageKey(key);
  const publicUrl = publicObjectUrl(cfg, objectKey);
  if (publicUrl) {
    return {
      url: publicUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  const { amzDate, dateStamp } = s3Timestamp();
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  });
  const query = canonicalQuery(params);
  const hostUrl = new URL(cfg.endpoint);
  const canonicalRequest = [
    "GET",
    canonicalObjectUri(cfg, objectKey),
    query,
    `host:${hostUrl.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
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
  params.set("X-Amz-Signature", toHex(await hmac(signingKey, stringToSign)));
  return {
    url: `${cfg.endpoint}${canonicalObjectUri(cfg, objectKey)}?${canonicalQuery(
      params,
    )}`,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
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
    const objectKey = `assets/${stamp}-${rand}.${ext}`;
    const contentType = mimeType || "application/octet-stream";

    const bytes =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(data as unknown as ArrayBuffer);

    await putObject(cfg, objectKey, bytes, contentType);
    const publicUrl =
      publicObjectUrl(cfg, objectKey) ??
      (await getPresignedS3ObjectUrl(objectKey)).url;
    return { url: publicUrl, id: objectKey, provider: "s3" };
  },
};
