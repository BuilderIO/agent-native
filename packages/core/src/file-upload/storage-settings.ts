/**
 * Workspace file storage settings: the one S3-compatible configuration that
 * Settings, onboarding, and templates such as Clips all read and write.
 *
 * Values live as workspace-scoped secrets under the `S3_*` names that every
 * S3 upload provider resolves. `R2_*` names are legacy aliases the providers
 * still read, so clearing removes them too; otherwise "cleared" storage would
 * keep uploading to the old bucket.
 */

import { fail, type ActionRunContext } from "../action.js";
import { getDbExec } from "../db/client.js";
import {
  deleteAppSecret,
  readAppSecrets,
  writeAppSecret,
} from "../secrets/storage.js";
import {
  getActiveFileUploadProviderForRequest,
  listFileUploadProviders,
} from "./registry.js";

export const FILE_STORAGE_SECRET_KEYS = {
  endpoint: "S3_ENDPOINT",
  bucket: "S3_BUCKET",
  accessKeyId: "S3_ACCESS_KEY_ID",
  secretAccessKey: "S3_SECRET_ACCESS_KEY",
  region: "S3_REGION",
  publicBaseUrl: "S3_PUBLIC_BASE_URL",
} as const;

const LEGACY_FILE_STORAGE_SECRET_KEYS = {
  endpoint: "R2_ENDPOINT",
  bucket: "R2_BUCKET",
  accessKeyId: "R2_ACCESS_KEY_ID",
  secretAccessKey: "R2_SECRET_ACCESS_KEY",
  region: "R2_REGION",
  publicBaseUrl: "R2_PUBLIC_BASE_URL",
} as const;

export type FileStorageField = keyof typeof FILE_STORAGE_SECRET_KEYS;

const FIELDS = Object.keys(FILE_STORAGE_SECRET_KEYS) as FileStorageField[];

export const FILE_STORAGE_SECRET_DESCRIPTION =
  "S3-compatible object storage for file uploads";

export const FILE_STORAGE_PROVIDERS = [
  "aws-s3",
  "cloudflare-r2",
  "supabase",
  "other",
] as const;

export type FileStorageProviderId = (typeof FILE_STORAGE_PROVIDERS)[number];

export const FILE_STORAGE_MANAGE_DENIED =
  "Only organization owners and admins can change file storage.";

export interface FileStorageStatus {
  /** Owners and admins (or the only user of a solo workspace) can change storage. */
  canManage: boolean;
  /** The saved workspace values form a complete configuration. */
  configured: boolean;
  /** Preset inferred from the endpoint; null when nothing is saved. */
  provider: FileStorageProviderId | null;
  /** Non-secret saved values. Null for members and for unsaved fields. */
  endpoint: string | null;
  bucket: string | null;
  region: string | null;
  publicBaseUrl: string | null;
  /** Which fields have a saved workspace value. Always false for members. */
  saved: Record<FileStorageField, boolean>;
  /**
   * False when the registered `s3` provider can serve files without a public
   * base URL (Clips reads objects through signed requests).
   */
  publicUrlRequired: boolean;
  /** The provider new uploads go to for this request. */
  activeProvider: { id: string; name: string } | null;
  /** Whether Builder.io storage would take uploads after a clear; null when the check failed. */
  builderUploadConfigured: boolean | null;
}

export interface SaveFileStorageInput {
  endpoint?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Empty string removes the saved value. */
  region?: string;
  /** Empty string removes the saved value when the provider allows it. */
  publicBaseUrl?: string;
}

interface FileStorageAccess {
  scopeId: string;
  canManage: boolean;
}

export async function resolveFileStorageAccess(
  ctx: ActionRunContext | undefined,
): Promise<FileStorageAccess> {
  const email = ctx?.userEmail?.trim();
  if (!email) fail("Sign in to manage file storage.", { statusCode: 401 });
  const orgId = ctx?.orgId?.trim();
  // A workspace without an organization has one user and no role gradient,
  // matching `canMutateWorkspaceScope` in the secrets routes.
  if (!orgId) return { scopeId: `solo:${email}`, canManage: true };
  const { rows } = await getDbExec().execute({
    sql: `SELECT role FROM org_members
          WHERE org_id = ? AND LOWER(email) = LOWER(?)
            AND federation_removal_pending_at IS NULL
          LIMIT 1`,
    args: [orgId, email],
  });
  const role = rows[0]?.role;
  return { scopeId: orgId, canManage: role === "owner" || role === "admin" };
}

