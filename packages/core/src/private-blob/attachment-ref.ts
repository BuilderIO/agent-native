/**
 * The one attachment reference.
 *
 * An uploaded file (chat composer, an import control, a chunked upload) is
 * minted exactly once, here, into an opaque `AttachmentRef` string that names a
 * private blob plus who may open it. Every action that accepts a file opens it
 * through `resolveAttachment`, which answers with a closed set of outcomes
 * instead of a thrown message:
 *
 * - `ok`: the bytes.
 * - `notFound`: storage says the object does not exist.
 * - `forbiddenScope`: the ref is valid but belongs to another user or org.
 * - `expired`: the ref was valid once and can no longer be opened.
 * - `malformed`: the string is not an attachment ref.
 * - `storageUnavailable`: the ref is fine, the backing store cannot answer
 *   right now. This is the only retryable outcome, and the same ref works once
 *   storage is back, so nobody should be asked to attach the file again.
 *
 * Templates never mint their own descriptors and never branch on error text.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import path from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import {
  decryptSecretValue,
  getSecretEncryptionKey,
} from "../secrets/crypto.js";
import {
  getRequestContext,
  getRequestOrgId,
  runWithRequestContext,
} from "../server/request-context.js";
import { countAttachmentOutcome } from "../tracking/failure-counters.js";
import { isPrivateBlobError } from "./errors.js";
import {
  deletePrivateBlob,
  putPrivateBlob,
  readPrivateBlob,
} from "./registry.js";
import type { PrivateBlobHandle, PrivateBlobMetadata } from "./types.js";

export type AttachmentRef = string;

export const ATTACHMENT_REF_PREFIX = "attachment:v1:";
/**
 * Slides minted its own descriptor before the ref moved to core. The payload
 * layout is the same, so the resolver still opens refs already stored in chat
 * threads and decks. Nothing mints this prefix any more.
 */
export const LEGACY_SLIDES_UPLOAD_REF_PREFIX = "slides-upload:v1:";

/**
 * Upper bound any prompt, context block or persisted field must allow for a
 * ref. A ref is opaque and unrecoverable once cut: a 2,000-character cap on a
 * 2,653-character legacy ref turned every follow-up turn into "invalid
 * reference". Truncate other strings; never truncate a ref.
 */
export const ATTACHMENT_REF_MAX_CHARS = 4096;

const DESCRIPTOR_KINDS = {
  [ATTACHMENT_REF_PREFIX]: "attachment",
  [LEGACY_SLIDES_UPLOAD_REF_PREFIX]: "slides-upload",
} as const;

interface AttachmentDescriptor {
  kind: "attachment" | "slides-upload";
  version: 1;
  ownerKey: string;
  orgId: string | null;
  filename: string;
  handle: PrivateBlobHandle;
}

export interface AttachmentScope {
  ownerEmail: string;
  /**
   * `undefined` reads the active request's org; `null` is the personal scope.
   */
  orgId?: string | null;
}

export interface AttachmentFile {
  data: Buffer;
  filename: string;
  mimeType?: string;
  size: number;
}

/** Who can make a `storageUnavailable` outcome go away. */
export type StorageFixer = "workspace_admin" | "operator" | "self_resolving";

export type StorageUnavailableReason =
  | "not_configured"
  | "misconfigured"
  | "encryption_key_unavailable"
  | "provider_unavailable";

export type AttachmentFailure =
  | {
      status: "notFound";
      reason: "blob_missing" | "file_missing";
      filename?: string;
    }
  | {
      status: "forbiddenScope";
      reason: "owner_mismatch" | "org_mismatch" | "path_outside_uploads";
    }
  | {
      status: "expired";
      reason: "undecryptable" | "retention";
      filename?: string;
    }
  | {
      status: "malformed";
      reason: "empty" | "unrecognized_scheme" | "invalid_shape";
    }
  | {
      status: "storageUnavailable";
      reason: StorageUnavailableReason;
      whoCanFix: StorageFixer;
      filename?: string;
    };

export type AttachmentResolution =
  | { status: "ok"; file: AttachmentFile }
  | AttachmentFailure;

export type StorageUnavailable = Extract<
  AttachmentFailure,
  { status: "storageUnavailable" }
>;

export type MintAttachmentResult =
  | { status: "ok"; ref: AttachmentRef; handle: PrivateBlobHandle }
  | StorageUnavailable;

export type DeleteAttachmentResult =
  | { status: "ok"; deleted: boolean }
  | AttachmentFailure;

/** Same derivation Slides used for `ownerKey`, so legacy refs keep verifying. */
export function attachmentOwnerKey(email: string): string {
  return createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
}

