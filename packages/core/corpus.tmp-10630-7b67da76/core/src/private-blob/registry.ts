import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { uploadFile } from "../file-upload/index.js";
import {
  decryptSecretValue,
  encryptSecretValue,
  getSecretEncryptionKey,
} from "../secrets/crypto.js";
import type {
  PrivateBlobDeleteResult,
  PrivateBlobHandle,
  PrivateBlobProvider,
  PrivateBlobPutInput,
  PrivateBlobReadResult,
} from "./types.js";

interface PrivateBlobGlobals {
  __agentNativePrivateBlobProviders?: Map<string, PrivateBlobProvider>;
  __agentNativePrivateBlobPublicUploadFallback?: { enabled: boolean };
}

interface EncryptedPayload {
  iv: string;
  tag: string;
  ciphertext: Uint8Array;
}

interface EncryptionParams {
  iv: string;
  tag: string;
}

interface PublicUploadDescriptor {
  kind: "agent-native.private-blob.public-upload";
  version: 1;
  url: string;
  uploadProvider: string;
  uploadId?: string;
  encryption: EncryptionParams;
  mimeType?: string;
  metadata?: PrivateBlobHandle["metadata"];
  size: number;
  createdAt: string;
}

const PUBLIC_UPLOAD_HANDLE_PREFIX = "public-upload:v1:";
const globals = globalThis as typeof globalThis & PrivateBlobGlobals;
const providers: Map<string, PrivateBlobProvider> =
  (globals.__agentNativePrivateBlobProviders ??= new Map());
const publicUploadFallbackRef: { enabled: boolean } =
  (globals.__agentNativePrivateBlobPublicUploadFallback ??= {
    enabled: true,
  });

function toBytes(data: Uint8Array | Buffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function encryptBytes(data: Uint8Array): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSecretEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(data)),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("base64url"),
    ciphertext: new Uint8Array(ciphertext),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

function decryptBytes(
  params: EncryptionParams,
  ciphertext: Uint8Array,
): Uint8Array {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getSecretEncryptionKey(),
    Buffer.from(params.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(params.tag, "base64url"));
  return new Uint8Array(
    Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]),
  );
}

function encodePublicUploadDescriptor(
  descriptor: PublicUploadDescriptor,
): string {
  return `${PUBLIC_UPLOAD_HANDLE_PREFIX}${encryptSecretValue(
    JSON.stringify(descriptor),
  )}`;
}

function decodePublicUploadDescriptor(id: string): PublicUploadDescriptor {
  if (!id.startsWith(PUBLIC_UPLOAD_HANDLE_PREFIX)) {
    throw new Error(
      "Private blob handle is not a public-upload fallback handle",
    );
  }
  const raw = decryptSecretValue(id.slice(PUBLIC_UPLOAD_HANDLE_PREFIX.length));
  const descriptor = JSON.parse(raw) as PublicUploadDescriptor;
  if (
    descriptor?.kind !== "agent-native.private-blob.public-upload" ||
    descriptor.version !== 1 ||
    typeof descriptor.url !== "string"
  ) {
    throw new Error("Private blob handle descriptor is invalid");
  }
  return descriptor;
}

function isPublicUploadFallbackHandle(handle: PrivateBlobHandle): boolean {
  return handle.id.startsWith(PUBLIC_UPLOAD_HANDLE_PREFIX);
}

async function putViaEncryptedPublicUpload(
  input: PrivateBlobPutInput,
): Promise<PrivateBlobHandle | null> {
  const bytes = toBytes(input.data);
  const encrypted = encryptBytes(bytes);
  const uploaded = await uploadFile({
    data: Buffer.from(encrypted.ciphertext),
    filename: input.filename ?? input.key ?? "private-blob.bin",
    mimeType: "application/octet-stream",
    ownerEmail: input.ownerEmail,
    recordAsset: false,
  });
  if (!uploaded) return null;

  const descriptor: PublicUploadDescriptor = {
    kind: "agent-native.private-blob.public-upload",
    version: 1,
    url: uploaded.url,
    uploadProvider: uploaded.provider,
    uploadId: uploaded.id,
    encryption: { iv: encrypted.iv, tag: encrypted.tag },
    mimeType: input.mimeType,
    metadata: input.metadata,
    size: bytes.byteLength,
    createdAt: new Date().toISOString(),
  };

  return {
    id: encodePublicUploadDescriptor(descriptor),
    provider: `public-upload:${uploaded.provider}`,
    opaque: true,
    encrypted: true,
    mimeType: input.mimeType,
    size: bytes.byteLength,
    createdAt: descriptor.createdAt,
    metadata: input.metadata,
  };
}

async function readViaEncryptedPublicUpload(
  handle: PrivateBlobHandle,
): Promise<PrivateBlobReadResult> {
  const descriptor = decodePublicUploadDescriptor(handle.id);
  const response = await fetch(descriptor.url);
  if (!response.ok) {
    throw new Error(
      `Private blob public-upload read failed (${response.status}): ${response.statusText}`,
    );
  }
  // The uploaded ciphertext is intentionally opaque; the descriptor carries
  // auth tag + IV separately so the backing public URL is useless by itself.
  const ciphertext = new Uint8Array(await response.arrayBuffer());
  return {
    data: decryptBytes(descriptor.encryption, ciphertext),
    mimeType: descriptor.mimeType,
    metadata: descriptor.metadata,
    handle,
  };
}

export function registerPrivateBlobProvider(
  provider: PrivateBlobProvider,
): void {
  providers.set(provider.id, provider);
}

export function unregisterPrivateBlobProvider(id: string): void {
  providers.delete(id);
}

export function listPrivateBlobProviders(): PrivateBlobProvider[] {
  return [...providers.values()];
}

export function getActivePrivateBlobProvider(): PrivateBlobProvider | null {
  for (const provider of providers.values()) {
    if (provider.isConfigured()) return provider;
  }
  return null;
}

export function setPrivateBlobPublicUploadFallbackEnabled(
  enabled: boolean,
): void {
  publicUploadFallbackRef.enabled = enabled;
}

export async function putPrivateBlob(
  input: PrivateBlobPutInput,
): Promise<PrivateBlobHandle | null> {
  const provider = getActivePrivateBlobProvider();
  if (provider) return provider.put(input);
  if (!publicUploadFallbackRef.enabled) return null;
  if (process.env.AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK === "0") {
    return null;
  }
  return putViaEncryptedPublicUpload(input);
}

export async function readPrivateBlob(
  handle: PrivateBlobHandle,
): Promise<PrivateBlobReadResult> {
  const provider = providers.get(handle.provider);
  if (provider) return provider.read(handle);
  if (isPublicUploadFallbackHandle(handle)) {
    return readViaEncryptedPublicUpload(handle);
  }
  throw new Error(`No private blob provider registered for ${handle.provider}`);
}

export async function deletePrivateBlob(
  handle: PrivateBlobHandle,
): Promise<PrivateBlobDeleteResult> {
  const provider = providers.get(handle.provider);
  if (provider) return provider.delete(handle);
  if (isPublicUploadFallbackHandle(handle)) {
    return {
      deleted: false,
      provider: handle.provider,
      reason:
        "delete is not supported by the encrypted public-upload fallback provider",
    };
  }
  throw new Error(`No private blob provider registered for ${handle.provider}`);
}