export function inferFileStorageProvider(
  endpoint: string | null | undefined,
): FileStorageProviderId | null {
  if (!endpoint) return null;
  let host: string;
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    // coercion-ok: an unparseable saved endpoint is shown as a custom one.
    return "other";
  }
  if (host.endsWith(".r2.cloudflarestorage.com")) return "cloudflare-r2";
  if (host.endsWith(".supabase.co")) return "supabase";
  if (host === "amazonaws.com" || host.endsWith(".amazonaws.com")) {
    return "aws-s3";
  }
  return "other";
}

export function isFileStoragePublicUrlRequired(): boolean {
  const provider = listFileUploadProviders().find((p) => p.id === "s3");
  return provider?.publicBaseUrlOptional !== true;
}

async function readWorkspaceValues(
  scopeId: string,
): Promise<Record<FileStorageField, string | null>> {
  const secrets = await readAppSecrets({
    keys: [
      ...Object.values(FILE_STORAGE_SECRET_KEYS),
      ...Object.values(LEGACY_FILE_STORAGE_SECRET_KEYS),
    ],
    scope: "workspace",
    scopeId,
  });
  const values = {} as Record<FileStorageField, string | null>;
  for (const field of FIELDS) {
    values[field] =
      secrets.get(FILE_STORAGE_SECRET_KEYS[field])?.value.trim() ||
      secrets.get(LEGACY_FILE_STORAGE_SECRET_KEYS[field])?.value.trim() ||
      null;
  }
  return values;
}

async function readBuilderUploadConfigured(): Promise<boolean | null> {
  try {
    const [{ canAuthorizeBuilderApiRequest }, { BUILDER_ASSETS_WRITE_SCOPE }] =
      await Promise.all([
        import("../server/builder-api-auth.js"),
        import("../server/builder-oauth.js"),
      ]);
    return await canAuthorizeBuilderApiRequest(BUILDER_ASSETS_WRITE_SCOPE);
  } catch {
    // coercion-ok: null is the explicit "could not tell" state; the UI shows
    // the no-fallback warning rather than promising Builder.io storage.
    return null;
  }
}

function isCompleteConfig(
  values: Record<FileStorageField, string | null>,
  publicUrlRequired: boolean,
): boolean {
  return Boolean(
    values.endpoint &&
    values.bucket &&
    values.accessKeyId &&
    values.secretAccessKey &&
    (!publicUrlRequired || values.publicBaseUrl),
  );
}

export async function getFileStorageStatus(
  ctx: ActionRunContext | undefined,
): Promise<FileStorageStatus> {
  const access = await resolveFileStorageAccess(ctx);
  const publicUrlRequired = isFileStoragePublicUrlRequired();
  const values = await readWorkspaceValues(access.scopeId);
  const [active, builderUploadConfigured] = await Promise.all([
    getActiveFileUploadProviderForRequest(),
    readBuilderUploadConfigured(),
  ]);
  const saved = {} as Record<FileStorageField, boolean>;
  for (const field of FIELDS) {
    saved[field] = access.canManage && values[field] !== null;
  }
  const visible = (value: string | null) => (access.canManage ? value : null);
  return {
    canManage: access.canManage,
    configured: isCompleteConfig(values, publicUrlRequired),
    provider: access.canManage
      ? inferFileStorageProvider(values.endpoint)
      : null,
    endpoint: visible(values.endpoint),
    bucket: visible(values.bucket),
    region: visible(values.region),
    publicBaseUrl: visible(values.publicBaseUrl),
    saved,
    publicUrlRequired,
    activeProvider: active ? { id: active.id, name: active.name } : null,
    builderUploadConfigured,
  };
}

const FIELD_LABELS: Record<FileStorageField, string> = {
  endpoint: "Endpoint URL",
  bucket: "Bucket",
  accessKeyId: "Access key ID",
  secretAccessKey: "Secret access key",
  region: "Region",
  publicBaseUrl: "Public URL",
};