export function isAttachmentRef(value: unknown): value is AttachmentRef {
  return (
    typeof value === "string" &&
    (value.startsWith(ATTACHMENT_REF_PREFIX) ||
      value.startsWith(LEGACY_SLIDES_UPLOAD_REF_PREFIX))
  );
}

/** Retryable means the same ref can succeed later; nothing else qualifies. */
export function isRetryableAttachmentFailure(
  failure: AttachmentFailure,
): failure is StorageUnavailable {
  return failure.status === "storageUnavailable";
}

function storageUnavailable(
  reason: StorageUnavailableReason,
  filename?: string,
): StorageUnavailable {
  const whoCanFix: StorageFixer =
    reason === "not_configured"
      ? "workspace_admin"
      : reason === "provider_unavailable"
        ? "self_resolving"
        : "operator";
  return {
    status: "storageUnavailable",
    reason,
    whoCanFix,
    ...(filename ? { filename } : {}),
  };
}

function classifyStorageError(
  error: unknown,
  filename?: string,
): AttachmentFailure {
  if (isPrivateBlobError(error)) {
    switch (error.kind) {
      case "not_found":
        return { status: "notFound", reason: "blob_missing", filename };
      case "gone":
        return { status: "expired", reason: "retention", filename };
      case "corrupt":
        return { status: "expired", reason: "undecryptable", filename };
      case "not_configured":
        return storageUnavailable("misconfigured", filename);
      case "unavailable":
        return storageUnavailable("provider_unavailable", filename);
    }
  }
  // An error nobody typed says nothing about the file; do not call it gone.
  return storageUnavailable("provider_unavailable", filename);
}

function logFailure(
  operation: "mint" | "resolve" | "delete",
  failure: AttachmentFailure,
): void {
  console.warn(`[attachment-ref] ${operation} failed`, {
    status: failure.status,
    reason: failure.reason,
  });
  countAttachmentOutcome({
    operation,
    status: failure.status,
    reason: failure.reason,
    ...(failure.status === "storageUnavailable"
      ? { whoCanFix: failure.whoCanFix }
      : {}),
  });
}

/**
 * Compact AES-256-GCM seal: deflate, encrypt, base64url. The legacy hex
 * `encryptSecretValue` format doubled the size of an already-encrypted blob
 * handle, which is what pushed refs past 2,600 characters.
 */
