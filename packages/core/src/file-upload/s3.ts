import {
  assertCredentialStoreReadable,
  prefetchSecrets,
  resolveSecretDetailed,
  type ResolvedSecretDetail,
} from "../server/credential-provider.js";
import {
  listFileUploadProviders,
  registerFileUploadProvider,
} from "./registry.js";
import {
  cancelS3ResponseBody,
  readS3ErrorText,
  rfc3986,
  signedS3Request,
} from "./s3-client.js";
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
  bucket?: string | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  endpoint?: string | undefined;
  region?: string | undefined;
  publicBaseUrl?: string | undefined;
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

const STORAGE_SECRET_KEYS = [
  "S3_BUCKET",
  "R2_BUCKET",
  "S3_ACCESS_KEY_ID",
  "R2_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "R2_SECRET_ACCESS_KEY",
  "S3_ENDPOINT",
  "R2_ENDPOINT",
  "S3_REGION",
  "R2_REGION",
  "S3_PUBLIC_BASE_URL",
  "R2_PUBLIC_BASE_URL",
] as const;

/**
 * The storage a user, org or workspace saved for this request, read only
 * from the place that saved the bucket. Mixing places field by field could
 * send the deployment's keys to an endpoint a workspace saved, so a gap, or a
 * setting saved anywhere else, leaves no saved config.
 */
async function readSavedConfig(): Promise<S3Config | null> {
  const found = new Map<string, ResolvedSecretDetail>();
  await Promise.all(
    STORAGE_SECRET_KEYS.map(async (key) => {
      const detail = await resolveSecretDetailed(key);
      // A self-hosted runtime answers a failed lookup with the env value,
      // which could stand in for a bucket the workspace saved.
      assertCredentialStoreReadable(detail);
      if (cleanValue(detail.value)) found.set(key, detail);
    }),
  );
  const saved = (detail: ResolvedSecretDetail | undefined) =>
    detail !== undefined && detail.source !== "env";
  const bucket = [found.get("S3_BUCKET"), found.get("R2_BUCKET")].find(saved);
  if (!bucket) return null;
  const fromBucketPlace = (detail: ResolvedSecretDetail | undefined) =>
    detail !== undefined &&
    detail.source === bucket.source &&
    detail.scopeId === bucket.scopeId;
  if (
    [...found.values()].some(
      (detail) => saved(detail) && !fromBucketPlace(detail),
    )
  ) {
    return null;
  }
  const value = (primary: string, fallback: string) =>
    [found.get(primary), found.get(fallback)].find(fromBucketPlace)?.value ??
    undefined;
  return buildConfig({
    bucket: value("S3_BUCKET", "R2_BUCKET"),
    accessKeyId: value("S3_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID"),
    secretAccessKey: value("S3_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY"),
    endpoint: value("S3_ENDPOINT", "R2_ENDPOINT"),
    region: value("S3_REGION", "R2_REGION"),
    publicBaseUrl: value("S3_PUBLIC_BASE_URL", "R2_PUBLIC_BASE_URL"),
  });
}

/** Saved storage when complete, else the deployment's, never a mix. */
async function readRequestConfig(): Promise<S3Config | null> {
  await prefetchSecrets(STORAGE_SECRET_KEYS);
  return (await readSavedConfig()) ?? readEnvConfig();
}

const PUT_TIMEOUT_MS = 120_000;
const DELETE_TIMEOUT_MS = 30_000;

function encodeKey(key: string): string {
  return key.split("/").map(rfc3986).join("/");
}

async function putObject(
  config: S3Config,
  key: string,
  data: Uint8Array,
  contentType: string,
): Promise<string> {
  const response = await signedS3Request(config, key, {
    method: "PUT",
    body: data,
    contentType,
    timeoutMs: PUT_TIMEOUT_MS,
  });
  if (!response.ok) {
    const detail = await readS3ErrorText(response);
    throw new Error(
      `S3 PutObject failed (${response.status}): ${detail || response.statusText}`,
    );
  }
  await cancelS3ResponseBody(response);
  return `${config.publicBaseUrl}/${encodeKey(key)}`;
}

async function deleteObject(config: S3Config, key: string): Promise<boolean> {
  const response = await signedS3Request(config, key, {
    method: "DELETE",
    timeoutMs: DELETE_TIMEOUT_MS,
  });
  if (response.ok || response.status === 404) {
    await cancelS3ResponseBody(response);
    return true;
  }
  const detail = await readS3ErrorText(response);
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
  isConfigured: () => readEnvConfig() !== null,
  isConfiguredForRequest: async () => (await readRequestConfig()) !== null,
  isOwnedUrl: async (value) => {
    const config = await readRequestConfig();
    if (!config) return false;
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
    return { url, id: key, provider: "s3" };
  },
  delete: async ({ id }) => {
    if (!id) return false;
    const config = await readRequestConfig();
    if (!config) return false;
    return deleteObject(config, id);
  },
};

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
