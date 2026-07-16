import { decode, encode, rfc8949EncodeOptions } from "cborg";

export type AncV1CanonicalValue =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | readonly AncV1CanonicalValue[]
  | ReadonlyMap<number, AncV1CanonicalValue>;

export class AncV1CanonicalEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AncV1CanonicalEncodingError";
  }
}

function isByteArray(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

function assertCanonicalValue(
  value: unknown,
  path = "$",
  depth = 0,
): asserts value is AncV1CanonicalValue {
  if (depth > 32) {
    throw new AncV1CanonicalEncodingError(`${path} exceeds maximum depth`);
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    isByteArray(value)
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new AncV1CanonicalEncodingError(
        `${path} must be a safe integer; floats and non-finite numbers are forbidden`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertCanonicalValue(item, `${path}[${index}]`, depth + 1),
    );
    return;
  }
  if (value instanceof Map) {
    for (const [key, item] of value) {
      if (!Number.isSafeInteger(key) || key < 0) {
        throw new AncV1CanonicalEncodingError(
          `${path} map keys must be non-negative safe integers`,
        );
      }
      assertCanonicalValue(item, `${path}.${key}`, depth + 1);
    }
    return;
  }
  throw new AncV1CanonicalEncodingError(
    `${path} contains a forbidden canonical value type`,
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** RFC 8949 deterministic base-mode encoding with integer envelope keys. */
export function encodeAncV1Canonical(value: AncV1CanonicalValue): Uint8Array {
  assertCanonicalValue(value);
  return encode(value, rfc8949EncodeOptions);
}

/**
 * Strictly decode canonical bytes, then re-encode and compare byte-for-byte.
 * This rejects duplicate keys, indefinite forms, non-shortest encodings, and
 * alternate map ordering even when a permissive decoder could understand them.
 */
export function decodeAncV1Canonical(
  bytes: Uint8Array,
  options: { maxBytes?: number } = {},
): AncV1CanonicalValue {
  const maxBytes = options.maxBytes ?? 64 * 1024;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new AncV1CanonicalEncodingError(
      "Canonical input must be non-empty bytes",
    );
  }
  if (bytes.byteLength > maxBytes) {
    throw new AncV1CanonicalEncodingError(
      `Canonical input exceeds ${maxBytes} bytes`,
    );
  }

  let value: unknown;
  try {
    value = decode(bytes, {
      strict: true,
      useMaps: true,
      rejectDuplicateMapKeys: true,
      allowIndefinite: false,
      allowUndefined: false,
      allowInfinity: false,
      allowNaN: false,
      allowBigInt: false,
    });
    assertCanonicalValue(value);
  } catch (error) {
    if (error instanceof AncV1CanonicalEncodingError) throw error;
    throw new AncV1CanonicalEncodingError(
      `Invalid canonical CBOR: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const canonical = encodeAncV1Canonical(value);
  if (!bytesEqual(bytes, canonical)) {
    throw new AncV1CanonicalEncodingError(
      "CBOR input is valid but not the unique RFC 8949 deterministic encoding",
    );
  }
  return value;
}

export function decodeAncV1Envelope(
  bytes: Uint8Array,
  allowedKeys: readonly number[],
  options: { maxBytes?: number } = {},
): ReadonlyMap<number, AncV1CanonicalValue> {
  const value = decodeAncV1Canonical(bytes, options);
  if (!(value instanceof Map)) {
    throw new AncV1CanonicalEncodingError("Envelope root must be a CBOR map");
  }
  const allowed = new Set(allowedKeys);
  for (const key of value.keys()) {
    if (!allowed.has(key)) {
      throw new AncV1CanonicalEncodingError(
        `Envelope contains unknown key ${key}`,
      );
    }
  }
  return value;
}

export function ancV1BytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function ancV1HexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) {
    throw new AncV1CanonicalEncodingError(
      "Hex input must contain complete bytes",
    );
  }
  return Uint8Array.from(
    hex.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)),
  );
}
