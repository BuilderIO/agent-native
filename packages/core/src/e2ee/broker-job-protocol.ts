import { z } from "zod";

import {
  opaqueAlgorithmIdSchema,
  opaqueIdSchema,
  protocolTimestampSchema,
} from "./contracts.js";
import { E2EE_SIZE_LIMITS, E2EE_SUITE_ID } from "./suite.js";

export const ANC_V1_BROKER_CONTROL_MAX_BYTES = 8 * 1024;
export const ANC_V1_BROKER_JOB_FRAME_MAX_BYTES =
  4 + ANC_V1_BROKER_CONTROL_MAX_BYTES + E2EE_SIZE_LIMITS.jobEnvelopeBytes;
export const ANC_V1_BROKER_RESULT_FRAME_MAX_BYTES =
  4 + ANC_V1_BROKER_CONTROL_MAX_BYTES + E2EE_SIZE_LIMITS.resultEnvelopeBytes;

const header = {
  version: z.literal(1),
  suite: z.literal(E2EE_SUITE_ID),
};
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const retryCount = z.number().int().nonnegative().max(100);
const ciphertextByteLength = (maximum: number) =>
  z.number().int().positive().max(maximum);

export const ancV1BrokerClaimRequestSchema = z
  .object({ ...header, type: z.literal("broker-job-claim-request") })
  .strict();

export const ancV1BrokerClaimedJobSchema = z
  .object({
    jobId: opaqueIdSchema,
    grantId: opaqueIdSchema,
    epoch: positive,
    retryCount,
    algorithmId: opaqueAlgorithmIdSchema,
    ciphertextByteLength: ciphertextByteLength(
      E2EE_SIZE_LIMITS.jobEnvelopeBytes,
    ),
  })
  .strict();

export const ancV1BrokerClaimResponseSchema = z
  .object({
    ...header,
    type: z.literal("broker-job-claim-response"),
    job: ancV1BrokerClaimedJobSchema.nullable(),
  })
  .strict();

export const ancV1BrokerRequestRequestSchema = z
  .object({
    ...header,
    type: z.literal("broker-job-request-request"),
    jobId: opaqueIdSchema,
    retryCount,
  })
  .strict();

export const ancV1BrokerRequestFrameMetadataSchema = z
  .object({
    ...header,
    type: z.literal("broker-job-request-response"),
    jobId: opaqueIdSchema,
    epoch: positive,
    retryCount,
    algorithmId: opaqueAlgorithmIdSchema,
    ciphertextByteLength: ciphertextByteLength(
      E2EE_SIZE_LIMITS.jobEnvelopeBytes,
    ),
  })
  .strict();

export const ancV1BrokerAckRequestSchema = z
  .object({
    ...header,
    type: z.literal("broker-job-ack-request"),
    jobId: opaqueIdSchema,
    retryCount,
  })
  .strict();

export const ancV1BrokerAckResponseSchema = z
  .object({
    ...header,
    type: z.literal("broker-job-ack-response"),
    jobId: opaqueIdSchema,
    retryCount,
    state: z.literal("acknowledged"),
  })
  .strict();

export const ancV1BrokerRetryRequestSchema = z
  .object({
    ...header,
    type: z.literal("broker-job-retry-request"),
    jobId: opaqueIdSchema,
    retryCount,
    retryAt: protocolTimestampSchema,
  })
  .strict();

export const ancV1BrokerRetryResponseSchema = z
  .object({
    ...header,
    type: z.literal("broker-job-retry-response"),
    jobId: opaqueIdSchema,
    retryCount,
    retryAt: protocolTimestampSchema,
    state: z.literal("retry_wait"),
  })
  .strict();

export const ancV1BrokerResultFrameMetadataSchema = z
  .object({
    ...header,
    type: z.literal("broker-job-result-request"),
    jobId: opaqueIdSchema,
    epoch: positive,
    retryCount,
    jobHash: opaqueIdSchema,
    algorithmId: opaqueAlgorithmIdSchema,
    state: z.enum(["completed", "failed"]),
    ciphertextByteLength: ciphertextByteLength(
      E2EE_SIZE_LIMITS.resultEnvelopeBytes,
    ),
  })
  .strict();

export const ancV1BrokerResultResponseSchema = z
  .object({
    ...header,
    type: z.literal("broker-job-result-response"),
    jobId: opaqueIdSchema,
    retryCount,
    state: z.enum(["completed", "failed"]),
  })
  .strict();

