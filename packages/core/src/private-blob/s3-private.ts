/**
 * Private-blob providers backed by S3-compatible buckets.
 *
 * - `s3-private` stores blobs in the workspace's own bucket (Settings → File
 *   uploads, or `S3_*` env vars). A public URL is optional. When the bucket
 *   has one, anyone who learns an object key could read it there, so blobs
 *   are encrypted and never handed out as direct links.
 * - `hosted-private` stores blobs in the deployment's hosted private bucket
 *   (`hostedStorage`) when the workspace has no bucket of its own.
 *
 * Each handle records, encrypted, where its object lives and which credential
 * scope reads it. A reader without the owner's request context (an anonymous
 * viewer of a public page, a background job) still reads the right bucket,
 * and a tampered handle can't point at another workspace's object.
 */

import { randomUUID } from "node:crypto";

import { resolveHostedStorageConfig } from "../app-config/hosted-storage.js";
import { getAppConfig } from "../app-config/index.js";
import {
  cancelS3ResponseBody,
  presignS3GetUrl,
  signedS3Request,
  type S3ClientConfig,
} from "../file-upload/s3-client.js";
import { decryptSecretValue, encryptSecretValue } from "../secrets/crypto.js";
import type { SecretScope } from "../secrets/register.js";
import { readAppSecrets } from "../secrets/storage.js";
import {
  canUseDeployCredentialFallbackForRequest,
  resolveSecretDetailed,
} from "../server/credential-provider.js";
import {
  decryptBlobBytes,
  encryptBlobBytes,
  type BlobEncryptionParams,
} from "./blob-crypto.js";
import { PrivateBlobError, PrivateBlobRangeError } from "./errors.js";
import {
  registerPrivateBlobProvider,
  listPrivateBlobProviders,
} from "./registry.js";
import type {
  PrivateBlobByteRange,
  PrivateBlobHandle,
  PrivateBlobProvider,
  PrivateBlobPutInput,
  PrivateBlobRangeReadResult,
  PrivateBlobReadResult,
} from "./types.js";

export const S3_PRIVATE_BLOB_PROVIDER_ID = "s3-private";
export const HOSTED_PRIVATE_BLOB_PROVIDER_ID = "hosted-private";

const HANDLE_PREFIX = "s3:v1:";
const OBJECT_KEY_PREFIX = "private-blobs";
const PUT_TIMEOUT_MS = 120_000;
const GET_TIMEOUT_MS = 120_000;
const DELETE_TIMEOUT_MS = 30_000;

type CredentialSource =
  | { kind: "env" }
  | { kind: "secret"; scope: SecretScope; scopeId: string }
  | { kind: "hosted" };

interface BucketConfig extends S3ClientConfig {
  publicBaseUrl: string | null;
}

interface ResolvedBucket {
  config: BucketConfig;
  source: CredentialSource;
}

interface S3BlobDescriptor {
  kind: "agent-native.private-blob.s3";
  version: 1;
  source: CredentialSource;
  endpoint: string;
  bucket: string;
  region: string;
  key: string;
  encryption?: BlobEncryptionParams;
}

const STORAGE_KEYS = {
  bucket: ["S3_BUCKET", "R2_BUCKET"],
  accessKeyId: ["S3_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID"],
  secretAccessKey: ["S3_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY"],
  endpoint: ["S3_ENDPOINT", "R2_ENDPOINT"],
  region: ["S3_REGION", "R2_REGION"],
  publicBaseUrl: ["S3_PUBLIC_BASE_URL", "R2_PUBLIC_BASE_URL"],
} as const;

type StorageField = keyof typeof STORAGE_KEYS;

function cleanValue(value: string | null | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function buildBucketConfig(
  read: (key: string) => string | undefined,
): BucketConfig | null {
  const value = (field: StorageField) => {
    const [primary, legacy] = STORAGE_KEYS[field];
    return cleanValue(read(primary)) ?? cleanValue(read(legacy));
  };
  const bucket = value("bucket");
  const accessKeyId = value("accessKeyId");
  const secretAccessKey = value("secretAccessKey");
  const endpoint = value("endpoint")?.replace(/\/+$/, "");
  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) return null;
  if (!URL.canParse(endpoint)) return null;
  if (!["http:", "https:"].includes(new URL(endpoint).protocol)) return null;
  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint,
    region: value("region") ?? "auto",
    publicBaseUrl: value("publicBaseUrl")?.replace(/\/+$/, "") ?? null,
  };
}

