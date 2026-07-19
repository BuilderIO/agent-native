import { z } from "zod";

import {
  type AncV1CanonicalValue,
  AncV1CanonicalEncodingError,
  ancV1BytesToHex,
  ancV1HexToBytes,
  decodeAncV1Envelope,
  encodeAncV1Canonical,
} from "./canonical.js";
import { opaqueIdSchema } from "./contracts.js";
import { ancV1Hash } from "./portable-crypto.js";
import { E2EE_SIZE_LIMITS, E2EE_SUITE_ID } from "./suite.js";

export const ANC_V1_CONTROL_LOG_APPEND_SIGNED_ENTRY_MAX_BYTES =
  E2EE_SIZE_LIMITS.vaultLogEntryBytes;
export const ANC_V1_CONTROL_LOG_APPEND_RECOVERY_WRAP_MAX_BYTES = 1024 * 1024;
export const ANC_V1_CONTROL_LOG_APPEND_CURRENT_SNAPSHOT_MAX_BYTES =
  E2EE_SIZE_LIMITS.controlEnvelopeBytes;
export const ANC_V1_CONTROL_LOG_APPEND_RECOVERY_AUTHORIZATION_MAX_BYTES =
  1024 * 1024;
/** Includes the two bounded artifacts and the small deterministic CBOR envelope. */
export const ANC_V1_CONTROL_LOG_APPEND_REQUEST_MAX_BYTES =
  ANC_V1_CONTROL_LOG_APPEND_SIGNED_ENTRY_MAX_BYTES +
  ANC_V1_CONTROL_LOG_APPEND_RECOVERY_WRAP_MAX_BYTES +
  ANC_V1_CONTROL_LOG_APPEND_CURRENT_SNAPSHOT_MAX_BYTES +
  ANC_V1_CONTROL_LOG_APPEND_RECOVERY_AUTHORIZATION_MAX_BYTES +
  256;
export const ANC_V1_CONTROL_LOG_APPEND_RECEIPT_MAX_BYTES = 1024;

const lowerHashSchema = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]+$/);
const safeSequenceSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const boundedBytes = (maximum: number) =>
  z
    .instanceof(Uint8Array)
    .refine((value) => value.byteLength > 0 && value.byteLength <= maximum);

export const controlLogRotationAppendRequestSchema = z
  .object({
    version: z.literal(1),
    suite: z.literal(E2EE_SUITE_ID),
    type: z.literal("control-log-rotation-append-request"),
    signedEntry: boundedBytes(ANC_V1_CONTROL_LOG_APPEND_SIGNED_ENTRY_MAX_BYTES),
    recoveryWrap: boundedBytes(
      ANC_V1_CONTROL_LOG_APPEND_RECOVERY_WRAP_MAX_BYTES,
    ),
  })
  .strict();

export const controlLogRotationAppendReceiptSchema = z
  .object({
    version: z.literal(1),
    suite: z.literal(E2EE_SUITE_ID),
    type: z.literal("control-log-rotation-append-receipt"),
    vaultId: opaqueIdSchema,
    entryId: opaqueIdSchema,
    sequence: safeSequenceSchema,
    headHash: lowerHashSchema,
    recoveryWrapHash: lowerHashSchema,
    recoveryWrapByteLength: z
      .number()
      .int()
      .positive()
      .max(ANC_V1_CONTROL_LOG_APPEND_RECOVERY_WRAP_MAX_BYTES),
  })
  .strict();

export const controlLogGenesisAppendRequestSchema = z
  .object({
    version: z.literal(1),
    suite: z.literal(E2EE_SUITE_ID),
    type: z.literal("control-log-genesis-append-request"),
    signedEntry: boundedBytes(ANC_V1_CONTROL_LOG_APPEND_SIGNED_ENTRY_MAX_BYTES),
    recoveryWrap: boundedBytes(
      ANC_V1_CONTROL_LOG_APPEND_RECOVERY_WRAP_MAX_BYTES,
    ),
  })
  .strict();

