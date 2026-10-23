import { parseBase64DataUrl } from "../shared/data-url.js";

export const MAX_ATTACHMENT_RESOURCE_CHARS = 20 * 1024 * 1024;

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

/** Pasted text arrives wrapped; the model and read-attachment offsets see the body. */
export function unwrapTextAttachmentEnvelope(text: string): string {
  const match = text.match(/^<attachment\b[^>]*>\n([\s\S]*)\n<\/attachment>$/);
  return match ? match[1] : text;
}

export type DecodedAttachmentText =
  | { kind: "text"; text: string }
  | { kind: "not-text" }
  | { kind: "undecodable"; mediaType: string };

/**
 * Text files reach the server as base64 data URLs once storage hydrates them.
 * Engines only understand PDF file parts, so a text payload left as a file
 * part becomes a filename placeholder and the model never sees the contents.
 */
export function decodeTextAttachmentData(att: {
  name?: string;
  contentType?: string;
  data?: string;
}): DecodedAttachmentText {
  if (typeof att.data !== "string") return { kind: "not-text" };
  const dataUrl = parseBase64DataUrl(att.data);
  if (!dataUrl) return { kind: "not-text" };
  const mediaType = dataUrl.mediaType.split(";")[0]!.trim().toLowerCase();
  const untyped = !mediaType || mediaType === "application/octet-stream";
  const textLike =
    isTextLikeMimeType(mediaType) ||
    (untyped &&
      (isTextLikeMimeType(att.contentType) || isTextLikeFilename(att.name)));
  if (!textLike) return { kind: "not-text" };
  try {
    return {
      kind: "text",
      text: new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.from(dataUrl.data, "base64"),
      ),
    };
  } catch {
    return { kind: "undecodable", mediaType: mediaType || "unknown" };
  }
}

export type TextAttachmentStorage =
  | { kind: "stored"; resourceId: string; path: string; totalChars: number }
  | { kind: "failed"; reason: "too-large" | "write-failed"; error?: string };