function readEnvBucketConfig(): BucketConfig | null {
  return buildBucketConfig((key) => process.env[key]);
}

async function readScopedBucketConfig(
  scope: SecretScope,
  scopeId: string,
): Promise<BucketConfig | null> {
  const secrets = await readAppSecrets({
    keys: Object.values(STORAGE_KEYS).flat(),
    scope,
    scopeId,
  });
  return buildBucketConfig((key) => secrets.get(key)?.value);
}

/**
 * The bucket this request stores new blobs in: the scope that holds its
 * bucket setting (user, org or workspace), else the deployment's env vars
 * when this request may use them.
 */
async function resolveRequestBucket(): Promise<ResolvedBucket | null> {
  let detail = await resolveSecretDetailed(STORAGE_KEYS.bucket[0]);
  if (!detail.value)
    detail = await resolveSecretDetailed(STORAGE_KEYS.bucket[1]);
  if (!detail.value) return null;
  if (detail.source === "env" || !detail.source || !detail.scopeId) {
    const config = readEnvBucketConfig();
    return config ? { config, source: { kind: "env" } } : null;
  }
  const config = await readScopedBucketConfig(detail.source, detail.scopeId);
  return config
    ? {
        config,
        source: {
          kind: "secret",
          scope: detail.source,
          scopeId: detail.scopeId,
        },
      }
    : null;
}

function readHostedBucketConfig(options: {
  forExistingObject: boolean;
}): BucketConfig | null {
  const hostedStorage = getAppConfig().hostedStorage;
  // The flag gates new blobs; blobs already stored still need the bucket's
  // credentials to be read and deleted after it is turned off.
  const resolved = resolveHostedStorageConfig(
    options.forExistingObject
      ? { ...hostedStorage, enabled: true }
      : hostedStorage,
  );
  return resolved ? { ...resolved, publicBaseUrl: null } : null;
}

async function readCredentialsForSource(
  source: CredentialSource,
): Promise<BucketConfig | null> {
  if (source.kind === "env") return readEnvBucketConfig();
  if (source.kind === "hosted") {
    return readHostedBucketConfig({ forExistingObject: true });
  }
  return readScopedBucketConfig(source.scope, source.scopeId);
}

function encodeDescriptor(descriptor: S3BlobDescriptor): string {
  return `${HANDLE_PREFIX}${encryptSecretValue(JSON.stringify(descriptor))}`;
}

function decodeDescriptor(handle: PrivateBlobHandle): S3BlobDescriptor {
  if (!handle.id.startsWith(HANDLE_PREFIX)) {
    throw new PrivateBlobError(
      "Private blob handle is not an S3 handle",
      "corrupt",
    );
  }
  let descriptor: S3BlobDescriptor;
  try {
    descriptor = JSON.parse(
      decryptSecretValue(handle.id.slice(HANDLE_PREFIX.length)),
    ) as S3BlobDescriptor;
  } catch (error) {
    throw new PrivateBlobError(
      "Private blob handle descriptor could not be decrypted",
      "corrupt",
      { cause: error },
    );
  }
  if (
    descriptor?.kind !== "agent-native.private-blob.s3" ||
    descriptor.version !== 1 ||
    typeof descriptor.key !== "string" ||
    typeof descriptor.bucket !== "string" ||
    typeof descriptor.endpoint !== "string" ||
    typeof descriptor.region !== "string" ||
    !descriptor.key.startsWith(`${OBJECT_KEY_PREFIX}/`)
  ) {
    throw new PrivateBlobError(
      "Private blob handle descriptor is invalid",
      "corrupt",
    );
  }
  return descriptor;
}

async function clientConfigFor(
  descriptor: S3BlobDescriptor,
): Promise<S3ClientConfig> {
  const credentials = await readCredentialsForSource(descriptor.source);
  if (!credentials) {
    throw new PrivateBlobError(
      "The storage that holds this private blob is no longer configured",
      "not_configured",
    );
  }
  return {
    endpoint: descriptor.endpoint,
    bucket: descriptor.bucket,
    region: descriptor.region,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
  };
}

function failureKindForStatus(status: number) {
  if (status === 404) return "not_found" as const;
  if (status === 410) return "gone" as const;
  return "unavailable" as const;
}

