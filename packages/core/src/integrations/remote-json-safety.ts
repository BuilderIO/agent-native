const DATA_URL_PATTERN = /data:[a-z][^;,]{0,100}[;,]/i;
const BASE64_PREFIX_PATTERN = /(?:^|[,;])base64,/i;
const MAX_TRAVERSAL_DEPTH = 20;
const MAX_TRAVERSAL_NODES = 25_000;
const BINARY_FIELD_NAMES = new Set([
  "base64",
  "dataurl",
  "image",
  "imagebase64",
  "imagedata",
  "imagebytes",
  "screenshot",
  "screenshotbase64",
  "screenshotdata",
  "bytes",
  "buffer",
]);

export function serializeBoundedRemoteJson(
  value: unknown,
  options: { label: string; maxBytes: number },
): string {
  assertNoBinaryPayload(value, options.label);
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new Error(`${options.label} must contain only serializable JSON`);
  }
  if (json === undefined) {
    throw new Error(`${options.label} must contain a JSON value`);
  }
  const bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > options.maxBytes) {
    throw new Error(`${options.label} exceeds ${options.maxBytes} JSON bytes`);
  }
  return json;
}

export function assertNoBinaryPayload(value: unknown, label: string): void {
  let visited = 0;
  const seen = new Set<object>();
  const visit = (entry: unknown, depth: number, key?: string): void => {
    visited++;
    if (visited > MAX_TRAVERSAL_NODES || depth > MAX_TRAVERSAL_DEPTH) {
      throw new Error(`${label} is too deeply nested or complex`);
    }
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (
        DATA_URL_PATTERN.test(trimmed) ||
        BASE64_PREFIX_PATTERN.test(trimmed) ||
        looksLikeBase64(trimmed) ||
        (isBinaryFieldName(key) && trimmed.length > 0)
      ) {
        throw new Error(
          `${label} cannot contain screenshots, images, base64, or data URLs`,
        );
      }
      return;
    }
    if (
      entry == null ||
      typeof entry === "number" ||
      typeof entry === "boolean"
    ) {
      return;
    }
    if (
      typeof entry === "bigint" ||
      typeof entry === "function" ||
      typeof entry === "symbol" ||
      typeof entry === "undefined"
    ) {
      throw new Error(`${label} must contain only serializable JSON`);
    }
    if (ArrayBuffer.isView(entry) || entry instanceof ArrayBuffer) {
      throw new Error(`${label} cannot contain binary buffers`);
    }
    if (typeof Blob !== "undefined" && entry instanceof Blob) {
      throw new Error(`${label} cannot contain binary blobs`);
    }
    if (typeof entry !== "object") return;
    if (seen.has(entry)) {
      throw new Error(`${label} must not contain circular values`);
    }
    seen.add(entry);
    if (Array.isArray(entry)) {
      if (isBinaryFieldName(key) && entry.length > 0) {
        throw new Error(`${label} cannot contain binary arrays`);
      }
      for (const item of entry) visit(item, depth + 1, key);
      seen.delete(entry);
      return;
    }
    const record = entry as Record<string, unknown>;
    if (record.type === "Buffer" && Array.isArray(record.data)) {
      throw new Error(`${label} cannot contain serialized buffers`);
    }
    for (const [childKey, child] of Object.entries(record)) {
      if (isBinaryFieldName(childKey) && child != null) {
        throw new Error(
          `${label} cannot contain screenshots, images, base64, or data URLs`,
        );
      }
      visit(child, depth + 1, childKey);
    }
    seen.delete(entry);
  };
  visit(value, 0);
}

function isBinaryFieldName(key: string | undefined): boolean {
  if (!key) return false;
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return BINARY_FIELD_NAMES.has(normalized);
}

function looksLikeBase64(value: string): boolean {
  if (value.length < 512) return false;
  const compact = value.replace(/[\r\n]/g, "");
  return (
    compact.length >= 512 &&
    compact.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  );
}
