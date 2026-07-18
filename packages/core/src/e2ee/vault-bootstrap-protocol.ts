import { z } from "zod";

import { opaqueIdSchema } from "./contracts.js";
import { E2EE_SIZE_LIMITS, E2EE_SUITE_ID } from "./suite.js";

export const ANC_V1_VAULT_BOOTSTRAP_CONTROL_MAX_BYTES = 8 * 1024;
export const ANC_V1_VAULT_BOOTSTRAP_PAGE_MAX_ENTRIES = 8;
export const ANC_V1_VAULT_BOOTSTRAP_RECOVERY_WRAP_MAX_BYTES = 1024 * 1024;
export const ANC_V1_VAULT_BOOTSTRAP_FRAME_MAX_BYTES =
  4 +
  ANC_V1_VAULT_BOOTSTRAP_CONTROL_MAX_BYTES +
  ANC_V1_VAULT_BOOTSTRAP_PAGE_MAX_ENTRIES *
    (E2EE_SIZE_LIMITS.vaultLogEntryBytes +
      ANC_V1_VAULT_BOOTSTRAP_RECOVERY_WRAP_MAX_BYTES) +
  ANC_V1_VAULT_BOOTSTRAP_RECOVERY_WRAP_MAX_BYTES;

const sequence = z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER);
const committedSequence = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const byteLength = z
  .number()
  .int()
  .positive()
  .max(E2EE_SIZE_LIMITS.vaultLogEntryBytes);
const recoveryWrapByteLength = z
  .number()
  .int()
  .nonnegative()
  .max(ANC_V1_VAULT_BOOTSTRAP_RECOVERY_WRAP_MAX_BYTES);

export const ancV1VaultBootstrapHeadSchema = z
  .object({ sequence: committedSequence, hash })
  .strict();

export const ancV1VaultBootstrapRequestSchema = z
  .object({
    version: z.literal(1),
    suite: z.literal(E2EE_SUITE_ID),
    type: z.literal("vault-bootstrap-request"),
    afterSequence: sequence,
    expectedHead: ancV1VaultBootstrapHeadSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.afterSequence === -1) !== (value.expectedHead === null)) {
      context.addIssue({
        code: "custom",
        message: "Initial and continued bootstrap requests must be explicit",
      });
    }
    if (
      value.expectedHead &&
      value.afterSequence > value.expectedHead.sequence
    ) {
      context.addIssue({
        code: "custom",
        message: "Bootstrap cursor cannot exceed the pinned head",
      });
    }
  });

export const ancV1VaultBootstrapResponseMetadataSchema = z
  .object({
    version: z.literal(1),
    suite: z.literal(E2EE_SUITE_ID),
    type: z.literal("vault-bootstrap-response"),
    vaultId: opaqueIdSchema,
    afterSequence: sequence,
    throughSequence: sequence,
    head: ancV1VaultBootstrapHeadSchema,
    complete: z.boolean(),
    entryByteLengths: z
      .array(byteLength)
      .max(ANC_V1_VAULT_BOOTSTRAP_PAGE_MAX_ENTRIES),
    entryRecoveryWrapByteLengths: z
      .array(recoveryWrapByteLength)
      .max(ANC_V1_VAULT_BOOTSTRAP_PAGE_MAX_ENTRIES),
    recoveryWrapHash: hash.nullable(),
    recoveryWrapByteLength: z
      .number()
      .int()
      .nonnegative()
      .max(ANC_V1_VAULT_BOOTSTRAP_RECOVERY_WRAP_MAX_BYTES),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedThrough = value.afterSequence + value.entryByteLengths.length;
    if (
      value.entryRecoveryWrapByteLengths.length !==
      value.entryByteLengths.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Bootstrap entry and recovery-wrap vectors differ",
      });
    }
    if (value.throughSequence !== expectedThrough) {
      context.addIssue({
        code: "custom",
        message: "Bootstrap page is not contiguous",
      });
    }
    if (value.throughSequence > value.head.sequence) {
      context.addIssue({
        code: "custom",
        message: "Bootstrap page exceeds its head",
      });
    }
    if (value.complete !== (value.throughSequence === value.head.sequence)) {
      context.addIssue({
        code: "custom",
        message: "Bootstrap completion is invalid",
      });
    }
    if (
      value.complete !==
      (value.recoveryWrapHash !== null && value.recoveryWrapByteLength > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Recovery wrap placement is invalid",
      });
    }
  });