export const controlLogGenesisAppendReceiptSchema = z
  .object({
    version: z.literal(1),
    suite: z.literal(E2EE_SUITE_ID),
    type: z.literal("control-log-genesis-append-receipt"),
    vaultId: opaqueIdSchema,
    entryId: opaqueIdSchema,
    sequence: z.literal(0),
    headHash: lowerHashSchema,
    recoveryWrapHash: lowerHashSchema,
    recoveryWrapByteLength: z
      .number()
      .int()
      .positive()
      .max(ANC_V1_CONTROL_LOG_APPEND_RECOVERY_WRAP_MAX_BYTES),
  })
  .strict();

export const controlLogRecoveryAppendRequestSchema = z
  .object({
    version: z.literal(1),
    suite: z.literal(E2EE_SUITE_ID),
    type: z.literal("control-log-recovery-append-request"),
    signedEntry: boundedBytes(ANC_V1_CONTROL_LOG_APPEND_SIGNED_ENTRY_MAX_BYTES),
    recoveryWrap: boundedBytes(
      ANC_V1_CONTROL_LOG_APPEND_RECOVERY_WRAP_MAX_BYTES,
    ),
    currentSnapshot: boundedBytes(
      ANC_V1_CONTROL_LOG_APPEND_CURRENT_SNAPSHOT_MAX_BYTES,
    ),
    recoveryAuthorization: boundedBytes(
      ANC_V1_CONTROL_LOG_APPEND_RECOVERY_AUTHORIZATION_MAX_BYTES,
    ),
  })
  .strict();

export const controlLogRecoveryAppendReceiptSchema =
  controlLogRotationAppendReceiptSchema.extend({
    type: z.literal("control-log-recovery-append-receipt"),
  });

export const controlLogGrantRevocationAppendRequestSchema = z
  .object({
    version: z.literal(1),
    suite: z.literal(E2EE_SUITE_ID),
    type: z.literal("control-log-grant-revocation-append-request"),
    signedEntry: boundedBytes(ANC_V1_CONTROL_LOG_APPEND_SIGNED_ENTRY_MAX_BYTES),
  })
  .strict();

export const controlLogGrantRevocationAppendReceiptSchema = z
  .object({
    version: z.literal(1),
    suite: z.literal(E2EE_SUITE_ID),
    type: z.literal("control-log-grant-revocation-append-receipt"),
    vaultId: opaqueIdSchema,
    entryId: opaqueIdSchema,
    sequence: safeSequenceSchema.refine((value) => value > 0),
    headHash: lowerHashSchema,
  })
  .strict();

export type ControlLogRotationAppendRequest = z.infer<
  typeof controlLogRotationAppendRequestSchema
>;
export type ControlLogRotationAppendReceipt = z.infer<
  typeof controlLogRotationAppendReceiptSchema
>;
export type ControlLogGenesisAppendRequest = z.infer<
  typeof controlLogGenesisAppendRequestSchema
>;
export type ControlLogGenesisAppendReceipt = z.infer<
  typeof controlLogGenesisAppendReceiptSchema
>;
export type ControlLogRecoveryAppendRequest = z.infer<
  typeof controlLogRecoveryAppendRequestSchema
>;
export type ControlLogRecoveryAppendReceipt = z.infer<
  typeof controlLogRecoveryAppendReceiptSchema
>;
export type ControlLogGrantRevocationAppendRequest = z.infer<
  typeof controlLogGrantRevocationAppendRequestSchema
>;
export type ControlLogGrantRevocationAppendReceipt = z.infer<
  typeof controlLogGrantRevocationAppendReceiptSchema
>;

export class AncV1ControlLogAppendCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AncV1ControlLogAppendCodecError";
  }
}

const REQUEST = Object.freeze({
  suite: 1,
  version: 2,
  type: 3,
  signedEntry: 4,
  recoveryWrap: 5,
});
const RECOVERY_REQUEST = Object.freeze({
  ...REQUEST,
  currentSnapshot: 6,
  recoveryAuthorization: 7,
});
const GRANT_REVOCATION_REQUEST = Object.freeze({
  suite: 1,
  version: 2,
  type: 3,
  signedEntry: 4,
});
const RECEIPT = Object.freeze({
  suite: 1,
  version: 2,
  type: 3,
  vaultId: 4,
  entryId: 5,
  sequence: 6,
  headHash: 7,
  recoveryWrapHash: 8,
  recoveryWrapByteLength: 9,
});
const GRANT_REVOCATION_RECEIPT = Object.freeze({
  suite: 1,
  version: 2,
  type: 3,
  vaultId: 4,
  entryId: 5,
  sequence: 6,
  headHash: 7,
});

