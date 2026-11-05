import {
  cancelS3ResponseBody,
  presignS3GetUrl,
  readS3ErrorText,
  rfc3986,
  signedS3Request,
  type FileUploadProvider,
} from "@agent-native/core/file-upload";

interface S3Config {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  publicBaseUrl: string | null;
}

const S3_STORAGE_PREFIX = "s3:";
const S3_TIMEOUT_MS = 120_000;

export function s3StorageKey(objectKey: string): string {
  return `${S3_STORAGE_PREFIX}${objectKey}`;
}

export function isS3StorageKey(key: string): boolean {
  return key.startsWith(S3_STORAGE_PREFIX);
}

function objectKeyFromStorageKey(key: string): string {
  return isS3StorageKey(key) ? key.slice(S3_STORAGE_PREFIX.length) : key;
}

/**
 * Reads only the deployment's env, never workspace settings, so every request
 * and link below passes `trustedEndpoint`: a self-hosted MinIO on a private
 * network or plain HTTP is the deployment's own choice.
 */
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

async function putObject(
  cfg: S3Config,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const res = await signedS3Request(cfg, key, {
    method: "PUT",
    body,
    contentType,
    timeoutMs: S3_TIMEOUT_MS,
    trustedEndpoint: true,
  });

  if (!res.ok) {
    const text = await readS3ErrorText(res);
    throw new Error(
      `S3 PutObject failed (${res.status}): ${text || res.statusText}`,
    );
  }
  await cancelS3ResponseBody(res);
}

function publicObjectUrl(cfg: S3Config, key: string): string | null {
  if (!cfg.publicBaseUrl) return null;
  return `${cfg.publicBaseUrl}/${key.split("/").map(rfc3986).join("/")}`;
}

export async function getS3Object(key: string): Promise<Buffer> {
  const cfg = readS3Config();
  if (!cfg) throw new Error("S3 env vars not configured");
  const res = await signedS3Request(cfg, objectKeyFromStorageKey(key), {
    method: "GET",
    timeoutMs: S3_TIMEOUT_MS,
    trustedEndpoint: true,
  });
  if (!res.ok) {
    const text = await readS3ErrorText(res);
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

  return {
    url: await presignS3GetUrl(cfg, objectKey, {
      expiresInSeconds: expiresIn,
      trustedEndpoint: true,
    }),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

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