export type AncV1BrokerClaimRequest = z.infer<
  typeof ancV1BrokerClaimRequestSchema
>;
export type AncV1BrokerClaimResponse = z.infer<
  typeof ancV1BrokerClaimResponseSchema
>;
export type AncV1BrokerRequestRequest = z.infer<
  typeof ancV1BrokerRequestRequestSchema
>;
export type AncV1BrokerRequestFrameMetadata = z.infer<
  typeof ancV1BrokerRequestFrameMetadataSchema
>;
export type AncV1BrokerAckRequest = z.infer<typeof ancV1BrokerAckRequestSchema>;
export type AncV1BrokerAckResponse = z.infer<
  typeof ancV1BrokerAckResponseSchema
>;
export type AncV1BrokerRetryRequest = z.infer<
  typeof ancV1BrokerRetryRequestSchema
>;
export type AncV1BrokerRetryResponse = z.infer<
  typeof ancV1BrokerRetryResponseSchema
>;
export type AncV1BrokerResultFrameMetadata = z.infer<
  typeof ancV1BrokerResultFrameMetadataSchema
>;
export type AncV1BrokerResultResponse = z.infer<
  typeof ancV1BrokerResultResponseSchema
>;

export class AncV1BrokerJobProtocolError extends Error {
  constructor() {
    super("Broker job protocol data is invalid");
    this.name = "AncV1BrokerJobProtocolError";
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function fail(): never {
  throw new AncV1BrokerJobProtocolError();
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
      encoded.byteLength > ANC_V1_BROKER_CONTROL_MAX_BYTES
    ) {
      fail();
    }
    return encoded;
  } catch (error) {
    if (error instanceof AncV1BrokerJobProtocolError) throw error;
    fail();
  }
}

function decodeControl<Schema extends z.ZodType>(
  schema: Schema,
  encoded: Uint8Array,
): z.output<Schema> {
  if (
    !(encoded instanceof Uint8Array) ||
    encoded.byteLength === 0 ||
    encoded.byteLength > ANC_V1_BROKER_CONTROL_MAX_BYTES
  ) {
    fail();
  }
  try {
    const parsed = schema.parse(JSON.parse(decoder.decode(encoded)));
    if (!sameBytes(encodeControl(schema, parsed as z.input<Schema>), encoded))
      fail();
    return parsed;
  } catch (error) {
    if (error instanceof AncV1BrokerJobProtocolError) throw error;
    fail();
  }
}

function encodeFrame<Metadata extends { ciphertextByteLength: number }>(
  schema: z.ZodType<Metadata>,
  metadata: Omit<Metadata, "ciphertextByteLength">,
  ciphertext: Uint8Array,
  maximumCiphertextBytes: number,
): Uint8Array {
  if (
    !(ciphertext instanceof Uint8Array) ||
    ciphertext.byteLength === 0 ||
    ciphertext.byteLength > maximumCiphertextBytes
  ) {
    fail();
  }
  const encodedMetadata = encodeControl(schema, {
    ...metadata,
    ciphertextByteLength: ciphertext.byteLength,
  } as Metadata);
  const frame = new Uint8Array(
    4 + encodedMetadata.byteLength + ciphertext.byteLength,
  );
  new DataView(frame.buffer).setUint32(0, encodedMetadata.byteLength, false);
  frame.set(encodedMetadata, 4);
  frame.set(ciphertext, 4 + encodedMetadata.byteLength);
  return frame;
}

function decodeFrame<Metadata extends { ciphertextByteLength: number }>(
  schema: z.ZodType<Metadata>,
  frame: Uint8Array,
  maximumCiphertextBytes: number,
): { metadata: Metadata; ciphertext: Uint8Array } {
  if (
    !(frame instanceof Uint8Array) ||
    frame.byteLength < 5 ||
    frame.byteLength >
      4 + ANC_V1_BROKER_CONTROL_MAX_BYTES + maximumCiphertextBytes
  ) {
    fail();
  }
  const metadataLength = new DataView(
    frame.buffer,
    frame.byteOffset,
    4,
  ).getUint32(0, false);
  if (
    metadataLength === 0 ||
    metadataLength > ANC_V1_BROKER_CONTROL_MAX_BYTES ||
    4 + metadataLength >= frame.byteLength
  ) {
    fail();
  }
  const metadata = decodeControl(schema, frame.subarray(4, 4 + metadataLength));
  if (4 + metadataLength + metadata.ciphertextByteLength !== frame.byteLength) {
    fail();
  }
  return {
    metadata,
    ciphertext: frame.slice(4 + metadataLength),
  };
}

