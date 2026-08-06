import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  decryptSecretValue,
  encryptSecretValue,
} from "@agent-native/core/secrets/crypto";
import { getConfiguredAppBasePath } from "@agent-native/core/server";

import { isHostedSlidesRuntime, tenantFileKey } from "./tenant-files.js";

const IMPORT_ASSET_PREFIX = "slides-import-asset:v1:";

export interface LocalImportedAssetDescriptor {
  kind: "slides-import-asset";
  version: 1;
  ownerKey: string;
  id: string;
  filename: string;
  mimeType: string;
}

export function isLocalImportAssetFallbackAvailable(): boolean {
  return !isHostedSlidesRuntime() && process.env.NODE_ENV !== "production";
}

export async function storeLocalImportedAsset(args: {
  email: string;
  filename: string;
  mimeType: string;
  data: Uint8Array;
}): Promise<string | null> {
  if (!isLocalImportAssetFallbackAvailable()) return null;

  const id = randomUUID();
  const safeFilename = path
    .basename(args.filename)
    .replace(/[^a-zA-Z0-9_.-]/g, "-");
  const directory = path.join(
    process.cwd(),
    "data",
    "import-assets",
    tenantFileKey(args.email),
  );
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${id}-${safeFilename}`), args.data);

  const descriptor: LocalImportedAssetDescriptor = {
    kind: "slides-import-asset",
    version: 1,
    ownerKey: tenantFileKey(args.email),
    id,
    filename: safeFilename,
    mimeType: args.mimeType,
  };
  const token = `${IMPORT_ASSET_PREFIX}${encryptSecretValue(
    JSON.stringify(descriptor),
  )}`;
  return `${getConfiguredAppBasePath()}/api/import-assets/${encodeURIComponent(token)}`;
}

export function decodeLocalImportedAssetToken(
  token: string,
): LocalImportedAssetDescriptor {
  if (!token.startsWith(IMPORT_ASSET_PREFIX)) {
    throw new Error("Invalid imported asset token");
  }
  const descriptor = JSON.parse(
    decryptSecretValue(token.slice(IMPORT_ASSET_PREFIX.length)),
  ) as LocalImportedAssetDescriptor;
  if (
    descriptor?.kind !== "slides-import-asset" ||
    descriptor.version !== 1 ||
    typeof descriptor.ownerKey !== "string" ||
    !/^[a-f0-9]{24}$/.test(descriptor.ownerKey) ||
    typeof descriptor.id !== "string" ||
    !/^[0-9a-f-]{36}$/.test(descriptor.id) ||
    typeof descriptor.filename !== "string" ||
    descriptor.filename !== path.basename(descriptor.filename) ||
    typeof descriptor.mimeType !== "string"
  ) {
    throw new Error("Invalid imported asset descriptor");
  }
  return descriptor;
}

/** Read a local development import asset after rechecking its owner scope. */
export async function readLocalImportedAsset(args: {
  token: string;
  email: string;
}): Promise<{ data: Uint8Array; mimeType: string } | null> {
  if (!isLocalImportAssetFallbackAvailable()) return null;

  let descriptor: LocalImportedAssetDescriptor;
  try {
    descriptor = decodeLocalImportedAssetToken(decodeURIComponent(args.token));
  } catch {
    // coercion-ok: malformed tokens represent an absent local asset, not a successful read.
    return null;
  }
  if (descriptor.ownerKey !== tenantFileKey(args.email)) return null;

  const directory = path.resolve(
    process.cwd(),
    "data",
    "import-assets",
    descriptor.ownerKey,
  );
  const filepath = path.resolve(
    directory,
    `${descriptor.id}-${descriptor.filename}`,
  );
  if (!filepath.startsWith(directory + path.sep)) return null;

  try {
    return {
      data: await readFile(filepath),
      mimeType: descriptor.mimeType,
    };
  } catch {
    // coercion-ok: a missing local asset is an absent export image and is skipped by the caller.
    return null;
  }
}

export { IMPORT_ASSET_PREFIX };
