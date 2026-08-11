/**
 * Framework-owned S3-compatible object storage provider.
 *
 * The onboarding form writes these keys to scoped secrets. A public base URL
 * is required because chat attachments need stable URLs that remain usable
 * after the request and across later turns in the thread.
 */

import { resolveSecret } from "../server/credential-provider.js";
import type { FileUploadProvider } from "./types.js";

interface S3Config {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  publicBaseUrl: string;
}

function cleanValue(value: string | null | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function buildConfig(values: {
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
  const endpoint = cleanValue(values.endpoint)?.replace(/\/+$/, "");
  const publicBaseUrl = cleanValue(values.publicBaseUrl)?.replace(/\/+$/, "");
  if (
    !bucket ||
    !accessKeyId ||
    !secretAccessKey ||
    !endpoint ||
    !publicBaseUrl
  ) {
    return null;
  }

  if (!URL.canParse(endpoint) || !URL.canParse(publicBaseUrl)) {
    return null;
  }
  const endpointUrl = new URL(endpoint);
  const publicUrl = new URL(publicBaseUrl);
  if (
    !["http:", "https:"].includes(endpointUrl.protocol) ||
    !["http:", "https:"].includes(publicUrl.protocol)
  ) {
    return null;
  }

  return {
    region: cleanValue(values.region) ?? "auto",
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint,
    publicBaseUrl,
  };
}

function readEnvConfig(): S3Config | null {
  const env = process.env;
  return buildConfig({
    bucket: env.S3_BUCKET || env.R2_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY,
    endpoint: env.S3_ENDPOINT || env.R2_ENDPOINT,
    region: env.S3_REGION || env.R2_REGION,
    publicBaseUrl: env.S3_PUBLIC_BASE_URL || env.R2_PUBLIC_BASE_URL,
  });
}

async function resolveStorageSecret(
  primary: string,
  fallback: string,
): Promise<string | undefined> {
  const primaryValue = cleanValue(await resolveSecret(primary));
  return primaryValue ?? cleanValue(await resolveSecret(fallback));
}

async function readRequestConfig(): Promise<S3Config | null> {
  const scopedConfig = buildConfig({
    bucket: await resolveStorageSecret("S3_BUCKET", "R2_BUCKET"),
    accessKeyId: await resolveStorageSecret(
      "S3_ACCESS_KEY_ID",
      "R2_ACCESS_KEY_ID",
    ),
    secretAccessKey: await resolveStorageSecret(
      "S3_SECRET_ACCESS_KEY",
      "R2_SECRET_ACCESS_KEY",
    ),
    endpoint: await resolveStorageSecret("S3_ENDPOINT", "R2_ENDPOINT"),
    region: await resolveStorageSecret("S3_REGION", "R2_REGION"),
    publicBaseUrl: await resolveStorageSecret(
      "S3_PUBLIC_BASE_URL",
      "R2_PUBLIC_BASE_URL",
    ),
  });
  return scopedConfig ?? readEnvConfig();
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

function objectPath(config: S3Config, key: string): string {
  return `/${config.bucket}/${key.split("/").map(encodePathSegment).join("/")}`;
}

async function putObject(
  config: S3Config,
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
  return `${config.publicBaseUrl}/${key.split("/").map(encodePathSegment).join("/")}`;
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
  isConfigured: () => readEnvConfig() !== null,
  isConfiguredForRequest: async () => (await readRequestConfig()) !== null,
  upload: async ({ data, filename, mimeType }) => {
    const config = await readRequestConfig();
    if (!config) {
      throw new Error(
        "S3 object storage requires a bucket, endpoint, credentials, and public base URL",
      );
    }
    const key = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeFilename(filename)}`;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const url = await putObject(
      config,
      key,
      bytes,
      mimeType || "application/octet-stream",
    );
    return { url, provider: "s3" };
  },
};
