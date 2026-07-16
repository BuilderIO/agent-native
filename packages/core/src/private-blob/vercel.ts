import { randomUUID } from "node:crypto";

import { del, get, put } from "@vercel/blob";

import { decryptSecretValue, encryptSecretValue } from "../secrets/crypto.js";
import type {
  PrivateBlobDeleteResult,
  PrivateBlobHandle,
  PrivateBlobMetadata,
  PrivateBlobProvider,
  PrivateBlobPutInput,
  PrivateBlobReadResult,
} from "./types.js";

const PROVIDER_ID = "vercel-blob";
const HANDLE_PREFIX = "vercel-blob:v1:";
const PRIVATE_BLOB_PATH_PREFIX = "agent-native/private-blobs/v1";

type VercelBlobDescriptor = {
  kind: "agent-native.private-blob.vercel";
  version: 1;
  url: string;
  mimeType?: string;
  size: number;
  createdAt: string;
  metadata?: PrivateBlobMetadata;
};

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

function safeMimeType(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const mimeType = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(
    mimeType,
  )
    ? mimeType
    : undefined;
}

function encodeDescriptor(descriptor: VercelBlobDescriptor): string {
  return `${HANDLE_PREFIX}${encryptSecretValue(JSON.stringify(descriptor))}`;
}

function decodeDescriptor(handle: PrivateBlobHandle): VercelBlobDescriptor {
  if (handle.provider !== PROVIDER_ID || !handle.id.startsWith(HANDLE_PREFIX)) {
    throw new Error("Private blob handle is not a Vercel Blob handle");
  }

  let descriptor: unknown;
  try {
    descriptor = JSON.parse(
      decryptSecretValue(handle.id.slice(HANDLE_PREFIX.length)),
    );
  } catch {
    throw new Error("Private blob Vercel handle descriptor is invalid");
  }

  if (
    !descriptor ||
    typeof descriptor !== "object" ||
    (descriptor as VercelBlobDescriptor).kind !==
      "agent-native.private-blob.vercel" ||
    (descriptor as VercelBlobDescriptor).version !== 1 ||
    typeof (descriptor as VercelBlobDescriptor).url !== "string" ||
    !(descriptor as VercelBlobDescriptor).url.startsWith("https://") ||
    typeof (descriptor as VercelBlobDescriptor).size !== "number" ||
    typeof (descriptor as VercelBlobDescriptor).createdAt !== "string"
  ) {
    throw new Error("Private blob Vercel handle descriptor is invalid");
  }

  return descriptor as VercelBlobDescriptor;
}

function requireCredentials(): VercelBlobCredentials {
  const configured = credentials();
  if (!configured) {
    throw new Error(
      "Vercel Blob private storage is not configured. Set BLOB_READ_WRITE_TOKEN or both VERCEL_OIDC_TOKEN and BLOB_STORE_ID.",
    );
  }
  return configured;
}

function createHandle(descriptor: VercelBlobDescriptor): PrivateBlobHandle {
  return {
    id: encodeDescriptor(descriptor),
    provider: PROVIDER_ID,
    opaque: true,
    // Vercel Blob access control protects the backing bytes, but the provider
    // does not encrypt them under an endpoint-held E2EE key.
    encrypted: false,
    mimeType: descriptor.mimeType,
    size: descriptor.size,
    createdAt: descriptor.createdAt,
    metadata: descriptor.metadata,
  };
}

async function streamToBytes(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const vercelPrivateBlobProvider: PrivateBlobProvider = {
  id: PROVIDER_ID,
  name: "Vercel Blob (private)",
  isConfigured: () => credentials() !== null,
  put: async (input: PrivateBlobPutInput) => {
    const createdAt = new Date().toISOString();
    const mimeType = safeMimeType(input.mimeType);
    const data =
      input.data instanceof Uint8Array
        ? input.data
        : new Uint8Array(input.data);
    const uploaded = await put(
      `${PRIVATE_BLOB_PATH_PREFIX}/${randomUUID()}`,
      Buffer.from(data),
      {
        access: "private",
        addRandomSuffix: false,
        ...(mimeType ? { contentType: mimeType } : {}),
        ...requireCredentials(),
      },
    );
    return createHandle({
      kind: "agent-native.private-blob.vercel",
      version: 1,
      url: uploaded.url,
      mimeType: mimeType ?? uploaded.contentType,
      size: data.byteLength,
      createdAt,
      metadata: input.metadata,
    });
  },
  read: async (handle: PrivateBlobHandle): Promise<PrivateBlobReadResult> => {
    const descriptor = decodeDescriptor(handle);
    const result = await get(descriptor.url, {
      access: "private",
      ...requireCredentials(),
    });
    if (!result || result.statusCode !== 200 || !result.stream) {
      throw new Error("Private blob was not found in Vercel Blob storage");
    }
    return {
      data: await streamToBytes(result.stream),
      mimeType: descriptor.mimeType ?? result.blob.contentType,
      metadata: descriptor.metadata,
      handle,
    };
  },
  delete: async (
    handle: PrivateBlobHandle,
  ): Promise<PrivateBlobDeleteResult> => {
    const descriptor = decodeDescriptor(handle);
    await del(descriptor.url, requireCredentials());
    return { deleted: true, provider: PROVIDER_ID };
  },
};