function fail(message: string): never {
  throw new AncV1ControlLogAppendCodecError(message);
}

function parse<T>(schema: z.ZodType<T>, value: unknown, name: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) fail(`${name} does not match the frozen anc/v1 schema`);
  return parsed.data;
}

function field(
  map: ReadonlyMap<number, AncV1CanonicalValue>,
  key: number,
  name: string,
): AncV1CanonicalValue {
  if (!map.has(key)) fail(`Envelope is missing ${name}`);
  return map.get(key)!;
}

function bytes(value: unknown, maximum: number, name: string): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > maximum
  ) {
    fail(`${name} must contain between 1 and ${maximum} bytes`);
  }
  return value.slice();
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string") fail(`${name} must be text`);
  return value;
}

function integer(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(`${name} must be a non-negative safe integer`);
  }
  return value as number;
}

function envelope(
  encoded: Uint8Array,
  keys: readonly number[],
  maximum: number,
): ReadonlyMap<number, AncV1CanonicalValue> {
  try {
    const map = decodeAncV1Envelope(encoded, keys, { maxBytes: maximum });
    if (map.size !== keys.length) fail("Envelope is missing required fields");
    return map;
  } catch (error) {
    if (error instanceof AncV1ControlLogAppendCodecError) throw error;
    if (error instanceof AncV1CanonicalEncodingError) fail(error.message);
    throw error;
  }
}

export function encodeAncV1ControlLogRotationAppendRequest(
  value: ControlLogRotationAppendRequest,
): Uint8Array {
  const parsed = parse(
    controlLogRotationAppendRequestSchema,
    value,
    "Control-log rotation append request",
  );
  const encoded = encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [REQUEST.suite, parsed.suite],
      [REQUEST.version, parsed.version],
      [REQUEST.type, parsed.type],
      [REQUEST.signedEntry, parsed.signedEntry],
      [REQUEST.recoveryWrap, parsed.recoveryWrap],
    ]),
  );
  if (encoded.byteLength > ANC_V1_CONTROL_LOG_APPEND_REQUEST_MAX_BYTES) {
    fail("Control-log rotation append request exceeds its canonical size cap");
  }
  return encoded;
}

export function decodeAncV1ControlLogRotationAppendRequest(
  encoded: Uint8Array,
): ControlLogRotationAppendRequest {
  const map = envelope(
    encoded,
    Object.values(REQUEST),
    ANC_V1_CONTROL_LOG_APPEND_REQUEST_MAX_BYTES,
  );
  return parse(
    controlLogRotationAppendRequestSchema,
    {
      suite: text(field(map, REQUEST.suite, "suite"), "suite"),
      version: integer(field(map, REQUEST.version, "version"), "version"),
      type: text(field(map, REQUEST.type, "type"), "type"),
      signedEntry: bytes(
        field(map, REQUEST.signedEntry, "signedEntry"),
        ANC_V1_CONTROL_LOG_APPEND_SIGNED_ENTRY_MAX_BYTES,
        "signedEntry",
      ),
      recoveryWrap: bytes(
        field(map, REQUEST.recoveryWrap, "recoveryWrap"),
        ANC_V1_CONTROL_LOG_APPEND_RECOVERY_WRAP_MAX_BYTES,
        "recoveryWrap",
      ),
    },
    "Control-log rotation append request",
  );
}

export function encodeAncV1ControlLogRotationAppendReceipt(
  value: ControlLogRotationAppendReceipt,
): Uint8Array {
  const parsed = parse(
    controlLogRotationAppendReceiptSchema,
    value,
    "Control-log rotation append receipt",
  );
  const encoded = encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [RECEIPT.suite, parsed.suite],
      [RECEIPT.version, parsed.version],
      [RECEIPT.type, parsed.type],
      [RECEIPT.vaultId, parsed.vaultId],
      [RECEIPT.entryId, parsed.entryId],
      [RECEIPT.sequence, parsed.sequence],
      [RECEIPT.headHash, ancV1HexToBytes(parsed.headHash)],
      [RECEIPT.recoveryWrapHash, ancV1HexToBytes(parsed.recoveryWrapHash)],
      [RECEIPT.recoveryWrapByteLength, parsed.recoveryWrapByteLength],
    ]),
  );
  if (encoded.byteLength > ANC_V1_CONTROL_LOG_APPEND_RECEIPT_MAX_BYTES) {
    fail("Control-log rotation append receipt exceeds its canonical size cap");
  }
  return encoded;
}