export const encodeAncV1BrokerClaimRequest = (value: AncV1BrokerClaimRequest) =>
  encodeControl(ancV1BrokerClaimRequestSchema, value);
export const decodeAncV1BrokerClaimRequest = (value: Uint8Array) =>
  decodeControl(ancV1BrokerClaimRequestSchema, value);
export const encodeAncV1BrokerClaimResponse = (
  value: AncV1BrokerClaimResponse,
) => encodeControl(ancV1BrokerClaimResponseSchema, value);
export const decodeAncV1BrokerClaimResponse = (value: Uint8Array) =>
  decodeControl(ancV1BrokerClaimResponseSchema, value);
export const encodeAncV1BrokerRequestRequest = (
  value: AncV1BrokerRequestRequest,
) => encodeControl(ancV1BrokerRequestRequestSchema, value);
export const decodeAncV1BrokerRequestRequest = (value: Uint8Array) =>
  decodeControl(ancV1BrokerRequestRequestSchema, value);
export function encodeAncV1BrokerRequestFrame(
  metadata: Omit<AncV1BrokerRequestFrameMetadata, "ciphertextByteLength">,
  ciphertext: Uint8Array,
): Uint8Array {
  return encodeFrame(
    ancV1BrokerRequestFrameMetadataSchema,
    metadata,
    ciphertext,
    E2EE_SIZE_LIMITS.jobEnvelopeBytes,
  );
}
export const decodeAncV1BrokerRequestFrame = (value: Uint8Array) =>
  decodeFrame(
    ancV1BrokerRequestFrameMetadataSchema,
    value,
    E2EE_SIZE_LIMITS.jobEnvelopeBytes,
  );
export const encodeAncV1BrokerAckRequest = (value: AncV1BrokerAckRequest) =>
  encodeControl(ancV1BrokerAckRequestSchema, value);
export const decodeAncV1BrokerAckRequest = (value: Uint8Array) =>
  decodeControl(ancV1BrokerAckRequestSchema, value);
export const encodeAncV1BrokerAckResponse = (value: AncV1BrokerAckResponse) =>
  encodeControl(ancV1BrokerAckResponseSchema, value);
export const decodeAncV1BrokerAckResponse = (value: Uint8Array) =>
  decodeControl(ancV1BrokerAckResponseSchema, value);
export const encodeAncV1BrokerRetryRequest = (value: AncV1BrokerRetryRequest) =>
  encodeControl(ancV1BrokerRetryRequestSchema, value);
export const decodeAncV1BrokerRetryRequest = (value: Uint8Array) =>
  decodeControl(ancV1BrokerRetryRequestSchema, value);
export const encodeAncV1BrokerRetryResponse = (
  value: AncV1BrokerRetryResponse,
) => encodeControl(ancV1BrokerRetryResponseSchema, value);
export const decodeAncV1BrokerRetryResponse = (value: Uint8Array) =>
  decodeControl(ancV1BrokerRetryResponseSchema, value);
export function encodeAncV1BrokerResultFrame(
  metadata: Omit<AncV1BrokerResultFrameMetadata, "ciphertextByteLength">,
  ciphertext: Uint8Array,
): Uint8Array {
  return encodeFrame(
    ancV1BrokerResultFrameMetadataSchema,
    metadata,
    ciphertext,
    E2EE_SIZE_LIMITS.resultEnvelopeBytes,
  );
}
export const decodeAncV1BrokerResultFrame = (value: Uint8Array) =>
  decodeFrame(
    ancV1BrokerResultFrameMetadataSchema,
    value,
    E2EE_SIZE_LIMITS.resultEnvelopeBytes,
  );
export const encodeAncV1BrokerResultResponse = (
  value: AncV1BrokerResultResponse,
) => encodeControl(ancV1BrokerResultResponseSchema, value);
export const decodeAncV1BrokerResultResponse = (value: Uint8Array) =>
  decodeControl(ancV1BrokerResultResponseSchema, value);
