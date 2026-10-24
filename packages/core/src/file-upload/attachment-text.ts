import { parseBase64DataUrl } from "../shared/data-url.js";

/**
 * Largest attachment body copied into SQL `resources` for `read-attachment`.
 * Only text with no storage URL is copied; an upload keeps a reference and is
 * re-read from storage, so large file bodies stay out of SQL.
 */
export const MAX_ATTACHMENT_RESOURCE_BODY_CHARS = 1_000_000;
/** Total body copies one request may write into SQL. */
export const MAX_ATTACHMENT_RESOURCE_BODY_TOTAL_CHARS = 2_000_000;
export const ATTACHMENT_REFERENCE_MIME_TYPE =
  "application/vnd.agent-native.attachment-reference+json";
/** Most characters of one text attachment the prompt shows inline. */
export const MAX_INLINE_TEXT_ATTACHMENT_CHARS = 60_000;
/** Most characters of all text attachments in one prompt. */
export const MAX_INLINE_TEXT_ATTACHMENTS_TOTAL_CHARS = 80_000;
/**
 * Largest text or SVG file read on any path: browser reads, owned-URL
 * hydration and data URLs a caller sends directly all stop here.
 */
export const MAX_TEXT_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const TEXT_LIKE_APPLICATION_TYPES = new Set([
  "application/javascript",
  "application/json",
  "application/typescript",
  "application/x-yaml",
  "application/xml",
  "application/yaml",
  "image/svg+xml",
  "message/rfc822",
]);

export function isTextLikeMimeType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase().split(";")[0].trim();
  if (ct.startsWith("text/")) return true;
  if (ct.endsWith("+json") || ct.endsWith("+xml")) return true;
  return TEXT_LIKE_APPLICATION_TYPES.has(ct);
}

export function isTextLikeFilename(name: string | undefined): boolean {
  if (!name) return false;
  return /\.(txt|md|markdown|mdx|csv|tsv|json|jsonl|yaml|yml|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|c|cpp|h|cs|swift|kt|sh|bash|zsh|fish|toml|ini|cfg|conf|xml|svg|html|htm|css|scss|sass|less|sql|graphql|gql|eml)$/i.test(
    name,
  );
}

export function isSvgTextAttachment(att: {
  name?: string;
  contentType?: string;
}): boolean {
  return (
    att.contentType?.split(";")[0]?.trim().toLowerCase() === "image/svg+xml" ||
    /\.svg$/i.test(att.name ?? "")
  );
}

/**
 * Unwraps the composer's envelope only when it names this very file, so a
 * stored or legacy upload that kept its wrapper reads as its body, while a
 * real document that merely looks like one is left as written. Every path
 * that reads attachment text uses this one function, so the prompt, the
 * stored copy and read-attachment offsets agree.
 */