export function decodeAncV1ControlLogRotationAppendReceipt(
  encoded: Uint8Array,
): ControlLogRotationAppendReceipt {
  const map = envelope(
    encoded,
    Object.values(RECEIPT),
    ANC_V1_CONTROL_LOG_APPEND_RECEIPT_MAX_BYTES,
  );
  return parse(
    controlLogRotationAppendReceiptSchema,
    {
      suite: text(field(map, RECEIPT.suite, "suite"), "suite"),
      version: integer(field(map, RECEIPT.version, "version"), "version"),
      type: text(field(map, RECEIPT.type, "type"), "type"),
      vaultId: text(field(map, RECEIPT.vaultId, "vaultId"), "vaultId"),
      entryId: text(field(map, RECEIPT.entryId, "entryId"), "entryId"),
      sequence: integer(field(map, RECEIPT.sequence, "sequence"), "sequence"),
      headHash: ancV1BytesToHex(
        bytes(field(map, RECEIPT.headHash, "headHash"), 32, "headHash"),
      ),
      recoveryWrapHash: ancV1BytesToHex(
        bytes(
          field(map, RECEIPT.recoveryWrapHash, "recoveryWrapHash"),
          32,
          "recoveryWrapHash",
        ),
      ),
      recoveryWrapByteLength: integer(
        field(map, RECEIPT.recoveryWrapByteLength, "recoveryWrapByteLength"),
        "recoveryWrapByteLength",
      ),
    },
    "Control-log rotation append receipt",
  );
}

export function encodeAncV1ControlLogRecoveryAppendRequest(
  value: ControlLogRecoveryAppendRequest,
): Uint8Array {
  const parsed = parse(
    controlLogRecoveryAppendRequestSchema,
    value,
    "Control-log recovery append request",
  );
  const encoded = encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [RECOVERY_REQUEST.suite, parsed.suite],
      [RECOVERY_REQUEST.version, parsed.version],
      [RECOVERY_REQUEST.type, parsed.type],
      [RECOVERY_REQUEST.signedEntry, parsed.signedEntry],
      [RECOVERY_REQUEST.recoveryWrap, parsed.recoveryWrap],
      [RECOVERY_REQUEST.currentSnapshot, parsed.currentSnapshot],
      [RECOVERY_REQUEST.recoveryAuthorization, parsed.recoveryAuthorization],
    ]),
  );
  if (encoded.byteLength > ANC_V1_CONTROL_LOG_APPEND_REQUEST_MAX_BYTES) {
    fail("Control-log recovery append request exceeds its canonical size cap");
  }
  return encoded;
}

export function decodeAncV1ControlLogRecoveryAppendRequest(
  encoded: Uint8Array,
): ControlLogRecoveryAppendRequest {
  const map = envelope(
    encoded,
    Object.values(RECOVERY_REQUEST),
    ANC_V1_CONTROL_LOG_APPEND_REQUEST_MAX_BYTES,
  );
  return parse(
    controlLogRecoveryAppendRequestSchema,
    {
      suite: text(field(map, RECOVERY_REQUEST.suite, "suite"), "suite"),
      version: integer(
        field(map, RECOVERY_REQUEST.version, "version"),
        "version",
      ),
      type: text(field(map, RECOVERY_REQUEST.type, "type"), "type"),
      signedEntry: bytes(
        field(map, RECOVERY_REQUEST.signedEntry, "signedEntry"),
        ANC_V1_CONTROL_LOG_APPEND_SIGNED_ENTRY_MAX_BYTES,
        "signedEntry",
      ),
      recoveryWrap: bytes(
        field(map, RECOVERY_REQUEST.recoveryWrap, "recoveryWrap"),
        ANC_V1_CONTROL_LOG_APPEND_RECOVERY_WRAP_MAX_BYTES,
        "recoveryWrap",
      ),
      currentSnapshot: bytes(
        field(map, RECOVERY_REQUEST.currentSnapshot, "currentSnapshot"),
        ANC_V1_CONTROL_LOG_APPEND_CURRENT_SNAPSHOT_MAX_BYTES,
        "currentSnapshot",
      ),
      recoveryAuthorization: bytes(
        field(
          map,
          RECOVERY_REQUEST.recoveryAuthorization,
          "recoveryAuthorization",
        ),
        ANC_V1_CONTROL_LOG_APPEND_RECOVERY_AUTHORIZATION_MAX_BYTES,
        "recoveryAuthorization",
      ),
    },
    "Control-log recovery append request",
  );
}

