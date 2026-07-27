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
import { resolveSecret } from "@agent-native/core/server";

interface S3Config {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  publicBaseUrl: string | null;
}

function cleanValue(value: string | null | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

// A hung S3-compatible endpoint (flaky VPN, misconfigured security group that
// accepts the TCP connection but never responds, etc.) would otherwise leave
// finalize-recording — and the request that triggered it — waiting forever.
// PUT gets a generous budget since it uploads the full recording; DELETE is a
// small best-effort cleanup call and can fail fast.
const S3_PUT_TIMEOUT_MS = 120_000;
const S3_DELETE_TIMEOUT_MS = 30_000;
const S3_MULTIPART_MIN_PART_BYTES = 5 * 1024 * 1024;
const S3_MULTIPART_MAX_PARTS = 10_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(
        `S3 request timed out after ${timeoutMs}ms: ${init.method ?? "GET"} ${url}`,
      );
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `S3 request aborted (timeout ${timeoutMs}ms): ${init.method ?? "GET"} ${url}`,
      );
    }
    throw err;
  }
}

function buildS3Config(values: {
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
  region?: string;
  publicBaseUrl?: string;
}): S3Config | null {
  const bucket = cleanValue(values.bucket);
  const accessKeyId = cleanValue(values.accessKeyId);
  const secretAccessKey = cleanValue(values.secretAccessKey);
  const endpoint = cleanValue(values.endpoint);
  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) return null;
  return {
    region: cleanValue(values.region) ?? "auto",
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint: endpoint.replace(/\/+$/, ""),
    publicBaseUrl:
      cleanValue(values.publicBaseUrl)?.replace(/\/+$/, "") ?? null,
  };
}

function readS3EnvConfig(): S3Config | null {
  const env = process.env;
  return buildS3Config({
    bucket: env.S3_BUCKET || env.R2_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY,
    endpoint: env.S3_ENDPOINT || env.R2_ENDPOINT,
    region: env.S3_REGION || env.R2_REGION,
    publicBaseUrl: env.S3_PUBLIC_BASE_URL || env.R2_PUBLIC_BASE_URL,
  });
}

async function resolveS3Secret(primary: string, fallback: string) {
  return (
    cleanValue(await resolveSecret(primary).catch(() => null)) ??
    cleanValue(await resolveSecret(fallback).catch(() => null))
  );
}

