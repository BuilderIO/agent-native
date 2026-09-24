/**
 * Framework-owned S3-compatible object storage provider.
 *
 * The onboarding form writes these keys to scoped secrets. A public base URL
 * is required because chat attachments need stable URLs that remain usable
 * after the request and across later turns in the thread.
 *
 * Config resolution and validation go through the shared, isomorphic
 * `parseS3StorageConfig` (packages/core/src/shared/s3-storage-config.ts) so
 * this provider, the onboarding/Settings form, and the save route can never
 * disagree about what makes a value usable.
 */

import { resolveSecret } from "../server/credential-provider.js";
import {
  S3_STORAGE_KEYS,
  S3_STORAGE_LEGACY_KEYS,
  parseS3StorageConfig,
  s3StorageFieldErrorMessage,
  type S3StorageConfig,
  type S3StorageParseResult,
  type S3StorageValues,
} from "../shared/s3-storage-config.js";
import {
  listFileUploadProviders,
  registerFileUploadProvider,
} from "./registry.js";
import type { FileUploadProvider } from "./types.js";

/** Chat attachments need a stable, publicly-fetchable URL across later turns. */
const S3_REQUIREMENTS = { publicBaseUrl: "required" as const };

function readEnvValues(): S3StorageValues {
  const env = process.env;
  const values: S3StorageValues = {};
  for (const key of S3_STORAGE_KEYS) {
    values[key] = env[key] || env[S3_STORAGE_LEGACY_KEYS[key]];
  }
  return values;
}

async function readScopedValues(): Promise<S3StorageValues> {
  const values: S3StorageValues = {};
  await Promise.all(
    S3_STORAGE_KEYS.map(async (key) => {
      const legacyKey = S3_STORAGE_LEGACY_KEYS[key];
      values[key] =
        (await resolveSecret(key)) ?? (await resolveSecret(legacyKey));
    }),
  );
  return values;
}

/**
 * Resolve the effective config exactly as `upload` does: a usable scoped
 * config wins; otherwise a usable env config; otherwise report whichever
 * side actually had a key set (the scoped errors if the caller was mid-way
 * through configuring scoped secrets, else the env result).
 */
async function resolveConfig(): Promise<S3StorageParseResult> {
  const scopedResult = parseS3StorageConfig(
    await readScopedValues(),
    S3_REQUIREMENTS,
  );
  if (scopedResult.ok) return scopedResult;
  const envResult = parseS3StorageConfig(readEnvValues(), S3_REQUIREMENTS);
  if (envResult.ok) return envResult;
  return scopedResult.empty ? envResult : scopedResult;
}

async function readRequestConfig(): Promise<S3StorageConfig | null> {
  const result = await resolveConfig();
  return result.ok ? result.config : null;
}

/**
 * `parseS3StorageConfig` only returns a null `publicBaseUrl` for "optional"
 * requirements; this provider always requires one, so an `ok:true` result
 * with no public base URL is unreachable. Fail loudly rather than build a
 * broken URL if that invariant is ever violated.
 */
function requirePublicBaseUrl(config: S3StorageConfig): string {
  if (!config.publicBaseUrl) {
    throw new Error("S3 object storage requires a public base URL");
  }
  return config.publicBaseUrl;
}

async function hmac(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message),
  );
}

async function sha256(data: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return toHex(await crypto.subtle.digest("SHA-256", buffer));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function signingKey(
  secret: string,
  dateStamp: string,
  region: string,
): Promise<ArrayBuffer> {
  const dateKey = await hmac(
    new TextEncoder().encode(`AWS4${secret}`).buffer as ArrayBuffer,
    dateStamp,
  );
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function objectPath(config: S3StorageConfig, key: string): string {
  return `/${config.bucket}/${key.split("/").map(encodePathSegment).join("/")}`;
}

async function putObject(
  config: S3StorageConfig,
  key: string,
  data: Uint8Array,
  contentType: string,
): Promise<string> {
  const now = new Date();
  const amzDate =
    now
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, "")
      .slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const host = new URL(config.endpoint).host;
  const canonicalUri = objectPath(config, key);
  const payloadHash = await sha256(data);
  const headers: Record<string, string> = {
    host,
    "content-type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaderKeys = Object.keys(headers).sort();
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders =
    signedHeaderKeys
      .map((header) => `${header}:${headers[header]}`)
      .join("\n") + "\n";
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const requestHash = await sha256(new TextEncoder().encode(canonicalRequest));
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    requestHash,
  ].join("\n");
  const signature = toHex(
    await hmac(
      await signingKey(config.secretAccessKey, dateStamp, config.region),
      stringToSign,
    ),
  );
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`${config.endpoint}${canonicalUri}`, {
    method: "PUT",
    headers: {
      ...headers,
      Authorization: authorization,
      "Content-Length": String(data.byteLength),
    },
    body: data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as BodyInit,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `S3 PutObject failed (${response.status}): ${detail || response.statusText}`,
    );
  }
  return `${requirePublicBaseUrl(config)}/${key.split("/").map(encodePathSegment).join("/")}`;
}