async function readFailure(response: Response, action: string) {
  const detail = await response.text().catch(() => "");
  return new PrivateBlobError(
    `S3 ${action} failed (${response.status}): ${detail.slice(0, 300) || response.statusText}`,
    failureKindForStatus(response.status),
    { status: response.status },
  );
}

function toBytes(data: Uint8Array | Buffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

async function putBlob(
  providerId: string,
  bucket: ResolvedBucket,
  input: PrivateBlobPutInput,
): Promise<PrivateBlobHandle> {
  const bytes = toBytes(input.data);
  // A bucket with a public URL serves any key it is asked for, so its blobs
  // are stored encrypted.
  const encrypted = bucket.config.publicBaseUrl
    ? encryptBlobBytes(bytes)
    : null;
  const key = `${OBJECT_KEY_PREFIX}/${randomUUID()}`;
  const response = await signedS3Request(bucket.config, key, {
    method: "PUT",
    body: encrypted?.ciphertext ?? bytes,
    contentType: encrypted
      ? "application/octet-stream"
      : input.mimeType || "application/octet-stream",
    timeoutMs: PUT_TIMEOUT_MS,
  });
  if (!response.ok) throw await readFailure(response, "PutObject");
  await cancelS3ResponseBody(response);

  const descriptor: S3BlobDescriptor = {
    kind: "agent-native.private-blob.s3",
    version: 1,
    source: bucket.source,
    endpoint: bucket.config.endpoint,
    bucket: bucket.config.bucket,
    region: bucket.config.region,
    key,
    ...(encrypted
      ? { encryption: { iv: encrypted.iv, tag: encrypted.tag } }
      : {}),
  };
  return {
    id: encodeDescriptor(descriptor),
    provider: providerId,
    opaque: true,
    encrypted: Boolean(encrypted),
    mimeType: input.mimeType,
    size: bytes.byteLength,
    createdAt: new Date().toISOString(),
    metadata: input.metadata,
  };
}

async function readBlob(
  handle: PrivateBlobHandle,
): Promise<PrivateBlobReadResult> {
  const descriptor = decodeDescriptor(handle);
  const response = await signedS3Request(
    await clientConfigFor(descriptor),
    descriptor.key,
    { method: "GET", timeoutMs: GET_TIMEOUT_MS },
  );
  if (!response.ok) throw await readFailure(response, "GetObject");
  const stored = new Uint8Array(await response.arrayBuffer());
  return {
    data: descriptor.encryption
      ? decryptBlobBytes(descriptor.encryption, stored)
      : stored,
    mimeType: handle.mimeType,
    metadata: handle.metadata,
    handle,
  };
}

function parseContentRange(
  value: string | null,
): { start: number; end: number; size: number } | null {
  const match = value?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    size: Number(match[3]),
  };
}