function sealDescriptor(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSecretEncryptionKey(), iv);
  const body = Buffer.concat([
    cipher.update(deflateRawSync(Buffer.from(plaintext, "utf8"))),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

function unsealDescriptor(sealed: string): string {
  const raw = Buffer.from(sealed, "base64url");
  if (raw.length <= 28) throw new Error("sealed descriptor is too short");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getSecretEncryptionKey(),
    raw.subarray(0, 12),
  );
  decipher.setAuthTag(raw.subarray(12, 28));
  // The auth tag is verified in `final()`, before anything is inflated.
  const deflated = Buffer.concat([
    decipher.update(raw.subarray(28)),
    decipher.final(),
  ]);
  return inflateRawSync(deflated).toString("utf8");
}

function encryptionKeyAvailable(): boolean {
  try {
    getSecretEncryptionKey();
    return true;
    // coercion-ok: the throw is the typed 'key unavailable' signal, surfaced as storageUnavailable by the caller
  } catch {
    // Production refuses to derive a key without configured key material.
    return false;
  }
}

export async function mintAttachmentRef(input: {
  data: Uint8Array | Buffer;
  filename: string;
  mimeType: string;
  ownerEmail: string;
  /** `undefined` uses the active request's org; `null` mints a personal ref. */
  orgId?: string | null;
  metadata?: PrivateBlobMetadata;
}): Promise<MintAttachmentResult> {
  const filename = path.basename(input.filename);
  if (!encryptionKeyAvailable()) {
    const failure = storageUnavailable("encryption_key_unavailable", filename);
    logFailure("mint", failure);
    return failure;
  }

  const existingContext = getRequestContext();
  const orgId =
    input.orgId !== undefined
      ? input.orgId
      : (existingContext?.orgId ?? getRequestOrgId() ?? null);

  let handle: PrivateBlobHandle | null;
  try {
    handle = await runWithRequestContext(
      {
        ...existingContext,
        userEmail: input.ownerEmail,
        orgId: orgId ?? undefined,
      },
      () =>
        putPrivateBlob({
          data: input.data,
          filename,
          mimeType: input.mimeType,
          ownerEmail: input.ownerEmail,
          metadata: input.metadata,
        }),
    );
  } catch (error) {
    const failure = classifyStorageError(error, filename);
    // A write that did not land is a storage problem whatever the read-back
    // said; "not found" here never describes an existing attachment.
    const mapped =
      failure.status === "storageUnavailable"
        ? failure
        : storageUnavailable("provider_unavailable", filename);
    logFailure("mint", mapped);
    return mapped;
  }
  if (!handle) {
    const failure = storageUnavailable("not_configured", filename);
    logFailure("mint", failure);
    return failure;
  }

  const descriptor: AttachmentDescriptor = {
    kind: "attachment",
    version: 1,
    ownerKey: attachmentOwnerKey(input.ownerEmail),
    orgId,
    filename,
    handle,
  };
  countAttachmentOutcome({ operation: "mint", status: "ok" });
  return {
    status: "ok",
    ref: `${ATTACHMENT_REF_PREFIX}${sealDescriptor(JSON.stringify(descriptor))}`,
    handle,
  };
}

function isDescriptor(
  value: unknown,
  kind: AttachmentDescriptor["kind"],
): value is AttachmentDescriptor {
  if (!value || typeof value !== "object") return false;
  const descriptor = value as Partial<AttachmentDescriptor>;
  const handle = descriptor.handle;
  return (
    descriptor.kind === kind &&
    descriptor.version === 1 &&
    typeof descriptor.ownerKey === "string" &&
    (descriptor.orgId === null || typeof descriptor.orgId === "string") &&
    typeof descriptor.filename === "string" &&
    descriptor.filename === path.basename(descriptor.filename) &&
    !!handle &&
    typeof handle.id === "string" &&
    typeof handle.provider === "string" &&
    handle.opaque === true
  );
}

function openDescriptor(
  ref: unknown,
  scope: AttachmentScope,
): { status: "ok"; descriptor: AttachmentDescriptor } | AttachmentFailure {
  if (typeof ref !== "string" || ref.trim() === "") {
    return { status: "malformed", reason: "empty" };
  }
  const prefix = (
    Object.keys(DESCRIPTOR_KINDS) as Array<keyof typeof DESCRIPTOR_KINDS>
  ).find((candidate) => ref.startsWith(candidate));
  if (!prefix) return { status: "malformed", reason: "unrecognized_scheme" };

  if (!encryptionKeyAvailable()) {
    return storageUnavailable("encryption_key_unavailable");
  }

  let parsed: unknown;
  try {
    const sealed = ref.slice(prefix.length);
    parsed = JSON.parse(
      prefix === LEGACY_SLIDES_UPLOAD_REF_PREFIX
        ? decryptSecretValue(sealed)
        : unsealDescriptor(sealed),
    );
  } catch {
    // A ref this deployment's key cannot open: copied incompletely, altered,
    // or minted under key material that has since changed.
    return { status: "expired", reason: "undecryptable" };
  }
  if (!isDescriptor(parsed, DESCRIPTOR_KINDS[prefix])) {
    return { status: "malformed", reason: "invalid_shape" };
  }

  if (parsed.ownerKey !== attachmentOwnerKey(scope.ownerEmail)) {
    return { status: "forbiddenScope", reason: "owner_mismatch" };
  }
  const requestOrgId =
    scope.orgId !== undefined ? scope.orgId : (getRequestOrgId() ?? null);
  if (parsed.orgId !== requestOrgId) {
    return { status: "forbiddenScope", reason: "org_mismatch" };
  }
  return { status: "ok", descriptor: parsed };
}

export async function resolveAttachment(
  ref: AttachmentRef,
  scope: AttachmentScope,
): Promise<AttachmentResolution> {
  const opened = openDescriptor(ref, scope);
  if (opened.status !== "ok") {
    logFailure("resolve", opened);
    return opened;
  }
  const { descriptor } = opened;
  try {
    const blob = await readPrivateBlob(descriptor.handle);
    const data = Buffer.from(blob.data);
    countAttachmentOutcome({ operation: "resolve", status: "ok" });
    return {
      status: "ok",
      file: {
        data,
        filename: descriptor.filename,
        mimeType: blob.mimeType ?? descriptor.handle.mimeType,
        size: data.byteLength,
      },
    };
  } catch (error) {
    const failure = classifyStorageError(error, descriptor.filename);
    logFailure("resolve", failure);
    return failure;
  }
}

export async function deleteAttachment(
  ref: AttachmentRef,
  scope: AttachmentScope,
): Promise<DeleteAttachmentResult> {
  const opened = openDescriptor(ref, scope);
  if (opened.status !== "ok") {
    logFailure("delete", opened);
    return opened;
  }
  try {
    const result = await deletePrivateBlob(opened.descriptor.handle);
    return { status: "ok", deleted: result.deleted };
  } catch (error) {
    const failure = classifyStorageError(error, opened.descriptor.filename);
    logFailure("delete", failure);
    return failure;
  }
}
