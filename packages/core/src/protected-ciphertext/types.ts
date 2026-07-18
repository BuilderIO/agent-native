import { z } from "zod";

import {
  boundedProtocolTokenSchema,
  opaqueIdSchema,
} from "../e2ee/contracts.js";

export const PROTECTED_CIPHERTEXT_VERSION = 1 as const;
export const PROTECTED_CIPHERTEXT_MAX_BYTES = 256 * 1024 * 1024;
export const PROTECTED_CIPHERTEXT_RECOVERY_WRAP_MAX_BYTES = 1024 * 1024;
export const PROTECTED_CIPHERTEXT_CONTROL_EVIDENCE_MAX_BYTES = 2 * 1024 * 1024;

export const recoveryWrapHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Recovery-wrap hashes must be lowercase hex");

export const controlEvidenceHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Control-evidence hashes must be lowercase hex");

/**
 * Logical coordinates for one immutable ciphertext part.
 *
 * Callers provide opaque protocol identifiers, never provider pathnames or
 * URLs. Providers alone derive their storage keys from this validated shape.
 */
export const protectedCiphertextCoordinateSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("object"),
        vaultId: opaqueIdSchema,
        objectId: opaqueIdSchema,
        revisionId: opaqueIdSchema,
        part: z.enum(["header", "chunk"]),
        chunkIndex: z.number().int().nonnegative().max(999_999).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("job"),
        vaultId: opaqueIdSchema,
        jobId: opaqueIdSchema,
        part: z.enum(["request", "result"]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("key-envelope"),
        vaultId: opaqueIdSchema,
        envelopeId: opaqueIdSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("recovery-wrap"),
        vaultId: opaqueIdSchema,
        recoveryWrapHash: recoveryWrapHashSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("control-evidence"),
        vaultId: opaqueIdSchema,
        evidenceKind: z.enum(["genesis", "recovery"]),
        evidenceHash: controlEvidenceHashSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("grant"),
        vaultId: opaqueIdSchema,
        grantId: opaqueIdSchema,
      })
      .strict(),
  ])
  .superRefine((coordinate, ctx) => {
    if (coordinate.kind !== "object") return;
    if (coordinate.part === "chunk" && coordinate.chunkIndex === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["chunkIndex"],
        message: "Object chunks require a chunk index",
      });
    }
    if (coordinate.part === "header" && coordinate.chunkIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["chunkIndex"],
        message: "Object headers cannot carry a chunk index",
      });
    }
  });

export const protectedCiphertextPrefixSchema = z.discriminatedUnion("scope", [
  z
    .object({
      scope: z.literal("vault"),
      vaultId: opaqueIdSchema,
    })
    .strict(),
  z
    .object({
      scope: z.literal("object"),
      vaultId: opaqueIdSchema,
      objectId: opaqueIdSchema,
    })
    .strict(),
  z
    .object({
      scope: z.literal("job"),
      vaultId: opaqueIdSchema,
      jobId: opaqueIdSchema,
    })
    .strict(),
]);

export const protectedCiphertextLocatorSchema = z
  .object({
    kind: z.literal("agent-native.protected-ciphertext"),
    version: z.literal(PROTECTED_CIPHERTEXT_VERSION),
    provider: boundedProtocolTokenSchema,
    opaque: z.literal(true),
    coordinate: protectedCiphertextCoordinateSchema,
  })
  .strict();

export type ProtectedCiphertextCoordinate = z.infer<
  typeof protectedCiphertextCoordinateSchema
>;
export type ProtectedCiphertextPrefix = z.infer<
  typeof protectedCiphertextPrefixSchema
>;
export type ProtectedCiphertextLocator = z.infer<
  typeof protectedCiphertextLocatorSchema
>;

export function protectedCiphertextMaximumBytes(
  coordinate: ProtectedCiphertextCoordinate,
): number {
  if (coordinate.kind === "recovery-wrap") {
    return PROTECTED_CIPHERTEXT_RECOVERY_WRAP_MAX_BYTES;
  }
  if (coordinate.kind === "control-evidence") {
    return PROTECTED_CIPHERTEXT_CONTROL_EVIDENCE_MAX_BYTES;
  }
  return PROTECTED_CIPHERTEXT_MAX_BYTES;
}

export interface ProtectedCiphertextPutInput {
  coordinate: ProtectedCiphertextCoordinate;
  ciphertext: Uint8Array;
  /** Must exactly equal ciphertext.byteLength. */
  expectedByteLength: number;
}

export interface ProtectedCiphertextPutResult {
  locator: ProtectedCiphertextLocator;
  byteLength: number;
  /** False when an immutable retry found the exact same bytes already stored. */
  created: boolean;
}

export interface ProtectedCiphertextReadResult {
  locator: ProtectedCiphertextLocator;
  ciphertext: Uint8Array;
  byteLength: number;
}

export interface ProtectedCiphertextDeleteResult {
  deleted: boolean;
  provider: string;
}

export interface ProtectedCiphertextPrefixDeleteResult {
  deleted: number;
  provider: string;
}

export interface ProtectedCiphertextProvider {
  id: string;
  name: string;
  isConfigured: () => boolean;
  /**
   * Deployment-owned immutable storage generation. Hosted apps must pin this
   * value outside the provider before accepting coordinate-only reads/writes.
   */
  storageGeneration?: () => string | null;
  put: (
    input: ProtectedCiphertextPutInput,
  ) => Promise<ProtectedCiphertextPutResult>;
  read: (
    locator: ProtectedCiphertextLocator,
  ) => Promise<ProtectedCiphertextReadResult>;
  delete: (
    locator: ProtectedCiphertextLocator,
  ) => Promise<ProtectedCiphertextDeleteResult>;
  deletePrefix?: (
    prefix: ProtectedCiphertextPrefix,
  ) => Promise<ProtectedCiphertextPrefixDeleteResult>;
}

export class ProtectedCiphertextStorageUnavailableError extends Error {
  constructor(message = "Protected ciphertext storage is not configured") {
    super(message);
    this.name = "ProtectedCiphertextStorageUnavailableError";
  }
}

export class ProtectedCiphertextProviderAmbiguousError extends Error {
  constructor() {
    super("More than one protected ciphertext provider is configured");
    this.name = "ProtectedCiphertextProviderAmbiguousError";
  }
}

export class ProtectedCiphertextNotFoundError extends Error {
  constructor(message = "Protected ciphertext was not found") {
    super(message);
    this.name = "ProtectedCiphertextNotFoundError";
  }
}

export class ProtectedCiphertextCollisionError extends Error {
  constructor(
    message = "Protected ciphertext coordinate already contains different bytes",
  ) {
    super(message);
    this.name = "ProtectedCiphertextCollisionError";
  }
}

export class ProtectedCiphertextLengthMismatchError extends Error {
  constructor() {
    super(
      "Protected ciphertext byte length does not match the declared length",
    );
    this.name = "ProtectedCiphertextLengthMismatchError";
  }
}