function unsatisfiableSize(value: string | null): number | undefined {
  const match = value?.match(/^bytes \*\/(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

function sliceRange(
  result: PrivateBlobReadResult,
  range: PrivateBlobByteRange,
): PrivateBlobRangeReadResult {
  const size = result.data.byteLength;
  if (range.start >= size) {
    throw new PrivateBlobRangeError(
      "Private blob byte range starts past the end",
      size,
    );
  }
  const end = Math.min(range.end ?? size - 1, size - 1);
  return {
    ...result,
    data: result.data.subarray(range.start, end + 1),
    range: { start: range.start, end, size },
  };
}

async function readBlobRange(
  handle: PrivateBlobHandle,
  range: PrivateBlobByteRange,
): Promise<PrivateBlobRangeReadResult> {
  const descriptor = decodeDescriptor(handle);
  // Encrypted objects are one GCM message, so they decrypt only whole.
  if (descriptor.encryption) return sliceRange(await readBlob(handle), range);

  const response = await signedS3Request(
    await clientConfigFor(descriptor),
    descriptor.key,
    {
      method: "GET",
      range: `bytes=${range.start}-${range.end ?? ""}`,
      timeoutMs: GET_TIMEOUT_MS,
    },
  );
  if (response.status === 416) {
    const size = unsatisfiableSize(response.headers.get("content-range"));
    await cancelS3ResponseBody(response);
    throw new PrivateBlobRangeError(
      "Private blob byte range starts past the end",
      size,
    );
  }
  if (!response.ok) throw await readFailure(response, "GetObject");
  const data = new Uint8Array(await response.arrayBuffer());
  const base = {
    mimeType: handle.mimeType,
    metadata: handle.metadata,
    handle,
  };
  if (response.status === 206) {
    const returned = parseContentRange(response.headers.get("content-range"));
    if (!returned || returned.end - returned.start + 1 !== data.byteLength) {
      throw new PrivateBlobError(
        "S3 returned a partial object without a matching Content-Range",
        "unavailable",
        { status: response.status },
      );
    }
    return { ...base, data, range: returned };
  }
  // The store ignored the Range header and sent the whole object.
  return sliceRange({ ...base, data }, range);
}

async function deleteBlob(providerId: string, handle: PrivateBlobHandle) {
  const descriptor = decodeDescriptor(handle);
  const response = await signedS3Request(
    await clientConfigFor(descriptor),
    descriptor.key,
    { method: "DELETE", timeoutMs: DELETE_TIMEOUT_MS },
  );
  if (!response.ok && response.status !== 404) {
    throw await readFailure(response, "DeleteObject");
  }
  await cancelS3ResponseBody(response);
  return { deleted: true, provider: providerId };
}

async function readUrlFor(
  handle: PrivateBlobHandle,
  options: Parameters<NonNullable<PrivateBlobProvider["getReadUrl"]>>[1],
) {
  const descriptor = decodeDescriptor(handle);
  if (descriptor.encryption) return null;
  const now = new Date();
  const url = await presignS3GetUrl(
    await clientConfigFor(descriptor),
    descriptor.key,
    {
      expiresInSeconds: options.expiresInSeconds,
      responseContentType: options.contentType ?? handle.mimeType,
      responseContentDisposition: options.contentDisposition,
      responseCacheControl: `private, max-age=${Math.floor(options.expiresInSeconds)}`,
      now,
    },
  );
  return {
    url,
    expiresAt: new Date(
      now.getTime() + Math.floor(options.expiresInSeconds) * 1000,
    ).toISOString(),
  };
}

export const s3PrivateBlobProvider: PrivateBlobProvider = {
  id: S3_PRIVATE_BLOB_PROVIDER_ID,
  name: "S3-compatible private storage",
  isConfigured: () =>
    readEnvBucketConfig() !== null &&
    canUseDeployCredentialFallbackForRequest(STORAGE_KEYS.bucket[0]),
  isConfiguredForRequest: async () => (await resolveRequestBucket()) !== null,
  async put(input) {
    const bucket = await resolveRequestBucket();
    if (!bucket) {
      throw new PrivateBlobError(
        "S3 storage is not configured for this workspace",
        "not_configured",
      );
    }
    return putBlob(S3_PRIVATE_BLOB_PROVIDER_ID, bucket, input);
  },
  read: readBlob,
  readRange: readBlobRange,
  getReadUrl: readUrlFor,
  delete: (handle) => deleteBlob(S3_PRIVATE_BLOB_PROVIDER_ID, handle),
};

export const hostedPrivateBlobProvider: PrivateBlobProvider = {
  id: HOSTED_PRIVATE_BLOB_PROVIDER_ID,
  name: "Hosted private storage",
  isConfigured: () =>
    readHostedBucketConfig({ forExistingObject: false }) !== null,
  async put(input) {
    const config = readHostedBucketConfig({ forExistingObject: false });
    if (!config) {
      throw new PrivateBlobError(
        "Hosted private storage is not enabled",
        "not_configured",
      );
    }
    return putBlob(
      HOSTED_PRIVATE_BLOB_PROVIDER_ID,
      { config, source: { kind: "hosted" } },
      input,
    );
  },
  read: readBlob,
  readRange: readBlobRange,
  getReadUrl: readUrlFor,
  delete: (handle) => deleteBlob(HOSTED_PRIVATE_BLOB_PROVIDER_ID, handle),
};

/**
 * Registers the S3 private providers once: the workspace's own bucket first,
 * then the hosted bucket, so a workspace that connected storage keeps its
 * private blobs there.
 */
export function ensureS3PrivateBlobProviders(): void {
  const registered = new Set(listPrivateBlobProviders().map((p) => p.id));
  for (const provider of [s3PrivateBlobProvider, hostedPrivateBlobProvider]) {
    if (!registered.has(provider.id)) registerPrivateBlobProvider(provider);
  }
}
