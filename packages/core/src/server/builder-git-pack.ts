import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

const MAX_BUNDLE_HEADER_BYTES = 64 * 1024;
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const MAX_OBJECT_COUNT = 50_000;
const MAX_OBJECT_BYTES = 8 * 1024 * 1024;
const MAX_AGGREGATE_OBJECT_BYTES = 128 * 1024 * 1024;
const MAX_DELTA_OPERATION_COUNT = 100_000;
const PACK_TRAILER_BYTES = 20;

export type BuilderGitPackErrorCode = "invalid_bundle" | "resource_limit";

export class BuilderGitPackError extends Error {
  constructor(readonly code: BuilderGitPackErrorCode) {
    super(code);
    this.name = "BuilderGitPackError";
  }
}

function fail(code: BuilderGitPackErrorCode): never {
  throw new BuilderGitPackError(code);
}

function readByte(
  bytes: Uint8Array,
  offset: number,
  limit = bytes.byteLength,
): number {
  const value = bytes.at(offset);
  if (offset < 0 || offset >= limit || value === undefined) {
    fail("invalid_bundle");
  }
  return value;
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) fail("invalid_bundle");
  return (
    readByte(bytes, offset) * 0x1000000 +
    (readByte(bytes, offset + 1) << 16) +
    (readByte(bytes, offset + 2) << 8) +
    readByte(bytes, offset + 3)
  );
}

function readPackObjectHeader(
  pack: Uint8Array,
  offset: number,
  packEnd: number,
): { type: number; size: number; next: number } {
  if (offset >= packEnd) fail("invalid_bundle");
  const first = readByte(pack, offset, packEnd);
  const type = (first >>> 4) & 0x07;
  let size = BigInt(first & 0x0f);
  let shift = 4n;
  let cursor = offset + 1;
  let continuation = (first & 0x80) !== 0;
  let count = 1;
  while (continuation) {
    if (cursor >= packEnd || count >= 10) fail("invalid_bundle");
    const byte = readByte(pack, cursor++, packEnd);
    size |= BigInt(byte & 0x7f) << shift;
    shift += 7n;
    continuation = (byte & 0x80) !== 0;
    count++;
  }
  if (size > BigInt(MAX_OBJECT_BYTES)) fail("resource_limit");
  return { type, size: Number(size), next: cursor };
}

function readDeltaVarint(
  delta: Uint8Array,
  offset: number,
): { value: number; next: number } {
  let value = 0n;
  let shift = 0n;
  let cursor = offset;
  for (let count = 0; count < 10; count++) {
    if (cursor >= delta.byteLength) fail("invalid_bundle");
    const byte = readByte(delta, cursor++);
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("resource_limit");
      if (count > 0 && (byte & 0x7f) === 0) fail("invalid_bundle");
      if (count >= 4) {
        if (value > BigInt(MAX_OBJECT_BYTES)) fail("resource_limit");
        fail("invalid_bundle");
      }
      return { value: Number(value), next: cursor };
    }
    shift += 7n;
  }
  fail("invalid_bundle");
}

function verifyDeltaInstructions(
  delta: Uint8Array,
  cursor: number,
  sourceSize: number,
  targetSize: number,
  remainingOperationCount: number,
): number {
  let outputSize = 0;
  let operationCount = 0;

  while (cursor < delta.byteLength) {
    operationCount++;
    if (operationCount > remainingOperationCount) fail("resource_limit");

    const opcode = readByte(delta, cursor++);
    if (opcode === 0) fail("invalid_bundle");

    let operationSize: number;
    if ((opcode & 0x80) !== 0) {
      let sourceOffset = 0;
      let copySize = 0;
      for (let byteIndex = 0; byteIndex < 4; byteIndex++) {
        if ((opcode & (1 << byteIndex)) !== 0) {
          sourceOffset += readByte(delta, cursor++) * 2 ** (byteIndex * 8);
        }
      }
      for (let byteIndex = 0; byteIndex < 3; byteIndex++) {
        if ((opcode & (1 << (byteIndex + 4))) !== 0) {
          copySize += readByte(delta, cursor++) * 2 ** (byteIndex * 8);
        }
      }
      operationSize = copySize || 0x10000;
      if (sourceOffset + operationSize > sourceSize) fail("invalid_bundle");
    } else {
      operationSize = opcode;
      if (cursor + operationSize > delta.byteLength) fail("invalid_bundle");
      cursor += operationSize;
    }

    outputSize += operationSize;
    if (outputSize > targetSize || outputSize > MAX_OBJECT_BYTES) {
      fail(outputSize > MAX_OBJECT_BYTES ? "resource_limit" : "invalid_bundle");
    }
  }

  if (!Number.isSafeInteger(outputSize) || outputSize !== targetSize) {
    fail("invalid_bundle");
  }
  return operationCount;
}

function skipOffsetDeltaBase(
  pack: Uint8Array,
  offset: number,
  packEnd: number,
  currentObjectOffset: number,
): number {
  if (offset >= packEnd) fail("invalid_bundle");
  let byte = readByte(pack, offset++, packEnd);
  let distance = BigInt(byte & 0x7f);
  let count = 1;
  while (byte & 0x80) {
    if (offset >= packEnd || count >= 10) fail("invalid_bundle");
    byte = readByte(pack, offset++, packEnd);
    distance = ((distance + 1n) << 7n) | BigInt(byte & 0x7f);
    count++;
  }
  if (
    distance === 0n ||
    distance > BigInt(Math.max(0, currentObjectOffset - 12))
  ) {
    fail("invalid_bundle");
  }
  return offset;
}

