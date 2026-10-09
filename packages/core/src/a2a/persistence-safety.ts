const INLINE_FILE_FIELD_NAMES = new Set([
  "base64",
  "buffer",
  "bytes",
  "dataurl",
  "imagebase64",
  "imagedata",
  "imagebytes",
  "screenshotbase64",
  "screenshotdata",
]);

const DATA_URL_PATTERN = /^data:[^,]+,/i;
const BASE64_MARKER_PATTERN = /(?:^|[,;])base64,/i;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_VISITED_NODES = 25_000;
const MAX_DEPTH = 20;

export class A2APersistencePayloadError extends Error {
  readonly code = "A2A_INLINE_FILE_BYTES_NOT_PERSISTABLE";

  constructor(label: string) {
    super(
      `${label} cannot include inline file bytes or data URLs. Upload the file to durable storage and send its URI instead.`,
    );
    this.name = "A2APersistencePayloadError";
  }
}

/** Reject payloads that cannot safely be retained in an A2A task row. */
export function assertA2APersistablePayload(
  value: unknown,
  label: string,
): void {
  let visited = 0;
  const ancestors = new Set<object>();

  const visit = (entry: unknown, depth: number, key?: string): void => {
    visited += 1;
    if (visited > MAX_VISITED_NODES || depth > MAX_DEPTH) {
      throw new Error(`${label} is too deeply nested or complex`);
    }

    if (typeof entry === "string") {
      if (isInlineFileString(entry, key)) {
        throw new A2APersistencePayloadError(label);
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
      ArrayBuffer.isView(entry) ||
      entry instanceof ArrayBuffer ||
      (typeof Blob !== "undefined" && entry instanceof Blob)
    ) {
      throw new A2APersistencePayloadError(label);
    }

    if (typeof entry !== "object") return;
    if (ancestors.has(entry)) {
      throw new Error(`${label} must not contain circular values`);
    }
    ancestors.add(entry);

    if (Array.isArray(entry)) {
      if (isInlineFileField(key) && entry.length > 0) {
        throw new A2APersistencePayloadError(label);
      }
      for (const item of entry) visit(item, depth + 1, key);
      ancestors.delete(entry);
      return;
    }

    const record = entry as Record<string, unknown>;
    if (record.type === "Buffer" && Array.isArray(record.data)) {
      throw new A2APersistencePayloadError(label);
    }
    for (const [childKey, child] of Object.entries(record)) {
      if (isInlineFileField(childKey) && isSupplied(child)) {
        throw new A2APersistencePayloadError(label);
      }
      visit(child, depth + 1, childKey);
    }
    ancestors.delete(entry);
  };

  visit(value, 0);
}

function isInlineFileString(value: string, key?: string): boolean {
  const trimmed = value.trim();
  if (
    DATA_URL_PATTERN.test(trimmed) ||
    BASE64_MARKER_PATTERN.test(trimmed) ||
    looksLikeBase64Payload(trimmed)
  ) {
    return true;
  }

  const normalizedKey = key?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (
    normalizedKey === "fileid" ||
    normalizedKey === "uri" ||
    normalizedKey === "image" ||
    normalizedKey === "imagebase64" ||
    normalizedKey === "imagedata" ||
    normalizedKey === "imagebytes" ||
    normalizedKey === "screenshotbase64" ||
    normalizedKey === "screenshotdata"
  ) {
    return looksLikeEncodedFileBytes(trimmed);
  }
  return false;
}

function looksLikeBase64Payload(value: string): boolean {
  const compact = value.replace(/[\r\n]/g, "");
  return (
    compact.length >= 512 &&
    compact.length % 4 === 0 &&
    BASE64_PATTERN.test(compact)
  );
}

function looksLikeEncodedFileBytes(value: string): boolean {
  if (value.length >= 512 && value.length % 4 === 0) {
    return BASE64_PATTERN.test(value);
  }

  return (
    value.startsWith("iVBORw0KGgo") ||
    value.startsWith("/9j/") ||
    value.startsWith("R0lGOD") ||
    value.startsWith("UklGR") ||
    value.startsWith("JVBERi0") ||
    value.startsWith("UEsDB") ||
    value.startsWith("PHN2Zy") ||
    value.startsWith("SUkqA") ||
    value.startsWith("TU0AK") ||
    value.startsWith("Qk1")
  );
}

function isInlineFileField(key: string | undefined): boolean {
  if (!key) return false;
  return INLINE_FILE_FIELD_NAMES.has(
    key.toLowerCase().replace(/[^a-z0-9]/g, ""),
  );
}

function isSupplied(value: unknown): boolean {
  return value !== undefined && value !== null;
}
