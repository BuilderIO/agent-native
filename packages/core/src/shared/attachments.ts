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

function isBase64Payload(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= 64 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value.trim())
  );
}

function hasInlineDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trimStart().toLowerCase().startsWith("data:")
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
    if (isAttachmentRecord && ATTACHMENT_BODY_FIELDS.has(normalizedKey)) {
      continue;
    }
    if (
      isAttachmentRecord &&
      INLINE_REFERENCE_FIELDS.has(normalizedKey) &&
      hasInlineDataUrl(entry)
    ) {
      continue;
    }
    if (
      isAttachmentRecord &&
      normalizedKey === "image" &&
      (hasInlineDataUrl(entry) ||
        ArrayBuffer.isView(entry) ||
        (Array.isArray(entry) && entry.every(Number.isInteger)))
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