async function deleteObject(
  config: S3StorageConfig,
  key: string,
): Promise<boolean> {
  const now = new Date();
  const amzDate =
    now
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, "")
      .slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const host = new URL(config.endpoint).host;
  const canonicalUri = objectPath(config, key);
  const payloadHash = await sha256(new Uint8Array(0));
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaderKeys = Object.keys(headers).sort();
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders =
    signedHeaderKeys
      .map((header) => `${header}:${headers[header]}`)
      .join("\n") + "\n";
  const canonicalRequest = [
    "DELETE",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const requestHash = await sha256(new TextEncoder().encode(canonicalRequest));
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    requestHash,
  ].join("\n");
  const signature = toHex(
    await hmac(
      await signingKey(config.secretAccessKey, dateStamp, config.region),
      stringToSign,
    ),
  );
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`${config.endpoint}${canonicalUri}`, {
    method: "DELETE",
    headers: { ...headers, Authorization: authorization },
  });
  if (response.ok) return true;
  if (response.status === 404) return false;
  const detail = await response.text();
  throw new Error(
    `S3 DeleteObject failed (${response.status}): ${detail || response.statusText}`,
  );
}

function safeFilename(filename: string | undefined): string {
  const basename = filename?.split(/[\\/]/).pop()?.trim() || "attachment";
  return (
    basename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "attachment"
  );
}

export const s3FileUploadProvider: FileUploadProvider = {
  id: "s3",
  name: "S3-compatible object storage",
  isConfigured: () => parseS3StorageConfig(readEnvValues(), S3_REQUIREMENTS).ok,
  isConfiguredForRequest: async () => (await readRequestConfig()) !== null,
  isOwnedUrl: async (value) => {
    const config = await readRequestConfig();
    if (!config?.publicBaseUrl) return false;
    try {
      const url = new URL(value);
      const publicUrl = new URL(config.publicBaseUrl);
      const basePath = publicUrl.pathname.replace(/\/+$/, "");
      return (
        url.origin === publicUrl.origin &&
        (basePath === "" ||
          url.pathname === basePath ||
          url.pathname.startsWith(`${basePath}/`))
      );
    } catch {
      // coercion-ok: malformed URLs are an explicit not-owned result.
      return false;
    }
  },
  s3: {
    requirements: S3_REQUIREMENTS,
    inspect: resolveConfig,
  },
  upload: async ({ data, filename, mimeType }) => {
    const result = await resolveConfig();
    if (!result.ok) {
      throw new Error(
        `S3 object storage is not configured: ${result.errors
          .map(s3StorageFieldErrorMessage)
          .join(" ")}`,
      );
    }
    const config = result.config;
    const key = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeFilename(filename)}`;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const url = await putObject(
      config,
      key,
      bytes,
      mimeType || "application/octet-stream",
    );
    return { url, id: key, provider: "s3" };
  },
  delete: async ({ id }) => {
    if (!id) return false;
    const config = await readRequestConfig();
    if (!config) return false;
    return deleteObject(config, id);
  },
};

/**
 * Put the built-in provider in the `s3` slot unless something already holds it.
 *
 * An app may register its own implementation under the same conventional id —
 * the plugin comment in `core-routes-plugin.ts` says so — and that explicit
 * registration has to survive every later bootstrap that reaches this code, in
 * whatever order they run. Callers that want to *replace* the slot call
 * `registerFileUploadProvider` directly.
 */
export function ensureS3FileUploadProvider(): void {
  if (
    listFileUploadProviders().some(
      (provider) => provider.id === s3FileUploadProvider.id,
    )
  ) {
    return;
  }
  registerFileUploadProvider(s3FileUploadProvider);
}