async function readS3Config(): Promise<S3Config | null> {
  return buildS3Config({
    bucket: await resolveS3Secret("S3_BUCKET", "R2_BUCKET"),
    accessKeyId: await resolveS3Secret("S3_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID"),
    secretAccessKey: await resolveS3Secret(
      "S3_SECRET_ACCESS_KEY",
      "R2_SECRET_ACCESS_KEY",
    ),
    endpoint: await resolveS3Secret("S3_ENDPOINT", "R2_ENDPOINT"),
    region: await resolveS3Secret("S3_REGION", "R2_REGION"),
    publicBaseUrl: await resolveS3Secret(
      "S3_PUBLIC_BASE_URL",
      "R2_PUBLIC_BASE_URL",
    ),
  });
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

function objectUri(cfg: S3Config, key: string): string {
  return `/${cfg.bucket}/${key.split("/").map(rfc3986).join("/")}`;
}

function canonicalQueryString(query: Record<string, string>): string {
  return Object.entries(query)
    .map(([key, value]) => [rfc3986(key), rfc3986(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const left = leftKey === rightKey ? leftValue : leftKey;
      const right = leftKey === rightKey ? rightValue : rightKey;
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

async function signedS3Request(
  cfg: S3Config,
  key: string,
  options: {
    method: "DELETE" | "GET" | "HEAD" | "POST" | "PUT";
    query?: Record<string, string>;
    body?: Uint8Array;
    contentType?: string;
    timeoutMs: number;
  },
): Promise<Response> {
  const now = new Date();
  const amzDate =
    now
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, "")
      .slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const host = new URL(cfg.endpoint).host;
  const canonicalUri = objectUri(cfg, key);
  const canonicalQuery = canonicalQueryString(options.query ?? {});
  const body = options.body ?? new Uint8Array(0);
  const payloadHash = await sha256(body);

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (options.contentType) headers["content-type"] = options.contentType;

  const signedHeaderKeys = Object.keys(headers).sort();
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders =
    signedHeaderKeys
      .map((header) => `${header}:${headers[header]}`)
      .join("\n") + "\n";
  const canonicalRequest = [
    options.method,
    canonicalUri,
    canonicalQuery,
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

  const url = `${cfg.endpoint}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ""}`;
  return fetchWithTimeout(
    url,
    {
      method: options.method,
      headers: {
        ...headers,
        Authorization: authorization,
        ...(options.body
          ? { "Content-Length": String(options.body.byteLength) }
          : {}),
      },
      ...(options.body
        ? {
            body: options.body.buffer.slice(
              options.body.byteOffset,
              options.body.byteOffset + options.body.byteLength,
            ) as BodyInit,
          }
        : {}),
    },
    options.timeoutMs,
  );
}

async function putObject(
  cfg: S3Config,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<string> {
  const res = await signedS3Request(cfg, key, {
    method: "PUT",
    body,
    contentType,
    timeoutMs: S3_PUT_TIMEOUT_MS,
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

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function decodeUrlPathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function keyFromUrlPrefix(rawUrl: URL, rawBase: string): string | null {
  const base = new URL(withTrailingSlash(rawBase));
  if (rawUrl.origin !== base.origin) return null;
  const basePath = withTrailingSlash(base.pathname);
  if (!rawUrl.pathname.startsWith(basePath)) return null;
  const encodedKey = rawUrl.pathname.slice(basePath.length);
  if (!encodedKey) return null;
  return decodeUrlPathSegment(encodedKey);
}

function objectKeyFromUrl(cfg: S3Config, rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  if (cfg.publicBaseUrl) {
    const key = keyFromUrlPrefix(url, cfg.publicBaseUrl);
    if (key) return key;
  }

  const endpoint = new URL(withTrailingSlash(cfg.endpoint));
  if (url.origin !== endpoint.origin) return null;
  const endpointPath = withTrailingSlash(endpoint.pathname);
  const bucketPath = `${endpointPath}${rfc3986(cfg.bucket)}/`;
  if (!url.pathname.startsWith(bucketPath)) return null;
  const encodedKey = url.pathname.slice(bucketPath.length);
  if (!encodedKey) return null;
  return decodeUrlPathSegment(encodedKey);
}

async function deleteObject(cfg: S3Config, key: string): Promise<void> {
  const res = await signedS3Request(cfg, key, {
    method: "DELETE",
    timeoutMs: S3_DELETE_TIMEOUT_MS,
  });

  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `S3 DeleteObject failed (${res.status}): ${text || res.statusText}`,
    );
  }
}

async function getObject(cfg: S3Config, key: string): Promise<Uint8Array> {
  const res = await signedS3Request(cfg, key, {
    method: "GET",
    timeoutMs: S3_PUT_TIMEOUT_MS,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `S3 GetObject failed (${res.status}): ${text || res.statusText}`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

function xmlElement(xml: string, name: string): string | null {
  const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  if (!match?.[1]) return null;
  return match[1]
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface S3MultipartPart {
  partNumber: number;
  etag: string;
  sizeBytes?: number;
}

interface S3MultipartMeta {
  objectKey: string;
  stagingKey: string;
  mimeType: string;
  maxBytes: number;
  pendingBytes: number;
  parts: S3MultipartPart[];
}

function readMultipartMeta(meta: Record<string, unknown>): S3MultipartMeta {
  const objectKey = typeof meta.objectKey === "string" ? meta.objectKey : "";
  const stagingKey = typeof meta.stagingKey === "string" ? meta.stagingKey : "";
  const mimeType = typeof meta.mimeType === "string" ? meta.mimeType : "";
  const maxBytes =
    typeof meta.maxBytes === "number" &&
    Number.isSafeInteger(meta.maxBytes) &&
    meta.maxBytes > 0
      ? meta.maxBytes
      : -1;
  const pendingBytes =
    typeof meta.pendingBytes === "number" &&
    Number.isSafeInteger(meta.pendingBytes) &&
    meta.pendingBytes >= 0
      ? meta.pendingBytes
      : -1;
  const parts = Array.isArray(meta.parts)
    ? meta.parts.filter(
        (part): part is S3MultipartPart =>
          Boolean(part) &&
          typeof part === "object" &&
          Number.isSafeInteger((part as S3MultipartPart).partNumber) &&
          (part as S3MultipartPart).partNumber >= 1 &&
          (part as S3MultipartPart).partNumber <= S3_MULTIPART_MAX_PARTS &&
          typeof (part as S3MultipartPart).etag === "string" &&
          (part as S3MultipartPart).etag.length > 0 &&
          ((part as S3MultipartPart).sizeBytes === undefined ||
            (Number.isSafeInteger((part as S3MultipartPart).sizeBytes) &&
              (part as S3MultipartPart).sizeBytes! > 0)),
      )
    : [];
  if (
    !objectKey.startsWith("clips/") ||
    !stagingKey.startsWith("clips/.multipart/") ||
    !mimeType ||
    maxBytes < 0 ||
    pendingBytes < 0 ||
    parts.length !== (Array.isArray(meta.parts) ? meta.parts.length : -1)
  ) {
    throw new Error("S3 resumable upload session metadata is invalid");
  }
  return { objectKey, stagingKey, mimeType, maxBytes, pendingBytes, parts };
}

function contentRangeEndExclusive(contentRange: string): number | null {
  const dataRange = contentRange.match(/^bytes (\d+)-(\d+)\/(?:\*|\d+)$/);
  if (dataRange) {
    const start = Number(dataRange[1]);
    const end = Number(dataRange[2]);
    if (
      Number.isSafeInteger(start) &&
      Number.isSafeInteger(end) &&
      start >= 0 &&
      end >= start
    ) {
      return end + 1;
    }
    return null;
  }
  const closeRange = contentRange.match(/^bytes \*\/(\d+)$/);
  if (!closeRange) return null;
  const total = Number(closeRange[1]);
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined = new Uint8Array(left.byteLength + right.byteLength);
  combined.set(left, 0);
  combined.set(right, left.byteLength);
  return combined;
}

async function uploadMultipartPart(
  cfg: S3Config,
  uploadId: string,
  meta: S3MultipartMeta,
  bytes: Uint8Array,
): Promise<S3MultipartPart> {
  const partNumber = meta.parts.length + 1;
  if (partNumber > S3_MULTIPART_MAX_PARTS) {
    throw new Error("S3 multipart upload exceeds the 10,000 part limit");
  }
  const res = await signedS3Request(cfg, meta.objectKey, {
    method: "PUT",
    query: { partNumber: String(partNumber), uploadId },
    body: bytes,
    timeoutMs: S3_PUT_TIMEOUT_MS,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `S3 UploadPart failed (${res.status}): ${text || res.statusText}`,
    );
  }
  const etag = res.headers.get("etag");
  if (!etag) throw new Error("S3 UploadPart did not return an ETag");
  return { partNumber, etag, sizeBytes: bytes.byteLength };
}

function publicObjectUrl(cfg: S3Config, key: string): string {
  return cfg.publicBaseUrl
    ? `${cfg.publicBaseUrl}/${key}`
    : `${cfg.endpoint}/${cfg.bucket}/${key}`;
}

async function verifyCompletedMultipartObject(
  cfg: S3Config,
  meta: S3MultipartMeta,
): Promise<boolean> {
  const res = await signedS3Request(cfg, meta.objectKey, {
    method: "HEAD",
    timeoutMs: S3_DELETE_TIMEOUT_MS,
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `S3 HeadObject failed (${res.status}): ${text || res.statusText}`,
    );
  }

  // New sessions record every uploaded part size, which lets a retry
  // distinguish this completed object from an older object at the same
  // deterministic recording key. Older in-flight sessions did not persist
  // sizes, so object existence remains their only recoverable completion
  // signal.
  const hasAllPartSizes = meta.parts.every(
    (part) => typeof part.sizeBytes === "number",
  );
  if (!hasAllPartSizes) return true;

  const expectedBytes = meta.parts.reduce(
    (total, part) => total + (part.sizeBytes ?? 0),
    0,
  );
  const contentLength = Number(res.headers.get("content-length"));
  return Number.isSafeInteger(contentLength) && contentLength === expectedBytes;
}

export async function deleteS3ObjectByUrl(url: string): Promise<boolean> {
  const cfg = await readS3Config();
  if (!cfg) return false;
  const key = objectKeyFromUrl(cfg, url);
  if (!key) return false;
  await deleteObject(cfg, key);
  return true;
}

// ── Provider ──────────────────────────────────────────────────────────

export const s3FileUploadProvider: FileUploadProvider = {
  id: "s3",
  name: "S3-compatible storage",
  isConfigured: () => readS3EnvConfig() !== null,
  isConfiguredForRequest: async () => (await readS3Config()) !== null,
  upload: async ({ data, filename, mimeType }) => {
    const cfg = await readS3Config();
    if (!cfg) throw new Error("S3 credentials are not configured");

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
  resumable: {
    async startSession(filename, mimeType, maxBytes) {
      const cfg = await readS3Config();
      if (!cfg) throw new Error("S3 credentials are not configured");

      const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
      if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        throw new Error("S3 resumable upload requires a positive byte limit");
      }
      const objectKey = `clips/${safeFilename}`;
      const stagingKey = `clips/.multipart/${safeFilename}.pending`;
      const res = await signedS3Request(cfg, objectKey, {
        method: "POST",
        query: { uploads: "" },
        contentType: mimeType,
        timeoutMs: S3_PUT_TIMEOUT_MS,
      });
      const body = await res.text().catch(() => "");
      if (!res.ok) {
        throw new Error(
          `S3 CreateMultipartUpload failed (${res.status}): ${body || res.statusText}`,
        );
      }
      const uploadId = xmlElement(body, "UploadId");
      if (!uploadId) {
        throw new Error("S3 CreateMultipartUpload did not return an UploadId");
      }
      return {
        sessionId: uploadId,
        meta: {
          objectKey,
          stagingKey,
          mimeType,
          maxBytes,
          pendingBytes: 0,
          parts: [],
        },
      };
    },

    async relayChunk(session, contentRange, bytes) {
      const cfg = await readS3Config();
      if (!cfg) throw new Error("S3 credentials are not configured");
      const meta = readMultipartMeta(session.meta);
      const isFinal = !contentRange.endsWith("/*");
      const rangeEnd = contentRangeEndExclusive(contentRange);
      if (rangeEnd === null) {
        throw new Error(
          "S3 resumable upload received an invalid Content-Range",
        );
      }
      if (rangeEnd > meta.maxBytes) {
        throw new Error(
          `S3 resumable upload exceeds its ${meta.maxBytes} byte limit`,
        );
      }

      let pending: Uint8Array = new Uint8Array(0);
      if (meta.pendingBytes > 0) {
        pending = await getObject(cfg, meta.stagingKey);
        if (pending.byteLength !== meta.pendingBytes) {
          throw new Error(
            `S3 resumable staging object has ${pending.byteLength} bytes; expected ${meta.pendingBytes}`,
          );
        }
      }
      const combined = concatBytes(pending, bytes);

      if (combined.byteLength === 0) {
        return { ok: true, status: 200 };
      }

      if (!isFinal && combined.byteLength < S3_MULTIPART_MIN_PART_BYTES) {
        await putObject(cfg, meta.stagingKey, combined, meta.mimeType);
        return {
          ok: true,
          status: 200,
          updatedMeta: { pendingBytes: combined.byteLength },
        };
      }

      const part = await uploadMultipartPart(
        cfg,
        session.sessionId,
        meta,
        combined,
      );
      return {
        ok: true,
        status: 200,
        updatedMeta: {
          pendingBytes: 0,
          parts: [...meta.parts, part],
        },
      };
    },

    async completeSession(session) {
      const cfg = await readS3Config();
      if (!cfg) throw new Error("S3 credentials are not configured");
      const meta = readMultipartMeta(session.meta);
      if (meta.pendingBytes > 0) {
        throw new Error(
          "S3 multipart upload still has an uncommitted final part",
        );
      }
      if (meta.parts.length === 0) {
        throw new Error("Cannot complete an empty S3 multipart upload");
      }
      const manifest =
        "<CompleteMultipartUpload>" +
        meta.parts
          .map(
            (part) =>
              `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${xmlEscape(part.etag)}</ETag></Part>`,
          )
          .join("") +
        "</CompleteMultipartUpload>";
      const res = await signedS3Request(cfg, meta.objectKey, {
        method: "POST",
        query: { uploadId: session.sessionId },
        body: new TextEncoder().encode(manifest),
        contentType: "application/xml",
        timeoutMs: S3_PUT_TIMEOUT_MS,
      });
      const body = await res.text().catch(() => "");
      if (!res.ok || /<Error(?:\s|>)/.test(body)) {
        // CompleteMultipartUpload is not idempotent at the S3 API level. If
        // completion succeeded but the caller failed while verifying or
        // persisting the URL, its retry receives NoSuchUpload because the
        // upload id has already been consumed. Recover only when the object at
        // this session's deterministic key exists (and, for new sessions, has
        // the exact completed byte length).
        if (
          xmlElement(body, "Code") === "NoSuchUpload" &&
          (await verifyCompletedMultipartObject(cfg, meta))
        ) {
          await deleteObject(cfg, meta.stagingKey).catch((err) => {
            console.warn(
              "[s3-upload] failed to delete multipart staging object:",
              err instanceof Error ? err.message : String(err),
            );
          });
          return publicObjectUrl(cfg, meta.objectKey);
        }
        throw new Error(
          `S3 CompleteMultipartUpload failed (${res.status}): ${body || res.statusText}`,
        );
      }
      await deleteObject(cfg, meta.stagingKey).catch((err) => {
        console.warn(
          "[s3-upload] failed to delete multipart staging object:",
          err instanceof Error ? err.message : String(err),
        );
      });
      return publicObjectUrl(cfg, meta.objectKey);
    },

    async abortSession(session) {
      const cfg = await readS3Config();
      if (!cfg) throw new Error("S3 credentials are not configured");
      const meta = readMultipartMeta(session.meta);
      const abortRes = await signedS3Request(cfg, meta.objectKey, {
        method: "DELETE",
        query: { uploadId: session.sessionId },
        timeoutMs: S3_DELETE_TIMEOUT_MS,
      });
      if (!abortRes.ok && abortRes.status !== 404) {
        const body = await abortRes.text().catch(() => "");
        throw new Error(
          `S3 AbortMultipartUpload failed (${abortRes.status}): ${body || abortRes.statusText}`,
        );
      }
      await deleteObject(cfg, meta.stagingKey).catch((err) => {
        console.warn(
          "[s3-upload] failed to delete aborted multipart staging object:",
          err instanceof Error ? err.message : String(err),
        );
      });
    },
  },
};