function invalid(message: string, field: FileStorageField): never {
  fail(message, {
    errorCode: "invalid_file_storage",
    details: { field },
  });
}

function assertHttpUrl(value: string, field: FileStorageField) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalid(
      `${FIELD_LABELS[field]} must start with https:// or http://.`,
      field,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    invalid(
      `${FIELD_LABELS[field]} must start with https:// or http://.`,
      field,
    );
  }
}

const BUCKET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

/**
 * Save workspace storage values. Omitted and blank key fields keep their
 * saved value, so editing the bucket doesn't ask for the keys again.
 */
export async function saveFileStorage(
  ctx: ActionRunContext | undefined,
  input: SaveFileStorageInput,
): Promise<FileStorageStatus> {
  const access = await resolveFileStorageAccess(ctx);
  if (!access.canManage) {
    fail(FILE_STORAGE_MANAGE_DENIED, {
      statusCode: 403,
      errorCode: "forbidden",
    });
  }
  const publicUrlRequired = isFileStoragePublicUrlRequired();
  const current = await readWorkspaceValues(access.scopeId);

  const writes = new Map<FileStorageField, string>();
  const removals = new Set<FileStorageField>();
  for (const field of FIELDS) {
    const raw = input[field];
    if (raw === undefined) continue;
    let value = raw.trim();
    if (field === "endpoint" || field === "publicBaseUrl") {
      value = value.replace(/\/+$/, "");
    }
    if (value) {
      writes.set(field, value);
    } else if (field === "region" || field === "publicBaseUrl") {
      if (current[field] !== null) removals.add(field);
    }
  }

  const next = { ...current };
  for (const field of removals) next[field] = null;
  for (const [field, value] of writes) next[field] = value;

  const missing = FIELDS.filter(
    (field) =>
      !next[field] &&
      field !== "region" &&
      (field !== "publicBaseUrl" || publicUrlRequired),
  );
  if (missing.length > 0) {
    fail(`Enter ${missing.map((field) => FIELD_LABELS[field]).join(", ")}.`, {
      errorCode: "invalid_file_storage",
      details: { missing },
    });
  }
  if (writes.has("endpoint"))
    assertHttpUrl(writes.get("endpoint")!, "endpoint");
  if (writes.has("publicBaseUrl")) {
    assertHttpUrl(writes.get("publicBaseUrl")!, "publicBaseUrl");
  }
  const bucket = writes.get("bucket");
  if (bucket && !BUCKET_NAME.test(bucket)) {
    invalid(
      "Bucket names use letters, numbers, dots, dashes, and underscores.",
      "bucket",
    );
  }

  for (const [field, value] of writes) {
    await writeAppSecret({
      key: FILE_STORAGE_SECRET_KEYS[field],
      value,
      scope: "workspace",
      scopeId: access.scopeId,
      description: FILE_STORAGE_SECRET_DESCRIPTION,
    });
  }
  for (const field of removals) {
    await deleteWorkspaceField(access.scopeId, field);
  }
  return getFileStorageStatus(ctx);
}

async function deleteWorkspaceField(
  scopeId: string,
  field: FileStorageField,
): Promise<string[]> {
  const removed: string[] = [];
  for (const key of [
    FILE_STORAGE_SECRET_KEYS[field],
    LEGACY_FILE_STORAGE_SECRET_KEYS[field],
  ]) {
    if (await deleteAppSecret({ key, scope: "workspace", scopeId })) {
      removed.push(key);
    }
  }
  return removed;
}

/** Delete every workspace storage key. Files already uploaded stay in the bucket. */
export async function clearFileStorage(
  ctx: ActionRunContext | undefined,
): Promise<{ removedKeys: string[]; status: FileStorageStatus }> {
  const access = await resolveFileStorageAccess(ctx);
  if (!access.canManage) {
    fail(FILE_STORAGE_MANAGE_DENIED, {
      statusCode: 403,
      errorCode: "forbidden",
    });
  }
  const removedKeys: string[] = [];
  for (const field of FIELDS) {
    removedKeys.push(...(await deleteWorkspaceField(access.scopeId, field)));
  }
  return { removedKeys, status: await getFileStorageStatus(ctx) };
}