export function encodeAncV1ControlLogRecoveryAppendReceipt(
  value: ControlLogRecoveryAppendReceipt,
): Uint8Array {
  const parsed = parse(
    controlLogRecoveryAppendReceiptSchema,
    value,
    "Control-log recovery append receipt",
  );
  const encoded = encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [RECEIPT.suite, parsed.suite],
      [RECEIPT.version, parsed.version],
      [RECEIPT.type, parsed.type],
      [RECEIPT.vaultId, parsed.vaultId],
      [RECEIPT.entryId, parsed.entryId],
      [RECEIPT.sequence, parsed.sequence],
      [RECEIPT.headHash, ancV1HexToBytes(parsed.headHash)],
      [RECEIPT.recoveryWrapHash, ancV1HexToBytes(parsed.recoveryWrapHash)],
      [RECEIPT.recoveryWrapByteLength, parsed.recoveryWrapByteLength],
    ]),
  );
  if (encoded.byteLength > ANC_V1_CONTROL_LOG_APPEND_RECEIPT_MAX_BYTES) {
    fail("Control-log recovery append receipt exceeds its canonical size cap");
  }
  return encoded;
}

export function decodeAncV1ControlLogRecoveryAppendReceipt(
  encoded: Uint8Array,
): ControlLogRecoveryAppendReceipt {
  const map = envelope(
    encoded,
    Object.values(RECEIPT),
    ANC_V1_CONTROL_LOG_APPEND_RECEIPT_MAX_BYTES,
  );
  return parse(
    controlLogRecoveryAppendReceiptSchema,
    {
      suite: text(field(map, RECEIPT.suite, "suite"), "suite"),
      version: integer(field(map, RECEIPT.version, "version"), "version"),
      type: text(field(map, RECEIPT.type, "type"), "type"),
      vaultId: text(field(map, RECEIPT.vaultId, "vaultId"), "vaultId"),
      entryId: text(field(map, RECEIPT.entryId, "entryId"), "entryId"),
      sequence: integer(field(map, RECEIPT.sequence, "sequence"), "sequence"),
      headHash: ancV1BytesToHex(
        bytes(field(map, RECEIPT.headHash, "headHash"), 32, "headHash"),
      ),
      recoveryWrapHash: ancV1BytesToHex(
        bytes(
          field(map, RECEIPT.recoveryWrapHash, "recoveryWrapHash"),
          32,
          "recoveryWrapHash",
        ),
      ),
      recoveryWrapByteLength: integer(
        field(map, RECEIPT.recoveryWrapByteLength, "recoveryWrapByteLength"),
        "recoveryWrapByteLength",
      ),
    },
    "Control-log recovery append receipt",
  );
}

export function encodeAncV1ControlLogGrantRevocationAppendRequest(
  value: ControlLogGrantRevocationAppendRequest,
): Uint8Array {
  const parsed = parse(
    controlLogGrantRevocationAppendRequestSchema,
    value,
    "Control-log grant-revocation append request",
  );
  const encoded = encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [GRANT_REVOCATION_REQUEST.suite, parsed.suite],
      [GRANT_REVOCATION_REQUEST.version, parsed.version],
      [GRANT_REVOCATION_REQUEST.type, parsed.type],
      [GRANT_REVOCATION_REQUEST.signedEntry, parsed.signedEntry],
    ]),
  );
  if (encoded.byteLength > ANC_V1_CONTROL_LOG_APPEND_REQUEST_MAX_BYTES) {
    fail(
      "Control-log grant-revocation append request exceeds its canonical size cap",
    );
  }
  return encoded;
}