function readBundleHeader(bundle: Uint8Array): {
  packOffset: number;
  advertisedCommits: string[];
} {
  const limit = Math.min(bundle.byteLength, MAX_BUNDLE_HEADER_BYTES);
  let delimiter = -1;
  for (let i = 0; i + 1 < limit; i++) {
    if (bundle[i] === 0x0a && bundle[i + 1] === 0x0a) {
      delimiter = i;
      break;
    }
  }
  if (delimiter < 0) {
    fail(
      bundle.byteLength > MAX_BUNDLE_HEADER_BYTES
        ? "resource_limit"
        : "invalid_bundle",
    );
  }
  const header = bundle.subarray(0, delimiter);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(header);
  } catch {
    fail("invalid_bundle");
  }
  const [firstLine, ...lines] = text.split("\n");
  if (firstLine !== "# v2 git bundle" && firstLine !== "# v3 git bundle") {
    fail("invalid_bundle");
  }
  if (text.includes("\r") || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)) {
    fail("invalid_bundle");
  }
  const advertisedCommits: string[] = [];
  let objectFormat = false;
  for (const line of lines) {
    if (line === "@object-format=sha1" && firstLine === "# v3 git bundle") {
      if (objectFormat) fail("invalid_bundle");
      objectFormat = true;
    } else if (/^[a-f0-9]{40} [^\s]+$/.test(line)) {
      advertisedCommits.push(line.slice(0, 40));
    } else {
      fail("invalid_bundle");
    }
  }
  if (advertisedCommits.length === 0) fail("invalid_bundle");
  return { packOffset: delimiter + 2, advertisedCommits };
}

function verifyPack(bundle: Uint8Array, packOffset: number): void {
  if (packOffset + 12 + PACK_TRAILER_BYTES > bundle.byteLength) {
    fail("invalid_bundle");
  }
  if (
    bundle[packOffset] !== 0x50 ||
    bundle[packOffset + 1] !== 0x41 ||
    bundle[packOffset + 2] !== 0x43 ||
    bundle[packOffset + 3] !== 0x4b
  ) {
    fail("invalid_bundle");
  }
  const version = readUInt32(bundle, packOffset + 4);
  if (version !== 2 && version !== 3) fail("invalid_bundle");
  const objectCount = readUInt32(bundle, packOffset + 8);
  if (objectCount > MAX_OBJECT_COUNT) fail("resource_limit");

  const packEnd = bundle.byteLength - PACK_TRAILER_BYTES;
  let cursor = packOffset + 12;
  let aggregateObjectBytes = 0;
  let aggregateInflatedBytes = 0;
  let aggregateDeltaOperationCount = 0;
  for (let index = 0; index < objectCount; index++) {
    const objectOffset = cursor - packOffset;
    const header = readPackObjectHeader(bundle, cursor, packEnd);
    cursor = header.next;
    if (![1, 2, 3, 4, 6, 7].includes(header.type)) fail("invalid_bundle");
    if (header.type === 6) {
      cursor = skipOffsetDeltaBase(bundle, cursor, packEnd, objectOffset);
    } else if (header.type === 7) {
      if (cursor + 20 > packEnd) fail("invalid_bundle");
      cursor += 20;
    }
    if (cursor >= packEnd) fail("invalid_bundle");

    let inflated: Buffer;
    let compressedBytes: number;
    try {
      const result = inflateSync(bundle.subarray(cursor, packEnd), {
        info: true,
        maxOutputLength: MAX_OBJECT_BYTES,
      }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
      inflated = result.buffer;
      compressedBytes = result.engine.bytesWritten;
    } catch {
      fail("invalid_bundle");
    }
    if (
      compressedBytes <= 0 ||
      cursor + compressedBytes > packEnd ||
      inflated.byteLength !== header.size
    ) {
      fail("invalid_bundle");
    }
    cursor += compressedBytes;
    aggregateInflatedBytes += inflated.byteLength;
    if (aggregateInflatedBytes > MAX_AGGREGATE_OBJECT_BYTES) {
      fail("resource_limit");
    }

    let outputSize = header.size;
    if (header.type === 6 || header.type === 7) {
      const sourceSize = readDeltaVarint(inflated, 0);
      const targetSize = readDeltaVarint(inflated, sourceSize.next);
      if (
        sourceSize.value > MAX_OBJECT_BYTES ||
        targetSize.value > MAX_OBJECT_BYTES
      ) {
        fail("resource_limit");
      }
      aggregateDeltaOperationCount += verifyDeltaInstructions(
        inflated,
        targetSize.next,
        sourceSize.value,
        targetSize.value,
        MAX_DELTA_OPERATION_COUNT - aggregateDeltaOperationCount,
      );
      outputSize = targetSize.value;
    }
    aggregateObjectBytes += outputSize;
    if (aggregateObjectBytes > MAX_AGGREGATE_OBJECT_BYTES) {
      fail("resource_limit");
    }
  }

  if (cursor !== packEnd) fail("invalid_bundle");
  const expectedDigest = bundle.subarray(packEnd);
  const actualDigest = createHash("sha1")
    .update(bundle.subarray(packOffset, packEnd))
    .digest();
  if (!actualDigest.equals(Buffer.from(expectedDigest))) fail("invalid_bundle");
}

export function assertBoundedBuilderGitBundle(bundle: Uint8Array): {
  packOffset: number;
  advertisedCommits: string[];
} {
  if (!(bundle instanceof Uint8Array) || bundle.byteLength === 0) {
    fail("invalid_bundle");
  }
  if (bundle.byteLength > MAX_BUNDLE_BYTES) fail("resource_limit");
  const header = readBundleHeader(bundle);
  verifyPack(bundle, header.packOffset);
  return header;
}
