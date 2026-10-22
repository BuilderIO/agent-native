import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { registerFileUploadProvider } from "@agent-native/core/file-upload";
import type {
  FileUploadDeleteInput,
  FileUploadProvider,
} from "@agent-native/core/file-upload";
import {
  decryptSecretValue,
  encryptSecretValue,
} from "@agent-native/core/secrets/crypto";
import { getConfiguredAppBasePath } from "@agent-native/core/server";

import { isHostedSlidesRuntime, tenantFileKey } from "./tenant-files.js";

const IMPORT_ASSET_PREFIX = "slides-import-asset:v1:";
export const LOCAL_IMPORTED_ASSET_PROVIDER_ID = "slides-import-local";

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
}): Promise<{ url: string; id: string; provider: string } | null> {
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
  const filepath = path.join(directory, `${id}-${safeFilename}`);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(filepath, args.data);

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
    return {
      url: `${getConfiguredAppBasePath()}/api/import-assets/${encodeURIComponent(token)}`,
      id,
      provider: LOCAL_IMPORTED_ASSET_PROVIDER_ID,
    };
  } catch (error) {
    try {
      await rm(filepath, { force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Local imported asset creation failed and its partial file could not be removed.",
      );
    }
    throw error;
  }
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

function descriptorFromLocalImportedAssetUrl(
  url: string,
): LocalImportedAssetDescriptor | null {
  let pathname: string;
  try {
    pathname = new URL(url, "http://localhost").pathname;
  } catch {
    // coercion-ok: invalid URLs cannot identify a local imported asset.
    return null;
  }
  const match = pathname.match(/\/api\/import-assets\/([^/]+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeLocalImportedAssetToken(decodeURIComponent(match[1]));
  } catch {
    // coercion-ok: malformed tokens cannot identify a local imported asset.
    return null;
  }
}

export function localImportedAssetIdentity(url: string): {
  provider: string;
  providerObjectId: string;
} | null {
  const descriptor = descriptorFromLocalImportedAssetUrl(url);
  if (!descriptor) return null;
  return {
    provider: LOCAL_IMPORTED_ASSET_PROVIDER_ID,
    providerObjectId: descriptor.id,
  };
}

async function deleteLocalImportedAsset(
  input: FileUploadDeleteInput,
): Promise<boolean> {
  const descriptor = descriptorFromLocalImportedAssetUrl(input.url);
  if (!descriptor || (input.id && input.id !== descriptor.id)) return false;
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
  if (!filepath.startsWith(directory + path.sep)) return false;

  await rm(filepath, { force: true });
  return true;
}

export const localImportedAssetFileUploadProvider: FileUploadProvider = {
  id: LOCAL_IMPORTED_ASSET_PROVIDER_ID,
  name: "Slides local imports",
  isConfigured: () => false,
  upload: async () => {
    throw new Error("This provider only deletes local imported assets.");
  },
  delete: deleteLocalImportedAsset,
};

registerFileUploadProvider(localImportedAssetFileUploadProvider);

export { IMPORT_ASSET_PREFIX };