export function decodeAncV1ControlLogGrantRevocationAppendRequest(
  encoded: Uint8Array,
): ControlLogGrantRevocationAppendRequest {
  const map = envelope(
    encoded,
    Object.values(GRANT_REVOCATION_REQUEST),
    ANC_V1_CONTROL_LOG_APPEND_REQUEST_MAX_BYTES,
  );
  return parse(
    controlLogGrantRevocationAppendRequestSchema,
    {
      suite: text(field(map, GRANT_REVOCATION_REQUEST.suite, "suite"), "suite"),
      version: integer(
        field(map, GRANT_REVOCATION_REQUEST.version, "version"),
        "version",
      ),
      type: text(field(map, GRANT_REVOCATION_REQUEST.type, "type"), "type"),
      signedEntry: bytes(
        field(map, GRANT_REVOCATION_REQUEST.signedEntry, "signedEntry"),
        ANC_V1_CONTROL_LOG_APPEND_SIGNED_ENTRY_MAX_BYTES,
        "signedEntry",
      ),
    },
    "Control-log grant-revocation append request",
  );
}

export function encodeAncV1ControlLogGrantRevocationAppendReceipt(
  value: ControlLogGrantRevocationAppendReceipt,
): Uint8Array {
  const parsed = parse(
    controlLogGrantRevocationAppendReceiptSchema,
    value,
    "Control-log grant-revocation append receipt",
  );
  const encoded = encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [GRANT_REVOCATION_RECEIPT.suite, parsed.suite],
      [GRANT_REVOCATION_RECEIPT.version, parsed.version],
      [GRANT_REVOCATION_RECEIPT.type, parsed.type],
      [GRANT_REVOCATION_RECEIPT.vaultId, parsed.vaultId],
      [GRANT_REVOCATION_RECEIPT.entryId, parsed.entryId],
      [GRANT_REVOCATION_RECEIPT.sequence, parsed.sequence],
      [GRANT_REVOCATION_RECEIPT.headHash, ancV1HexToBytes(parsed.headHash)],
    ]),
  );
  if (encoded.byteLength > ANC_V1_CONTROL_LOG_APPEND_RECEIPT_MAX_BYTES) {
    fail(
      "Control-log grant-revocation append receipt exceeds its canonical size cap",
    );
  }
  return encoded;
}

export function decodeAncV1ControlLogGrantRevocationAppendReceipt(
  encoded: Uint8Array,
): ControlLogGrantRevocationAppendReceipt {
  const map = envelope(
    encoded,
    Object.values(GRANT_REVOCATION_RECEIPT),
    ANC_V1_CONTROL_LOG_APPEND_RECEIPT_MAX_BYTES,
  );
  return parse(
    controlLogGrantRevocationAppendReceiptSchema,
    {
      suite: text(field(map, GRANT_REVOCATION_RECEIPT.suite, "suite"), "suite"),
      version: integer(
        field(map, GRANT_REVOCATION_RECEIPT.version, "version"),
        "version",
      ),
      type: text(field(map, GRANT_REVOCATION_RECEIPT.type, "type"), "type"),
      vaultId: text(
        field(map, GRANT_REVOCATION_RECEIPT.vaultId, "vaultId"),
        "vaultId",
      ),
      entryId: text(
        field(map, GRANT_REVOCATION_RECEIPT.entryId, "entryId"),
        "entryId",
      ),
      sequence: integer(
        field(map, GRANT_REVOCATION_RECEIPT.sequence, "sequence"),
        "sequence",
      ),
      headHash: ancV1BytesToHex(
        bytes(
          field(map, GRANT_REVOCATION_RECEIPT.headHash, "headHash"),
          32,
          "headHash",
        ),
      ),
    },
    "Control-log grant-revocation append receipt",
  );
}

export function encodeAncV1ControlLogGenesisAppendRequest(
  value: ControlLogGenesisAppendRequest,
): Uint8Array {
  const parsed = parse(
    controlLogGenesisAppendRequestSchema,
    value,
    "Control-log genesis append request",
  );
  const encoded = encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [REQUEST.suite, parsed.suite],
      [REQUEST.version, parsed.version],
      [REQUEST.type, parsed.type],
      [REQUEST.signedEntry, parsed.signedEntry],
      [REQUEST.recoveryWrap, parsed.recoveryWrap],
    ]),
  );
  if (encoded.byteLength > ANC_V1_CONTROL_LOG_APPEND_REQUEST_MAX_BYTES) {
    fail("Control-log genesis append request exceeds its canonical size cap");
  }
  return encoded;
}

