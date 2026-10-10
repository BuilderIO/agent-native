const ATTACHMENT_BODY_FIELDS = new Set([
  "base64",
  "bytes",
  "body",
  "data",
  "dataurl",
  "payload",
]);

const INLINE_REFERENCE_FIELDS = new Set([
  "preview",
  "referenceurl",
  "src",
  "thumbnail",
  "url",
  "uploadurl",
  "dataurl",
]);

const ATTACHMENT_TYPES = new Set(["document", "file", "image"]);
const ATTACHMENT_CONTEXT_FIELDS = new Set([
  "attachment",
  "attachments",
  "file",
  "files",
  "image",
  "images",
  "reference",
  "references",
  "requestattachments",
]);

export function isInlineDataUrl(value: unknown): value is string {
  return typeof value === "string" && /^\s*data:/i.test(value);
}

export function isPersistableAttachmentUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    Boolean(url.hostname) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  );
}

function isBase64Payload(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= 64 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value.trim())
  );
}

function hasInlineDataUrl(value: unknown): value is string {
  return typeof value === "string" && /^data:[^\s,]+,/i.test(value.trimStart());
}

function isInlineReferencePayload(value: unknown): boolean {
  return hasInlineDataUrl(value) || isBase64Payload(value);
}

function isByteArray(value: unknown): boolean {
  return (
    (Array.isArray(value) &&
      value.length > 0 &&
      value.every(
        (entry) =>
          typeof entry === "number" &&
          Number.isInteger(entry) &&
          entry >= 0 &&
          entry <= 255,
      )) ||
    ArrayBuffer.isView(value)
  );
}

function isInlineAttachmentPayload(value: unknown): boolean {
  return (
    hasInlineDataUrl(value) || isBase64Payload(value) || isByteArray(value)
  );
}

function isAttachment(record: Record<string, unknown>): boolean {
  return (
    ATTACHMENT_TYPES.has(String(record.type ?? "").toLowerCase()) ||
    [record.contentType, record.mediaType, record.mimeType].some(
      (mimeType) => typeof mimeType === "string" && /^image\//i.test(mimeType),
    )
  );
}

export function stripInlineAttachmentPayloads(
  value: unknown,
  attachmentContext = false,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      stripInlineAttachmentPayloads(entry, attachmentContext),
    );
  }
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const isAttachmentRecord = attachmentContext || isAttachment(record);
  const persisted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase();
    const childAttachmentContext =
      isAttachmentRecord || ATTACHMENT_CONTEXT_FIELDS.has(normalizedKey);
    if (
      isAttachmentRecord &&
      ATTACHMENT_BODY_FIELDS.has(normalizedKey) &&
      isInlineAttachmentPayload(entry)
    ) {
      continue;
    }
    if (
      isAttachmentRecord &&
      INLINE_REFERENCE_FIELDS.has(normalizedKey) &&
      (isInlineReferencePayload(entry) ||
        (typeof entry === "string" &&
          entry.trim().length > 0 &&
          !isPersistableAttachmentUrl(entry)))
    ) {
      continue;
    }
    if (
      isAttachmentRecord &&
      normalizedKey === "image" &&
      (isInlineAttachmentPayload(entry) ||
        (typeof entry === "string" &&
          entry.trim().length > 0 &&
          !isPersistableAttachmentUrl(entry)))
    ) {
      continue;
    }
    if (
      (normalizedKey === "preview" || normalizedKey === "thumbnail") &&
      (hasInlineDataUrl(entry) || isBase64Payload(entry))
    ) {
      continue;
    }
    persisted[key] = stripInlineAttachmentPayloads(
      entry,
      childAttachmentContext,
    );
  }
  return persisted;
}
