import { del, get, list, put } from "@vercel/blob";

import {
  PROTECTED_CIPHERTEXT_VERSION,
  ProtectedCiphertextCollisionError,
  ProtectedCiphertextLengthMismatchError,
  ProtectedCiphertextNotFoundError,
  ProtectedCiphertextStorageUnavailableError,
  protectedCiphertextCoordinateSchema,
  protectedCiphertextLocatorSchema,
  protectedCiphertextMaximumBytes,
  protectedCiphertextPrefixSchema,
  type ProtectedCiphertextCoordinate,
  type ProtectedCiphertextLocator,
  type ProtectedCiphertextPrefix,
  type ProtectedCiphertextProvider,
} from "./types.js";

const PROVIDER_ID = "vercel-protected-ciphertext-v1";
const PATH_PREFIX = "agent-native/protected-ciphertext/v1";

type VercelBlobCredentials =
  | { token: string }
  | { oidcToken: string; storeId: string };

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function credentials(): VercelBlobCredentials | null {
  const token = envValue("BLOB_READ_WRITE_TOKEN");
  if (token) return { token };
  const oidcToken = envValue("VERCEL_OIDC_TOKEN");
  const storeId = envValue("BLOB_STORE_ID");
  return oidcToken && storeId ? { oidcToken, storeId } : null;
}

function storageGeneration(): string | null {
  const value = envValue(
    "AGENT_NATIVE_PROTECTED_CIPHERTEXT_STORAGE_GENERATION",
  );
  return value && /^[A-Za-z0-9._:-]{8,160}$/.test(value) ? value : null;
}

function requireCredentials(): VercelBlobCredentials {
  const configured = credentials();
  if (!configured) {
    throw new ProtectedCiphertextStorageUnavailableError(
      "Vercel protected ciphertext storage is not configured",
    );
  }
  return configured;
}

/** Provider-owned deterministic pathname; callers never supply this string. */
function coordinatePath(input: ProtectedCiphertextCoordinate): string {
  const coordinate = protectedCiphertextCoordinateSchema.parse(input);
  const vaultPrefix = `${PATH_PREFIX}/${coordinate.vaultId}`;
  if (coordinate.kind === "object") {
    const revisionPrefix = `${vaultPrefix}/objects/${coordinate.objectId}/${coordinate.revisionId}`;
    return coordinate.part === "header"
      ? `${revisionPrefix}/header.bin`
      : `${revisionPrefix}/chunks/${String(coordinate.chunkIndex).padStart(6, "0")}.bin`;
  }
  if (coordinate.kind === "job") {
    return `${vaultPrefix}/jobs/${coordinate.jobId}/${coordinate.part}.bin`;
  }
  if (coordinate.kind === "key-envelope") {
    return `${vaultPrefix}/key-envelopes/${coordinate.envelopeId}.bin`;
  }
  if (coordinate.kind === "recovery-wrap") {
    return `${vaultPrefix}/recovery-wraps/${coordinate.recoveryWrapHash}.bin`;
  }
  return `${vaultPrefix}/grants/${coordinate.grantId}.bin`;
}

function prefixPath(input: ProtectedCiphertextPrefix): string {
  const prefix = protectedCiphertextPrefixSchema.parse(input);
  return prefix.scope === "vault"
    ? `${PATH_PREFIX}/${prefix.vaultId}/`
    : prefix.scope === "object"
      ? `${PATH_PREFIX}/${prefix.vaultId}/objects/${prefix.objectId}/`
      : `${PATH_PREFIX}/${prefix.vaultId}/jobs/${prefix.jobId}/`;
}

function locator(
  coordinate: ProtectedCiphertextCoordinate,
): ProtectedCiphertextLocator {
  return protectedCiphertextLocatorSchema.parse({
    kind: "agent-native.protected-ciphertext",
    version: PROTECTED_CIPHERTEXT_VERSION,
    provider: PROVIDER_ID,
    opaque: true,
    coordinate,
  });
}

async function streamToBytes(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new ProtectedCiphertextLengthMismatchError();
      }
      total += value.byteLength;
      if (total > maximumBytes) {
        throw new ProtectedCiphertextLengthMismatchError();
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index++) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

async function readBytes(
  path: string,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  const result = await get(path, {
    access: "private",
    useCache: false,
    ...requireCredentials(),
  });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return streamToBytes(result.stream, maximumBytes);
}

