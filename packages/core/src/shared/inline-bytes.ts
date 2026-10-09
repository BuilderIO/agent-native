import {
  isInlineDataUrl,
  isPersistableAttachmentUrl,
} from "@agent-native/agentkit/protocol";

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
const INLINE_URL_KEYS = [
  "image",
  "url",
  "referenceUrl",
  "uploadUrl",
  "dataUrl",
  "dataURL",
] as const;
const INLINE_BYTE_FIELD_KEYS = new Set([
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
// URL schemes are case-insensitive: `DATA:image/png;base64,...` is still bytes.
const DATA_SCHEME = /data:/i;
const EMBEDDED_DATA_URL =
  /\bdata:[\w.+-]+\/[\w.+-]+(?:;[^,;\s"'<>]*)*,[^\s"'<>)\]]*/gi;

function durableUrl(item: Record<string, unknown>): string | undefined {
  const metadata = item.metadata as Record<string, unknown> | undefined;
  for (const candidate of [
    item.url,
    item.referenceUrl,
    item.uploadUrl,
    item.image,
    metadata?.uploadUrl,
  ]) {
    if (isPersistableAttachmentUrl(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function inlineKeys(item: Record<string, unknown>): string[] {
  const keys: string[] = INLINE_URL_KEYS.filter((key) => {
    const value = item[key];
    return (
      typeof value === "string" &&
      value.length > 0 &&
      !isPersistableAttachmentUrl(value)
    );
  });
  if (
    typeof item.data === "string" &&
    item.data.length > 0 &&
    !isPersistableAttachmentUrl(item.data)
  ) {
    keys.push("data");
  }
  if (typeof item.base64 === "string" && item.base64.length > 0) {
    keys.push("base64");
  }
  for (const [key, value] of Object.entries(item)) {
    if (
      INLINE_BYTE_FIELD_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")) &&
      value != null &&
      ((typeof value === "string" && value.length > 0) ||
        (Array.isArray(value) && value.length > 0) ||
        (value instanceof Uint8Array && value.byteLength > 0) ||
        value instanceof ArrayBuffer ||
        (typeof Blob !== "undefined" && value instanceof Blob)) &&
      !keys.includes(key)
    ) {
      keys.push(key);
    }
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
  inAttachmentMetadata = false,
): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitize(
        item,
        policy,
        inAttachmentList,
        inheritedUrl,
        inAttachmentMetadata,
      ),
    );
  }
  if (!value || typeof value !== "object") return value;

  const item = value as Record<string, unknown>;
  const source = item.source as Record<string, unknown> | undefined;
  if (
    item.type === "image" &&
    source?.type === "base64" &&
    typeof source.data === "string" &&
    source.data.length > 0
  ) {
    const url = durableUrl(item) ?? inheritedUrl;
    if (!url && policy === "reject") {
      throw new DurableAttachmentReferenceRequiredError();
    }
    const name = item.name ?? item.filename ?? item.label;
    const mediaType =
      typeof source.media_type === "string"
        ? source.media_type
        : inlineMediaType(item, ["data"]);
    return {
      type: "file",
      ...(typeof name === "string" ? { name } : {}),
      ...(mediaType ? { mediaType } : {}),
      ...(url ? { url } : { omitted: "inline-bytes" }),
    };
  }
  const isAttachment =
    inAttachmentList || ATTACHMENT_TYPES.has(item.type as string);
  const hasAttachmentContext = isAttachment || inAttachmentMetadata;
  const ownUrl = hasAttachmentContext ? durableUrl(item) : undefined;
  const fallbackUrl =
    ownUrl ?? (hasAttachmentContext ? inheritedUrl : undefined);
  const inline = hasAttachmentContext ? inlineKeys(item) : [];
  const unreferenced =
    isAttachment &&
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
    out[key] = sanitize(
      child,
      policy,
      ATTACHMENT_LIST_KEYS.has(key),
      fallbackUrl,
      inAttachmentMetadata || (isAttachment && key === "metadata"),
    );
  }
  if (unreferenced) {
    const name = item.name ?? item.filename ?? item.label;
    const mediaType = inlineMediaType(item, inline);
    return {
      ...out,
      type: "file",
      ...(typeof name === "string" ? { name } : {}),
      ...(mediaType ? { mediaType } : {}),
      omitted: inline.some(
        (key) =>
          key === "data" ||
          key === "base64" ||
          key === "dataUrl" ||
          isInlineDataUrl(item[key]),
      )
        ? "inline-bytes"
        : "unsafe-url",
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
  if (
    !DATA_SCHEME.test(json) &&
    ![
      "data",
      "url",
      "referenceUrl",
      "uploadUrl",
      "image",
      "dataUrl",
      "dataURL",
    ].some((key) => json.includes(`"${key}"`))
  ) {
    return json;
  }
  return JSON.stringify(stripInlineBytes(JSON.parse(json), policy));
}

/**
 * Throws with the JSON path of the first inline file body in `value` (an
 * object, or a JSON string as read back from a SQL column).
 */
export function assertNoInlineImageBytes(
  value: unknown,
  label = "value",
): void {
  const hasBytes = (candidate: unknown): boolean =>
    (typeof candidate === "string" && candidate.length > 0) ||
    (Array.isArray(candidate) && candidate.length > 0) ||
    (candidate instanceof Uint8Array && candidate.byteLength > 0);
  const visit = (
    node: unknown,
    path: string,
    inList: boolean,
    inAttachmentMetadata = false,
  ): void => {
    if (typeof node === "string") {
      if (/base64,|data:image/i.test(node)) {
        throw new Error(`${label} stores inline image bytes at ${path}`);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) =>
        visit(child, `${path}[${index}]`, inList, inAttachmentMetadata),
      );
      return;
    }
    if (
      node instanceof ArrayBuffer ||
      ArrayBuffer.isView(node) ||
      (typeof Blob !== "undefined" && node instanceof Blob)
    ) {
      throw new Error(`${label} stores inline image or file bytes at ${path}`);
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const isAttachment = inList || ATTACHMENT_TYPES.has(record.type as string);
    const hasAttachmentContext = isAttachment || inAttachmentMetadata;
    const source = record.source as Record<string, unknown> | undefined;
    const file = record.file as Record<string, unknown> | undefined;
    const mediaType = record.mediaType ?? record.mimeType ?? record.contentType;
    const bytePath =
      hasAttachmentContext && hasBytes(record.bytes)
        ? `${path}.bytes`
        : record.type === "image" &&
            source?.type === "base64" &&
            hasBytes(source.data)
          ? `${path}.source.data`
          : record.type === "file" && hasBytes(file?.bytes)
            ? `${path}.file.bytes`
            : typeof mediaType === "string" &&
                /^image\//i.test(mediaType) &&
                hasBytes(record.data)
              ? `${path}.data`
              : undefined;
    if (bytePath) {
      throw new Error(
        `${label} stores inline image or file bytes at ${bytePath}`,
      );
    }
    for (const [key, child] of Object.entries(record)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (INLINE_BYTE_FIELD_KEYS.has(normalizedKey) && hasBytes(child)) {
        throw new Error(
          `${label} stores inline image or file bytes at ${path}.${key}`,
        );
      }
    }
    const attachmentKeys = hasAttachmentContext ? inlineKeys(record) : [];
    if (attachmentKeys.length > 0) {
      const key = attachmentKeys[0]!;
      throw new Error(
        `${label} stores inline or unsafe attachment reference at ${path}.${key}`,
      );
    }
    for (const [key, child] of Object.entries(record)) {
      visit(
        child,
        `${path}.${key}`,
        ATTACHMENT_LIST_KEYS.has(key),
        inAttachmentMetadata || (isAttachment && key === "metadata"),
      );
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
