
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  uploadFile,
  getActiveFileUploadProvider,
} from "@agent-native/core/file-upload";
import {
  CredentialStoreUnavailableError,
  hasBuilderApiCredentialCustody,
} from "@agent-native/core/server";

import {
  getPresignedS3ObjectUrl,
  getS3Object,
  isS3StorageKey,
  s3StorageKey,
} from "./s3-upload-provider.js";

export interface StoredObject {
  key: string;
  url?: string;
}

const LOCAL_ROOT = path.join(process.cwd(), "data", "assets-objects");
const LEGACY_LOCAL_ROOT = path.join(process.cwd(), "data", "images-objects");
const LOCAL_PREFIX = "local:";
const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));

function isUrlKey(key: string): boolean {
  return key.startsWith("http://") || key.startsWith("https://");
}

function isLocalKey(key: string): boolean {
  return key.startsWith(LOCAL_PREFIX);
}

function isPublicPathKey(key: string): boolean {
  return (
    key.startsWith("/library-presets/") || key.startsWith("library-presets/")
  );
}

function localKeyToPath(key: string): string {
  return path.join(LOCAL_ROOT, key.slice(LOCAL_PREFIX.length));
}

function legacyLocalKeyToPath(key: string): string {
  return path.join(LEGACY_LOCAL_ROOT, key.slice(LOCAL_PREFIX.length));
}

async function readPublicPathKey(key: string): Promise<Buffer> {
  const relativePath = key.replace(/^\/+/, "");
  const candidates = [
    path.join(process.cwd(), "public", relativePath),
    path.join(process.cwd(), "dist", relativePath),
    path.join(process.cwd(), "templates", "assets", "public", relativePath),
    path.resolve(LIB_DIR, "..", "..", "public", relativePath),
    path.resolve(LIB_DIR, "..", "..", "dist", relativePath),
  ];
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch {
      // Try the next dev/build layout.
    }
  }
  throw new Error(`getObject: public asset not found (${key})`);
}

export async function isObjectStorageConfigured(): Promise<boolean> {
  const active = getActiveFileUploadProvider();
  if (active && active.id !== "sql") return true;
  try {
    if (await hasBuilderApiCredentialCustody()) return true;
  } catch (err) {
    if (err instanceof CredentialStoreUnavailableError) throw err;
  }
  return false;
}

export async function putObject(input: {
  key: string;
  body: Uint8Array | Buffer;
  contentType: string;
}): Promise<StoredObject> {
  const filename = input.key.split("/").pop() || "object";
  const data: Uint8Array = input.body;

  const result = await uploadFile({
    data,
    filename,
    mimeType: input.contentType,
  }).catch(() => null);

  if (result?.provider === "s3" && result.id) {
    return { key: s3StorageKey(result.id), url: result.url };
  }
  if (result?.url) {
    return { key: result.url, url: result.url };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Asset storage is not configured. Connect Builder.io (free tier available) in onboarding, set BUILDER_PRIVATE_KEY, or fill in the ASSETS_STORAGE_* secrets.",
    );
  }
  const localPath = path.join(LOCAL_ROOT, input.key);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, input.body);
  return { key: `${LOCAL_PREFIX}${input.key}` };
}

export async function getObject(key: string): Promise<Buffer> {
  if (isPublicPathKey(key)) {
    return readPublicPathKey(key);
  }
  if (isUrlKey(key)) {
    const res = await fetch(key);
    if (!res.ok) {
      throw new Error(
        `getObject: provider URL fetch failed (${res.status}) — ${key.slice(0, 80)}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }
  if (isS3StorageKey(key)) {
    return getS3Object(key);
  }
  if (isLocalKey(key)) {
    return fs
      .readFile(localKeyToPath(key))
      .catch(() => fs.readFile(legacyLocalKeyToPath(key)));
  }
  const legacyLocal = path.join(LOCAL_ROOT, key);
  return fs
    .readFile(legacyLocal)
    .catch(() => fs.readFile(path.join(LEGACY_LOCAL_ROOT, key)));
}

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
  if (isS3StorageKey(key)) {
    return getPresignedS3ObjectUrl(key, expiresIn);
  }
  return null;
}