async function ciphertextExists(path: string): Promise<boolean> {
  const result = await get(path, {
    access: "private",
    useCache: false,
    ...requireCredentials(),
  });
  if (!result || result.statusCode !== 200 || !result.stream) return false;
  await result.stream.cancel().catch(() => undefined);
  return true;
}

export const vercelProtectedCiphertextProvider: ProtectedCiphertextProvider = {
  id: PROVIDER_ID,
  name: "Vercel Blob (protected ciphertext)",
  isConfigured: () => credentials() !== null && storageGeneration() !== null,
  storageGeneration,
  put: async (input) => {
    const coordinate = protectedCiphertextCoordinateSchema.parse(
      input.coordinate,
    );
    const maximumBytes = protectedCiphertextMaximumBytes(coordinate);
    if (
      !(input.ciphertext instanceof Uint8Array) ||
      !Number.isSafeInteger(input.expectedByteLength) ||
      input.expectedByteLength < 1 ||
      input.expectedByteLength > maximumBytes ||
      input.ciphertext.byteLength !== input.expectedByteLength
    ) {
      throw new ProtectedCiphertextLengthMismatchError();
    }
    const path = coordinatePath(coordinate);
    try {
      await put(path, Buffer.from(input.ciphertext), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/octet-stream",
        multipart: input.ciphertext.byteLength > 4 * 1024 * 1024,
        ...requireCredentials(),
      });
      return {
        locator: locator(coordinate),
        byteLength: input.ciphertext.byteLength,
        created: true,
      };
    } catch (putError) {
      // An immutable retry can arrive after the provider committed but before
      // the caller received success. Recover only when the bytes are exact.
      let existing: Uint8Array | null = null;
      try {
        existing = await readBytes(path, maximumBytes);
      } catch (readError) {
        if (readError instanceof ProtectedCiphertextLengthMismatchError) {
          throw readError;
        }
        throw putError;
      }
      if (!existing) throw putError;
      if (!equalBytes(existing, input.ciphertext)) {
        throw new ProtectedCiphertextCollisionError();
      }
      return {
        locator: locator(coordinate),
        byteLength: existing.byteLength,
        created: false,
      };
    }
  },
  read: async (input) => {
    const parsed = protectedCiphertextLocatorSchema.parse(input);
    if (parsed.provider !== PROVIDER_ID) {
      throw new ProtectedCiphertextStorageUnavailableError(
        `Protected ciphertext provider is unavailable: ${parsed.provider}`,
      );
    }
    const ciphertext = await readBytes(
      coordinatePath(parsed.coordinate),
      protectedCiphertextMaximumBytes(parsed.coordinate),
    );
    if (!ciphertext) throw new ProtectedCiphertextNotFoundError();
    return {
      locator: parsed,
      ciphertext,
      byteLength: ciphertext.byteLength,
    };
  },
  delete: async (input) => {
    const parsed = protectedCiphertextLocatorSchema.parse(input);
    if (parsed.provider !== PROVIDER_ID) {
      throw new ProtectedCiphertextStorageUnavailableError(
        `Protected ciphertext provider is unavailable: ${parsed.provider}`,
      );
    }
    const path = coordinatePath(parsed.coordinate);
    if (!(await ciphertextExists(path))) {
      throw new ProtectedCiphertextNotFoundError();
    }
    await del(path, requireCredentials());
    return { deleted: true, provider: PROVIDER_ID };
  },
  deletePrefix: async (input) => {
    const expectedPrefix = prefixPath(input);
    const pathnames: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({
        prefix: expectedPrefix,
        limit: 1000,
        ...(cursor ? { cursor } : {}),
        ...requireCredentials(),
      });
      const pagePathnames = page.blobs.map((blob) => blob.pathname);
      if (
        pagePathnames.some((pathname) => !pathname.startsWith(expectedPrefix))
      ) {
        throw new Error(
          "Protected ciphertext provider returned a pathname outside the requested prefix",
        );
      }
      pathnames.push(...pagePathnames);
      cursor = page.hasMore ? page.cursor : undefined;
      if (page.hasMore && !cursor) {
        throw new Error(
          "Protected ciphertext provider returned an invalid pagination cursor",
        );
      }
    } while (cursor);

    for (let index = 0; index < pathnames.length; index += 100) {
      await del(pathnames.slice(index, index + 100), requireCredentials());
    }
    return { deleted: pathnames.length, provider: PROVIDER_ID };
  },
};

/** @internal exported only for deterministic provider tests. */
export const _vercelProtectedCiphertextForTests = {
  coordinatePath,
  streamToBytes,
  prefixPath,
};
