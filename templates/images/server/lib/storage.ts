/**
 * Storage layer for the Images template.
 *
 * Routes through the framework's `uploadFile()` provider chain so the same
 * code path works whether the deploy uses Builder.io managed storage,
 * S3-compatible object storage (registered via `s3FileUploadProvider`), or
 * the local-fs fallback in dev.
 *
 * The "key" returned by `putObject` is opaque to callers — it's a URL when
 * uploaded via a real provider, or a relative path (`local:<file>`) when
 * we fall back to local fs in dev. `getObject` and `getPresignedObjectUrl`
 * dispatch on the shape of the key so all existing callers keep working
 * without changes.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  uploadFile,
  getActiveFileUploadProvider,
} from "@agent-native/core/file-upload";
import { resolveHasBuilderPrivateKey } from "@agent-native/core/server";

export interface StoredObject {
  /** Opaque storage handle. URL when uploaded via a real provider, or
   *  `local:<relative-path>` when falling back to local fs in dev. */
  key: string;
  /** Public URL when available (always set for URL keys). */
  url?: string;
}

const LOCAL_ROOT = path.join(process.cwd(), "data", "images-objects");
const LOCAL_PREFIX = "local:";

function isUrlKey(key: string): boolean {
  return key.startsWith("http://") || key.startsWith("https://");
}

function isLocalKey(key: string): boolean {
  return key.startsWith(LOCAL_PREFIX);
}

function localKeyToPath(key: string): string {
  return path.join(LOCAL_ROOT, key.slice(LOCAL_PREFIX.length));
}

/**
 * True if a real upload provider is registered (S3 or Builder.io), or if the
 * Builder.io credential is resolvable per-request. Used by the onboarding
 * step's `isComplete` check.
 */
export async function isObjectStorageConfigured(): Promise<boolean> {
  const active = getActiveFileUploadProvider();
  if (active && active.id !== "sql") return true;
  try {
    if (await resolveHasBuilderPrivateKey()) return true;
  } catch {
    /* fall through */
  }
  return Boolean(process.env.BUILDER_PRIVATE_KEY);
}

/** Synchronous variant for hot-path checks (env-only signal). */
export function isObjectStorageConfiguredSync(): boolean {
  const active = getActiveFileUploadProvider();
  if (active && active.id !== "sql") return true;
  return Boolean(process.env.BUILDER_PRIVATE_KEY);
}

/**
 * Upload an object. The `key` argument is now a filename hint for the provider
 * (used for extension + dedup) — the real storage location is determined by
 * the active provider and returned in the `key` field of the result.
 */
export async function putObject(input: {
  key: string;
  body: Uint8Array | Buffer;
  contentType: string;
}): Promise<StoredObject> {
  const filename = input.key.split("/").pop() || "object";
  // Buffer extends Uint8Array, so a single cast covers both inputs.
  const data: Uint8Array = input.body;

  // Try the framework provider chain first (S3 → Builder.io → SQL fallback).
  const result = await uploadFile({
    data,
    filename,
    mimeType: input.contentType,
  }).catch(() => null);

  if (result?.url) {
    return { key: result.url, url: result.url };
  }

  // Local fs fallback for dev (no provider configured).
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Image storage is not configured. Connect Builder.io in onboarding, set BUILDER_PRIVATE_KEY, or fill in the IMAGES_STORAGE_* secrets.",
    );
  }
  const localPath = path.join(LOCAL_ROOT, input.key);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, input.body);
  return { key: `${LOCAL_PREFIX}${input.key}` };
}

/** Read raw bytes from a stored object. Handles URL keys, local-fs keys, and
 *  legacy bare S3-style keys (deprecated — kept so old dev DBs still read). */
export async function getObject(key: string): Promise<Buffer> {
  if (isUrlKey(key)) {
    const res = await fetch(key);
    if (!res.ok) {
      throw new Error(
        `getObject: provider URL fetch failed (${res.status}) — ${key.slice(0, 80)}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }
  if (isLocalKey(key)) {
    return fs.readFile(localKeyToPath(key));
  }
  // Legacy: bare path key from the old direct-S3 path. Try local fs in dev.
  const legacyLocal = path.join(LOCAL_ROOT, key);
  return fs.readFile(legacyLocal);
}

/**
 * Return a URL the caller can hand out for the object.
 *
 * - URL keys (the new normal): returned as-is. The provider's URL is already
 *   the canonical public/CDN URL; the `expiresIn` argument is honored only
 *   advisorily for the `expiresAt` we report — the URL itself doesn't time
 *   out unless the provider issued a presigned URL.
 * - Local-fs keys (dev): returns null so callers know to stream bytes
 *   through their own endpoint (which already exists for assets).
 * - Legacy bare keys: returns null (no presign path here anymore).
 */
export async function getPresignedObjectUrl(
  key: string,
  expiresIn = 60 * 30,
): Promise<{ url: string; expiresAt: string } | null> {
  if (isUrlKey(key)) {
    return {
      url: key,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }
  return null;
}
