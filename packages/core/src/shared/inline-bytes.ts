import { parseDataUrl } from "./data-url.js";

/**
 * Inline file bytes reached a SQL write with no durable URL to stand in for
 * them. Raised only by the `reject` policy; a durable dispatch payload must
 * carry a reference the worker can re-read, never a placeholder.
 */
export class DurableAttachmentReferenceRequiredError extends Error {
  readonly code = "attachment_storage_required";

  constructor() {
    super(
      "An attachment has inline bytes but no durable file URL. Configure file storage and retry this background run.",
    );
    this.name = "DurableAttachmentReferenceRequiredError";
  }
}

/**
 * `reject` throws when an attachment has bytes but no durable URL;
 * `placeholder` keeps a visible `{ type: "file", name, mediaType, omitted:
 * "inline-bytes" }` stub, for snapshots saved before the upload returned a URL.
 */
export type InlineBytesPolicy = "reject" | "placeholder";

const ATTACHMENT_TYPES = new Set(["image", "file", "document"]);
const ATTACHMENT_LIST_KEYS = new Set([
  "attachments",
  "requestAttachments",
  "images",
  "_agentImages",
]);
const INLINE_URL_KEYS = ["image", "url", "referenceUrl", "dataUrl"] as const;
const DATA_URL_PREFIX = /^\s*data:/i;
// URL schemes are case-insensitive: `DATA:image/png;base64,...` is still bytes.
const DATA_SCHEME = /data:/i;
const HTTP_URL = /^https?:\/\//i;
const EMBEDDED_DATA_URL =
  /\bdata:[\w.+-]+\/[\w.+-]+(?:;[^,;\s"'<>]*)*,[^\s"'<>)\]]*/gi;

function isDataUrl(value: unknown): value is string {
  return typeof value === "string" && DATA_URL_PREFIX.test(value);
}

function durableUrl(item: Record<string, unknown>): string | undefined {
  const metadata = item.metadata as Record<string, unknown> | undefined;
  for (const candidate of [
    item.url,
    item.referenceUrl,
    item.uploadUrl,
    item.image,
    metadata?.uploadUrl,
  ]) {
    if (
      typeof candidate === "string" &&
      candidate.trim() &&
      !isDataUrl(candidate)
    ) {
      return candidate;
    }
  }
  return undefined;
}

function inlineKeys(item: Record<string, unknown>): string[] {
  const keys: string[] = INLINE_URL_KEYS.filter((key) => isDataUrl(item[key]));
  if (
    typeof item.data === "string" &&
    item.data.length > 0 &&
    !HTTP_URL.test(item.data)
  ) {
    keys.push("data");
  }
  return keys;
}

function inlineMediaType(
  item: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of ["mediaType", "mimeType", "contentType"]) {
    if (typeof item[key] === "string") return item[key] as string;
  }
  for (const key of keys) {
    const parsed =
      typeof item[key] === "string" ? parseDataUrl(item[key].trim()) : null;
    if (parsed) return parsed.mediaType;
  }
  return undefined;
}

function scrubString(value: string): string {
  return DATA_SCHEME.test(value)
    ? value.replace(EMBEDDED_DATA_URL, (match) => {
        const mediaType = /^data:([^;,]+)/i.exec(match)?.[1] ?? "unknown";
        return `[inline ${mediaType.toLowerCase()} data omitted]`;
      })
    : value;
}

function sanitize(
  value: unknown,
  policy: InlineBytesPolicy,
  inAttachmentList: boolean,
  inheritedUrl: string | undefined,
): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitize(item, policy, inAttachmentList, inheritedUrl),
    );
  }
  if (!value || typeof value !== "object") return value;

  const item = value as Record<string, unknown>;
  const isAttachment =
    inAttachmentList || ATTACHMENT_TYPES.has(item.type as string);
  const ownUrl = isAttachment ? durableUrl(item) : undefined;
  const fallbackUrl = ownUrl ?? (isAttachment ? inheritedUrl : undefined);
  const inline = isAttachment ? inlineKeys(item) : [];
  const unreferenced =
    inline.length > 0 &&
    !fallbackUrl &&
    !(typeof item.fileId === "string" && item.fileId);

  if (unreferenced && policy === "reject") {
    throw new DurableAttachmentReferenceRequiredError();
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(item)) {
    if (inline.includes(key)) {
      if (fallbackUrl && (key === "image" || key === "url")) {
        out[key] = fallbackUrl;
      }
      continue;
    }
    Object.defineProperty(out, key, {
      value: sanitize(
        child,
        policy,
        ATTACHMENT_LIST_KEYS.has(key),
        fallbackUrl,
      ),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  if (unreferenced) {
    const name = item.name ?? item.filename ?? item.label;
    const mediaType = inlineMediaType(item, inline);
    return {
      ...out,
      type: "file",
      ...(typeof name === "string" ? { name } : {}),
      ...(mediaType ? { mediaType } : {}),
      omitted: "inline-bytes",
    };
  }
  return out;
}

/**
 * The one boundary every chat SQL write passes through (thread snapshots, run
 * events, durable dispatch payloads): inline image/file bytes become their
 * durable URL when the part carries one, and otherwise follow `policy`. Data
 * URLs embedded in any other string become a visible `[inline … omitted]`.
 */
export function stripInlineBytes<T>(value: T, policy: InlineBytesPolicy): T {
  return sanitize(value, policy, false, undefined) as T;
}

/** `stripInlineBytes` for serialized JSON; skips the parse when no body can be present. */
export function stripInlineBytesFromJson(
  json: string,
  policy: InlineBytesPolicy,
): string {
  if (!DATA_SCHEME.test(json) && !json.includes('"data"')) return json;
  return JSON.stringify(stripInlineBytes(JSON.parse(json), policy));
}

/**
 * Throws with the JSON path of the first inline file body in `value` (an
 * object, or a JSON string as read back from a SQL column). For tests.
 */
export function assertNoInlineImageBytes(
  value: unknown,
  label = "value",
): void {
  const visit = (node: unknown, path: string, inList: boolean): void => {
    if (typeof node === "string") {
      if (/base64,|data:image/i.test(node)) {
        throw new Error(
          `${label} stores inline image bytes at ${path}: ${node.slice(0, 80)}`,
        );
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, `${path}[${index}]`, inList));
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (
      (inList || ATTACHMENT_TYPES.has(record.type as string)) &&
      inlineKeys(record).includes("data")
    ) {
      throw new Error(`${label} stores inline bytes at ${path}.data`);
    }
    for (const [key, child] of Object.entries(record)) {
      visit(child, `${path}.${key}`, ATTACHMENT_LIST_KEYS.has(key));
    }
  };
  visit(typeof value === "string" ? safeJson(value) : value, label, false);
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    // coercion-ok: a non-JSON string is checked as the text it is.
    return value;
  }
}