export function decodeAncV1ControlLogGenesisAppendRequest(
  encoded: Uint8Array,
): ControlLogGenesisAppendRequest {
  const map = envelope(
    encoded,
    Object.values(REQUEST),
    ANC_V1_CONTROL_LOG_APPEND_REQUEST_MAX_BYTES,
  );
  return parse(
    controlLogGenesisAppendRequestSchema,
    {
      suite: text(field(map, REQUEST.suite, "suite"), "suite"),
      version: integer(field(map, REQUEST.version, "version"), "version"),
      type: text(field(map, REQUEST.type, "type"), "type"),
      signedEntry: bytes(
        field(map, REQUEST.signedEntry, "signedEntry"),
        ANC_V1_CONTROL_LOG_APPEND_SIGNED_ENTRY_MAX_BYTES,
        "signedEntry",
      ),
      recoveryWrap: bytes(
        field(map, REQUEST.recoveryWrap, "recoveryWrap"),
        ANC_V1_CONTROL_LOG_APPEND_RECOVERY_WRAP_MAX_BYTES,
        "recoveryWrap",
      ),
    },
    "Control-log genesis append request",
  );
}

export function encodeAncV1ControlLogGenesisAppendReceipt(
  value: ControlLogGenesisAppendReceipt,
): Uint8Array {
  const parsed = parse(
    controlLogGenesisAppendReceiptSchema,
    value,
    "Control-log genesis append receipt",
  );
  const encoded = encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [RECEIPT.suite, parsed.suite],
      [RECEIPT.version, parsed.version],
      [RECEIPT.type, parsed.type],
      [RECEIPT.vaultId, parsed.vaultId],
      [RECEIPT.entryId, parsed.entryId],
      [RECEIPT.sequence, parsed.sequence],
      [RECEIPT.headHash, ancV1HexToBytes(parsed.headHash)],
      [RECEIPT.recoveryWrapHash, ancV1HexToBytes(parsed.recoveryWrapHash)],
      [RECEIPT.recoveryWrapByteLength, parsed.recoveryWrapByteLength],
    ]),
  );
  if (encoded.byteLength > ANC_V1_CONTROL_LOG_APPEND_RECEIPT_MAX_BYTES) {
    fail("Control-log genesis append receipt exceeds its canonical size cap");
  }
  return encoded;
}

export function decodeAncV1ControlLogGenesisAppendReceipt(
  encoded: Uint8Array,
): ControlLogGenesisAppendReceipt {
  const map = envelope(
    encoded,
    Object.values(RECEIPT),
    ANC_V1_CONTROL_LOG_APPEND_RECEIPT_MAX_BYTES,
  );
  return parse(
    controlLogGenesisAppendReceiptSchema,
    {
      suite: text(field(map, RECEIPT.suite, "suite"), "suite"),
      version: integer(field(map, RECEIPT.version, "version"), "version"),
      type: text(field(map, RECEIPT.type, "type"), "type"),
      vaultId: text(field(map, RECEIPT.vaultId, "vaultId"), "vaultId"),
      entryId: text(field(map, RECEIPT.entryId, "entryId"), "entryId"),
      sequence: integer(field(map, RECEIPT.sequence, "sequence"), "sequence"),
      headHash: ancV1BytesToHex(
        bytes(field(map, RECEIPT.headHash, "headHash"), 32, "headHash"),
      ),
      recoveryWrapHash: ancV1BytesToHex(
        bytes(
          field(map, RECEIPT.recoveryWrapHash, "recoveryWrapHash"),
          32,
          "recoveryWrapHash",
        ),
      ),
      recoveryWrapByteLength: integer(
        field(map, RECEIPT.recoveryWrapByteLength, "recoveryWrapByteLength"),
        "recoveryWrapByteLength",
      ),
    },
    "Control-log genesis append receipt",
  );
}

export async function hashAncV1ControlLogGenesisAppendReceipt(
  encoded: Uint8Array,
): Promise<Uint8Array> {
  decodeAncV1ControlLogGenesisAppendReceipt(encoded);
  return ancV1Hash("genesis-hosted-append-receipt", encoded.slice());
}
