import { E2EE_SIZE_LIMITS, opaqueIdSchema } from "@agent-native/core/e2ee";

export const BROKER_RESULT_METADATA_MAX_BYTES = 8 * 1024;
export const BROKER_RESULT_FRAME_MAX_BYTES =
  4 + BROKER_RESULT_METADATA_MAX_BYTES + E2EE_SIZE_LIMITS.resultEnvelopeBytes;

export interface BrokerResultFrameMetadata {
  readonly version: 1;
  readonly jobId: string;
  readonly state: "completed" | "failed";
  readonly ciphertextLength: number;
}

export interface BrokerResultFrame {
  readonly metadata: BrokerResultFrameMetadata;
  readonly ciphertext: Uint8Array;
}

export class BrokerResultFrameError extends Error {
  constructor() {
    super("Broker result frame is invalid");
    this.name = "BrokerResultFrameError";
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const METADATA_KEYS = [
  "ciphertextLength",
  "jobId",
  "state",
  "version",
] as const;

function fail(): never {
  throw new BrokerResultFrameError();
}

function parseMetadata(value: unknown): BrokerResultFrameMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const record = value as Record<string, unknown>;
  if (
    Object.getPrototypeOf(record) !== Object.prototype ||
    Object.keys(record).sort().join("\0") !== METADATA_KEYS.join("\0") ||
    record.version !== 1 ||
    (record.state !== "completed" && record.state !== "failed") ||
    !Number.isSafeInteger(record.ciphertextLength) ||
    (record.ciphertextLength as number) < 0 ||
    (record.ciphertextLength as number) > E2EE_SIZE_LIMITS.resultEnvelopeBytes
  ) {
    fail();
  }
  let jobId: string;
  try {
    jobId = opaqueIdSchema.parse(record.jobId);
  } catch {
    fail();
  }
  return {
    ciphertextLength: record.ciphertextLength as number,
    jobId,
    state: record.state as "completed" | "failed",
    version: 1,
  };
}

export function encodeBrokerResultMetadata(
  metadata: BrokerResultFrameMetadata,
): Uint8Array {
  const parsed = parseMetadata(metadata);
  const encoded = encoder.encode(JSON.stringify(parsed));
  if (
    encoded.byteLength === 0 ||
    encoded.byteLength > BROKER_RESULT_METADATA_MAX_BYTES
  ) {
    fail();
  }
  return encoded;
}

export function decodeBrokerResultMetadata(
  encoded: Uint8Array,
): BrokerResultFrameMetadata {
  if (
    !(encoded instanceof Uint8Array) ||
    encoded.byteLength === 0 ||
    encoded.byteLength > BROKER_RESULT_METADATA_MAX_BYTES
  ) {
    fail();
  }
  let parsed: BrokerResultFrameMetadata;
  try {
    parsed = parseMetadata(JSON.parse(decoder.decode(encoded)));
  } catch {
    fail();
  }
  const canonical = encodeBrokerResultMetadata(parsed);
  if (
    canonical.byteLength !== encoded.byteLength ||
    canonical.some((byte, index) => byte !== encoded[index])
  ) {
    fail();
  }
  return parsed;
}

export function encodeBrokerResultFrame(
  metadata: Omit<BrokerResultFrameMetadata, "ciphertextLength">,
  ciphertext: Uint8Array,
): Uint8Array {
  if (
    !(ciphertext instanceof Uint8Array) ||
    ciphertext.byteLength > E2EE_SIZE_LIMITS.resultEnvelopeBytes
  ) {
    fail();
  }
  const encodedMetadata = encodeBrokerResultMetadata({
    ...metadata,
    ciphertextLength: ciphertext.byteLength,
  });
  const totalLength = 4 + encodedMetadata.byteLength + ciphertext.byteLength;
  if (totalLength > BROKER_RESULT_FRAME_MAX_BYTES) fail();
  const frame = new Uint8Array(totalLength);
  new DataView(frame.buffer).setUint32(0, encodedMetadata.byteLength, false);
  frame.set(encodedMetadata, 4);
  frame.set(ciphertext, 4 + encodedMetadata.byteLength);
  return frame;
}

export function decodeBrokerResultFrame(frame: Uint8Array): BrokerResultFrame {
  if (
    !(frame instanceof Uint8Array) ||
    frame.byteLength < 4 ||
    frame.byteLength > BROKER_RESULT_FRAME_MAX_BYTES
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
    metadataLength > BROKER_RESULT_METADATA_MAX_BYTES ||
    4 + metadataLength > frame.byteLength
  ) {
    fail();
  }
  const metadata = decodeBrokerResultMetadata(
    frame.subarray(4, 4 + metadataLength),
  );
  const expectedLength = 4 + metadataLength + metadata.ciphertextLength;
  if (expectedLength !== frame.byteLength) fail();
  return {
    metadata,
    ciphertext: frame.slice(4 + metadataLength),
  };
}