export type AncV1VaultBootstrapRequest = z.infer<
  typeof ancV1VaultBootstrapRequestSchema
>;
export type AncV1VaultBootstrapResponseMetadata = z.infer<
  typeof ancV1VaultBootstrapResponseMetadataSchema
>;

export interface AncV1VaultBootstrapResponse {
  readonly metadata: AncV1VaultBootstrapResponseMetadata;
  readonly entries: readonly Uint8Array[];
  readonly entryRecoveryWraps: readonly (Uint8Array | null)[];
  readonly recoveryWrap: Uint8Array | null;
}

export class AncV1VaultBootstrapProtocolError extends Error {
  constructor() {
    super("Vault bootstrap protocol data is invalid");
    this.name = "AncV1VaultBootstrapProtocolError";
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function fail(): never {
  throw new AncV1VaultBootstrapProtocolError();
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let different = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    different |= left[index]! ^ right[index]!;
  }
  return different === 0;
}

function encodeControl<Schema extends z.ZodType>(
  schema: Schema,
  value: z.input<Schema>,
): Uint8Array {
  try {
    const encoded = encoder.encode(JSON.stringify(schema.parse(value)));
    if (
      encoded.byteLength === 0 ||
      encoded.byteLength > ANC_V1_VAULT_BOOTSTRAP_CONTROL_MAX_BYTES
    ) {
      fail();
    }
    return encoded;
  } catch (error) {
    if (error instanceof AncV1VaultBootstrapProtocolError) throw error;
    return fail();
  }
}

function decodeControl<Schema extends z.ZodType>(
  schema: Schema,
  encoded: Uint8Array,
): z.output<Schema> {
  if (
    !(encoded instanceof Uint8Array) ||
    encoded.byteLength === 0 ||
    encoded.byteLength > ANC_V1_VAULT_BOOTSTRAP_CONTROL_MAX_BYTES
  ) {
    fail();
  }
  try {
    const parsed = schema.parse(JSON.parse(decoder.decode(encoded)));
    if (!sameBytes(encodeControl(schema, parsed as z.input<Schema>), encoded)) {
      fail();
    }
    return parsed;
  } catch (error) {
    if (error instanceof AncV1VaultBootstrapProtocolError) throw error;
    fail();
  }
}

export function encodeAncV1VaultBootstrapRequest(
  request: AncV1VaultBootstrapRequest,
): Uint8Array {
  return encodeControl(ancV1VaultBootstrapRequestSchema, request);
}

export function decodeAncV1VaultBootstrapRequest(
  encoded: Uint8Array,
): AncV1VaultBootstrapRequest {
  return decodeControl(ancV1VaultBootstrapRequestSchema, encoded);
}

export function encodeAncV1VaultBootstrapResponse(input: {
  metadata: Omit<
    AncV1VaultBootstrapResponseMetadata,
    | "entryByteLengths"
    | "entryRecoveryWrapByteLengths"
    | "recoveryWrapByteLength"
  >;
  entries: readonly Uint8Array[];
  entryRecoveryWraps: readonly (Uint8Array | null)[];
  recoveryWrap: Uint8Array | null;
}): Uint8Array {
  if (
    !Array.isArray(input.entries) ||
    input.entries.length > ANC_V1_VAULT_BOOTSTRAP_PAGE_MAX_ENTRIES ||
    !Array.isArray(input.entryRecoveryWraps) ||
    input.entryRecoveryWraps.length !== input.entries.length
  ) {
    fail();
  }
  const entries = input.entries.map((entry) => {
    if (
      !(entry instanceof Uint8Array) ||
      entry.byteLength === 0 ||
      entry.byteLength > E2EE_SIZE_LIMITS.vaultLogEntryBytes
    ) {
      fail();
    }
    return Uint8Array.from(entry);
  });
  const recoveryWrap =
    input.recoveryWrap === null ? null : Uint8Array.from(input.recoveryWrap);
  if (
    recoveryWrap &&
    (recoveryWrap.byteLength === 0 ||
      recoveryWrap.byteLength > ANC_V1_VAULT_BOOTSTRAP_RECOVERY_WRAP_MAX_BYTES)
  ) {
    fail();
  }
  const entryRecoveryWraps = input.entryRecoveryWraps.map((wrap) => {
    if (wrap === null) return null;
    if (
      !(wrap instanceof Uint8Array) ||
      wrap.byteLength === 0 ||
      wrap.byteLength > ANC_V1_VAULT_BOOTSTRAP_RECOVERY_WRAP_MAX_BYTES
    ) {
      fail();
    }
    return Uint8Array.from(wrap);
  });
  try {
    const metadata = ancV1VaultBootstrapResponseMetadataSchema.parse({
      ...input.metadata,
      entryByteLengths: entries.map((entry) => entry.byteLength),
      entryRecoveryWrapByteLengths: entryRecoveryWraps.map(
        (wrap) => wrap?.byteLength ?? 0,
      ),
      recoveryWrapByteLength: recoveryWrap?.byteLength ?? 0,
    });
    const control = encodeControl(
      ancV1VaultBootstrapResponseMetadataSchema,
      metadata,
    );
    const total =
      4 +
      control.byteLength +
      entries.reduce((sum, entry) => sum + entry.byteLength, 0) +
      entryRecoveryWraps.reduce(
        (sum, wrap) => sum + (wrap?.byteLength ?? 0),
        0,
      ) +
      (recoveryWrap?.byteLength ?? 0);
    if (total > ANC_V1_VAULT_BOOTSTRAP_FRAME_MAX_BYTES) fail();
    const output = new Uint8Array(total);
    new DataView(output.buffer).setUint32(0, control.byteLength, false);
    output.set(control, 4);
    let offset = 4 + control.byteLength;
    for (const [index, entry] of entries.entries()) {
      output.set(entry, offset);
      offset += entry.byteLength;
      const entryRecoveryWrap = entryRecoveryWraps[index];
      if (entryRecoveryWrap) {
        output.set(entryRecoveryWrap, offset);
        offset += entryRecoveryWrap.byteLength;
      }
    }
    if (recoveryWrap) output.set(recoveryWrap, offset);
    return output;
  } catch (error) {
    if (error instanceof AncV1VaultBootstrapProtocolError) throw error;
    return fail();
  } finally {
    for (const entry of entries) entry.fill(0);
    for (const wrap of entryRecoveryWraps) wrap?.fill(0);
    recoveryWrap?.fill(0);
  }
}

export function decodeAncV1VaultBootstrapResponse(
  encoded: Uint8Array,
): AncV1VaultBootstrapResponse {
  if (
    !(encoded instanceof Uint8Array) ||
    encoded.byteLength < 5 ||
    encoded.byteLength > ANC_V1_VAULT_BOOTSTRAP_FRAME_MAX_BYTES
  ) {
    fail();
  }
  const controlLength = new DataView(
    encoded.buffer,
    encoded.byteOffset,
    encoded.byteLength,
  ).getUint32(0, false);
  if (
    controlLength === 0 ||
    controlLength > ANC_V1_VAULT_BOOTSTRAP_CONTROL_MAX_BYTES ||
    4 + controlLength > encoded.byteLength
  ) {
    fail();
  }
  const metadata = decodeControl(
    ancV1VaultBootstrapResponseMetadataSchema,
    encoded.slice(4, 4 + controlLength),
  );
  let offset = 4 + controlLength;
  const entries: Uint8Array[] = [];
  const entryRecoveryWraps: Array<Uint8Array | null> = [];
  for (const [index, length] of metadata.entryByteLengths.entries()) {
    const end = offset + length;
    if (!Number.isSafeInteger(end) || end > encoded.byteLength) fail();
    const entry = encoded.slice(offset, end);
    offset = end;
    entries.push(entry);
    const wrapLength = metadata.entryRecoveryWrapByteLengths[index]!;
    const wrapEnd = offset + wrapLength;
    if (!Number.isSafeInteger(wrapEnd) || wrapEnd > encoded.byteLength) fail();
    entryRecoveryWraps.push(
      wrapLength === 0 ? null : encoded.slice(offset, wrapEnd),
    );
    offset = wrapEnd;
  }
  const expectedEnd = offset + metadata.recoveryWrapByteLength;
  if (expectedEnd !== encoded.byteLength) fail();
  return {
    metadata,
    entries,
    entryRecoveryWraps,
    recoveryWrap:
      metadata.recoveryWrapByteLength === 0
        ? null
        : encoded.slice(offset, expectedEnd),
  };
}