export function unwrapOwnAttachmentEnvelope(
  text: string,
  name: string | undefined,
): string {
  if (!name) return text;
  // assistant-ui writes `<attachment name=${name}>` with the name raw and
  // unquoted, so a name with spaces or ">" only matches as an exact prefix.
  const open = `<attachment name=${name}>\n`;
  const close = "\n</attachment>";
  if (
    text.length >= open.length + close.length &&
    text.startsWith(open) &&
    text.endsWith(close)
  ) {
    return text.slice(open.length, text.length - close.length);
  }
  const match = text.match(
    /^<attachment\b([^>]*)>\n([\s\S]*)\n<\/attachment>$/,
  );
  if (!match) return text;
  const attrName = match[1]!.match(/\bname=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/);
  const wrapped = attrName?.[1] ?? attrName?.[2] ?? attrName?.[3];
  return wrapped !== undefined && decodeXmlAttribute(wrapped) === name
    ? match[2]!
    : text;
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// A flat character class, not a repeated group: V8 recurses per group
// repetition and overflows the stack on multi-megabyte payloads.
const BASE64_CHARS = /^[A-Za-z0-9+/]*={0,2}$/;

function isBase64Payload(data: string): boolean {
  return data.length % 4 === 0 && BASE64_CHARS.test(data);
}

export type DecodedAttachmentText =
  | { kind: "text"; text: string }
  | { kind: "not-text" }
  | {
      kind: "undecodable";
      mediaType: string;
      reason: "invalid-base64" | "not-utf8" | "too-large";
    };

/**
 * Text files reach the server as base64 data URLs once storage hydrates them.
 * Engines only understand PDF file parts, so a text payload left as a file
 * part becomes a filename placeholder and the model never sees the contents.
 */
// Classification, storage notes, the prompt and persistence each ask for the
// same attachment's text; decoding once per payload keeps an 8 MB file from
// being decoded four times. The inputs are rechecked because hydration
// rewrites data and contentType in place.
const decodedAttachmentText = new WeakMap<
  object,
  {
    data: string;
    name?: string;
    contentType?: string;
    result: DecodedAttachmentText;
  }
>();

export function decodeTextAttachmentData(att: {
  name?: string;
  contentType?: string;
  data?: string;
}): DecodedAttachmentText {
  if (typeof att.data !== "string") return { kind: "not-text" };
  const cached = decodedAttachmentText.get(att);
  if (
    cached &&
    cached.data === att.data &&
    cached.name === att.name &&
    cached.contentType === att.contentType
  ) {
    return cached.result;
  }
  const result = decodeTextAttachmentDataUncached(att, att.data);
  decodedAttachmentText.set(att, {
    data: att.data,
    name: att.name,
    contentType: att.contentType,
    result,
  });
  return result;
}

/** Cuts at `end` without leaving half of a surrogate pair at the edge. */
export function sliceTextHead(text: string, end: number): string {
  if (end <= 0) return "";
  if (end >= text.length) return text;
  const last = text.charCodeAt(end - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
}

function decodeTextAttachmentDataUncached(
  att: { name?: string; contentType?: string },
  data: string,
): DecodedAttachmentText {
  // The shared parser rejects a zero-length body, but storage returns one
  // for an empty file and the model should hear that it is empty.
  const empty = data.match(/^data:([^;,]*)(?:;[^,]*)?;base64,$/i);
  const dataUrl = empty
    ? { mediaType: empty[1] ?? "", data: "" }
    : parseBase64DataUrl(data);
  if (!dataUrl) return { kind: "not-text" };
  const mediaType = dataUrl.mediaType.split(";")[0]!.trim().toLowerCase();
  const untyped = !mediaType || mediaType === "application/octet-stream";
  const textLike =
    isTextLikeMimeType(mediaType) ||
    (untyped &&
      (isTextLikeMimeType(att.contentType) || isTextLikeFilename(att.name)));
  if (!textLike) return { kind: "not-text" };
  // Buffer.from skips characters that are not base64, so a corrupt payload
  // would otherwise decode to plausible text.
  if (!isBase64Payload(dataUrl.data)) {
    return {
      kind: "undecodable",
      mediaType: mediaType || "unknown",
      reason: "invalid-base64",
    };
  }
  // Checked before decoding so a direct data URL cannot allocate past the
  // limit every other read path enforces.
  const padding = dataUrl.data.endsWith("==")
    ? 2
    : dataUrl.data.endsWith("=")
      ? 1
      : 0;
  if ((dataUrl.data.length / 4) * 3 - padding > MAX_TEXT_ATTACHMENT_BYTES) {
    return {
      kind: "undecodable",
      mediaType: mediaType || "unknown",
      reason: "too-large",
    };
  }
  try {
    return {
      kind: "text",
      text: unwrapOwnAttachmentEnvelope(
        new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.from(dataUrl.data, "base64"),
        ),
        att.name,
      ),
    };
  } catch {
    return {
      kind: "undecodable",
      mediaType: mediaType || "unknown",
      reason: "not-utf8",
    };
  }
}

/**
 * The one size check for text attachments, whether the bytes arrive as a data
 * URL or as composer text. Pre-upload runs it before encoding or uploading,
 * and the prompt and persistence run it so all three agree the file is too
 * large.
 */
export function isOverTextAttachmentLimit(att: {
  name?: string;
  contentType?: string;
  data?: string;
  text?: string;
}): boolean {
  const decoded = decodeTextAttachmentData(att);
  if (decoded.kind === "undecodable" && decoded.reason === "too-large") {
    return true;
  }
  // A binary payload (a PDF with extracted text, say) is not a text file.
  if (decoded.kind === "not-text" && typeof att.data === "string") {
    return false;
  }
  return (
    typeof att.text === "string" &&
    att.text.length > MAX_TEXT_ATTACHMENT_BYTES / 4 &&
    Buffer.byteLength(att.text, "utf8") > MAX_TEXT_ATTACHMENT_BYTES
  );
}

export type TextAttachmentStorage =
  | { kind: "stored"; resourceId: string; path: string; totalChars: number }
  | { kind: "failed"; reason: "too-large" | "write-failed"; error?: string };
