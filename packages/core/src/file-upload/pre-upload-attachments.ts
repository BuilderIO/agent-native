import type { AgentChatAttachment } from "../agent/types.js";
import { getActiveFileUploadProvider, uploadFile } from "./registry.js";

export interface PreUploadedImageAttachment {
  name?: string;
  url: string;
  provider: string;
  contentType?: string;
}

/**
 * A file/non-image attachment that was successfully uploaded to a hosted URL.
 * Consumers can use the URL in place of the base64 data to avoid persisting
 * large blobs in the thread repo and SQL.
 */
export interface PreUploadedFileAttachment {
  name?: string;
  url: string;
  provider: string;
  contentType?: string;
  sizeBytes?: number;
  referenceOnly?: boolean;
  securityNote?: string;
}

export interface PreUploadAttachmentsResult {
  /** Same array reference. Each image attachment that was uploaded also gets a
   *  `url` property attached (non-breaking; consumers that don't read it are
   *  unaffected). */
  attachments: AgentChatAttachment[];
  /** Set when at least one image was uploaded. List of hosted URLs the agent
   *  can embed in HTML, slide content, documents, etc. */
  uploaded: PreUploadedImageAttachment[];
  /** Uploaded non-image files (PDF, generic binary). Parallel to `uploaded`
   *  but for the file/document attachment type. */
  uploadedFiles: PreUploadedFileAttachment[];
  /** True if at least one image or file could not be uploaded because no
   *  file-upload provider is configured. The agent uses this to render the
   *  storage setup card. */
  providerMissing: boolean;
  /** A pre-formatted block to inject into the user message text so the agent
   *  has each hosted URL inline. Null when nothing was uploaded or no provider
   *  is configured. */
  injectedText: string | null;
}

const FILE_DATA_URL_RE = /^data:([^;]+);base64,(.+)$/;
const SVG_REFERENCE_SECURITY_NOTE =
  "SVG content may contain active markup; use this URL as a file reference unless the target app sanitizes it.";

function normalizeContentType(value: string | undefined): string | undefined {
  return value?.split(";")[0]?.trim().toLowerCase() || undefined;
}

function hasSvgFilename(name: string | undefined): boolean {
  return /\.svg$/i.test(name ?? "");
}

function isSvgAttachment(args: {
  name?: string;
  contentType?: string;
}): boolean {
  return (
    normalizeContentType(args.contentType) === "image/svg+xml" ||
    hasSvgFilename(args.name)
  );
}

function isSvgPayload(args: { name?: string; contentType?: string }): boolean {
  const contentType = normalizeContentType(args.contentType);
  return (
    contentType === "image/svg+xml" ||
    ((contentType === undefined ||
      contentType === "application/octet-stream") &&
      hasSvgFilename(args.name))
  );
}

function markReferenceOnlySvgAttachment(
  att: AgentChatAttachment,
  contentType: string | undefined,
) {
  att.type = "file";
  att.contentType = normalizeContentType(contentType) ?? "image/svg+xml";
  (att as any).referenceOnly = true;
  (att as any).securityNote = SVG_REFERENCE_SECURITY_NOTE;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Returns true when a file-upload provider is currently configured.
 * Used to decide whether an attachment can be uploaded before the agent turn.
 */
export function isFileUploadProviderConfigured(): boolean {
  return getActiveFileUploadProvider() !== null;
}

/**
 * Pre-upload chat image attachments through the active file-upload provider
 * (Builder.io by default) so the agent can embed hosted URLs in HTML, slide
 * content, and outbound messages. Keeps the original data URL in memory for
 * the current multimodal turn and adds a hosted `url`.
 *
 * Safe to call when no provider is configured: it returns the attachments
 * untouched with `providerMissing: true` so callers can surface the storage
 * setup card to the agent without persisting the binary payload.
 */
export async function preUploadImageAttachments(opts: {
  attachments: AgentChatAttachment[] | undefined;
  ownerEmail: string | null | undefined;
}): Promise<PreUploadAttachmentsResult> {
  return preUploadAttachments({ ...opts, includeFiles: false });
}

/**
 * Pre-upload ALL chat attachments (images AND files/PDFs) through the active
 * file-upload provider. When a provider is configured, each attachment gets a
 * `url` property injected so downstream code can store/send URLs instead of
 * base64. The base64 data is kept in-memory for the current turn so vision and
 * file-reading still work; callers that persist the attachment can drop the
 * data when a URL exists.
 *
 * When no provider is configured, returns untouched in-memory attachments with
 * `providerMissing: true`. The caller may still use the bytes for this turn,
 * but must not persist them as SQL/base64 attachment data.
 */
export async function preUploadAttachments(opts: {
  attachments: AgentChatAttachment[] | undefined;
  ownerEmail: string | null | undefined;
  /** When false, only images are uploaded (legacy behaviour). Default: true */
  includeFiles?: boolean;
}): Promise<PreUploadAttachmentsResult> {
  const list = Array.isArray(opts.attachments) ? opts.attachments : [];
  const includeFiles = opts.includeFiles !== false;
  const uploaded: PreUploadedImageAttachment[] = [];
  const uploadedFiles: PreUploadedFileAttachment[] = [];
  let providerMissing = false;
  let uploadFailed = false;

  if (list.length === 0) {
    return {
      attachments: list,
      uploaded,
      uploadedFiles,
      providerMissing: false,
      injectedText: null,
    };
  }

  for (const att of list) {
    const isImage = att.type === "image";
    const isFile = att.type === "file" || att.type === "document";
    if (!isImage && !(includeFiles && isFile)) continue;

    if (typeof att.url === "string" && att.url.trim()) {
      // Already pre-uploaded earlier in the pipeline — reuse it.
      const isReferenceOnlySvg =
        att.referenceOnly === true || isSvgAttachment(att);
      if (isReferenceOnlySvg) {
        markReferenceOnlySvgAttachment(att, att.contentType);
      }
      const entry = {
        name: att.name,
        url: att.url,
        provider: att.uploadProvider || "unknown",
        contentType: att.contentType,
        ...(isReferenceOnlySvg
          ? {
              referenceOnly: true,
              securityNote: SVG_REFERENCE_SECURITY_NOTE,
            }
          : {}),
      };
      if (isImage && !isReferenceOnlySvg) {
        uploaded.push(entry);
      } else {
        uploadedFiles.push(entry);
      }
      continue;
    }

    let data: string | undefined = att.data;
    if (
      typeof data !== "string" &&
      includeFiles &&
      isFile &&
      typeof att.text === "string" &&
      att.text.length > 0
    ) {
      // Text attachments are already decoded by the client. Upload the text
      // bytes too so a later turn has the same durable object URL as binary
      // attachments instead of a SQL-only scratch copy.
      const encoded = Buffer.from(att.text, "utf8").toString("base64");
      data = `data:${normalizeContentType(att.contentType) || "text/plain"};base64,${encoded}`;
    }
    if (typeof data !== "string") continue;

    const match = data.match(FILE_DATA_URL_RE);
    if (!match) continue;
    const dataUrlMimeType = normalizeContentType(match[1]);
    const mimeType =
      dataUrlMimeType || normalizeContentType(att.contentType) || match[1];
    const uploadAsImage =
      isImage && !isSvgPayload({ name: att.name, contentType: mimeType });
    const uploadAsFile =
      !uploadAsImage && (isImage || (includeFiles && isFile));
    if (!uploadAsImage && !uploadAsFile) continue;

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(Buffer.from(match[2], "base64"));
    } catch {
      continue;
    }

    try {
      const result = await uploadFile({
        data: bytes,
        filename: att.name,
        mimeType,
        ownerEmail: opts.ownerEmail || undefined,
      });
      if (!result) {
        providerMissing = true;
        att.storageRequired = true;
        continue;
      }
      att.url = result.url;
      att.uploadProvider = result.provider;
      const isReferenceOnlySvg = isSvgPayload({
        name: att.name,
        contentType: mimeType,
      });
      if (isReferenceOnlySvg) {
        markReferenceOnlySvgAttachment(att, mimeType);
      }
      const entry = {
        name: att.name,
        url: result.url,
        provider: result.provider,
        contentType: isReferenceOnlySvg ? att.contentType : mimeType,
        sizeBytes: bytes.byteLength,
        ...(isReferenceOnlySvg
          ? {
              referenceOnly: true,
              securityNote: SVG_REFERENCE_SECURITY_NOTE,
            }
          : {}),
      };
      if (uploadAsImage) {
        uploaded.push(entry);
      } else {
        uploadedFiles.push(entry);
      }
    } catch (err) {
      // Real upload failure (network, API). Keep the bytes in memory for the
      // current turn, but never treat the failure as a durable upload.
      att.storageRequired = true;
      uploadFailed = true;
      console.warn(
        "[agent-native] pre-upload of chat attachment failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  let injectedText: string | null = null;
  if (uploaded.length > 0 || uploadedFiles.length > 0) {
    const lines: string[] = [];
    for (const u of uploaded) {
      const attrs = [
        u.name ? `name="${escapeXmlAttr(u.name)}"` : null,
        `url="${escapeXmlAttr(u.url)}"`,
        u.contentType ? `contentType="${escapeXmlAttr(u.contentType)}"` : null,
        `provider="${escapeXmlAttr(u.provider)}"`,
      ].filter(Boolean);
      lines.push(`<chat-image-attachment ${attrs.join(" ")} />`);
    }
    for (const f of uploadedFiles) {
      const attrs = [
        f.name ? `name="${escapeXmlAttr(f.name)}"` : null,
        `url="${escapeXmlAttr(f.url)}"`,
        f.contentType ? `contentType="${escapeXmlAttr(f.contentType)}"` : null,
        `provider="${escapeXmlAttr(f.provider)}"`,
        f.referenceOnly ? `referenceOnly="true"` : null,
        f.securityNote
          ? `securityNote="${escapeXmlAttr(f.securityNote)}"`
          : null,
      ].filter(Boolean);
      lines.push(`<chat-file-attachment ${attrs.join(" ")} />`);
    }
    const hasReferenceOnlySvg = uploadedFiles.some(
      (file) => file.referenceOnly && isSvgAttachment(file),
    );
    const linesWithMetadata = [
      hasReferenceOnlySvg
        ? '<chat-attachments note="The user attached these files. Image attachment URLs may be used for embedding. File attachment URLs are references; SVG files are unsanitized vector source and must not be inlined as HTML or embedded in outbound content unless the target app sanitizes or stores them safely.">'
        : '<chat-attachments note="The user attached these files. Image attachment URLs may be used for embedding in HTML, slide content, or outbound messages. File attachment URLs are references for reading or attaching in target apps.">',
      ...lines,
      "</chat-attachments>",
    ];
    if (providerMissing || uploadFailed) {
      linesWithMetadata.push(
        "<chat-file-attachment-upload-error>",
        "One or more attachments could not be given a durable object-storage URL.",
        "Call `connect-file-storage` now so the user can connect Builder or configure custom storage keys, then continue using the hosted references.",
        "</chat-file-attachment-upload-error>",
      );
    }
    injectedText = linesWithMetadata.join("\n");
  } else if (providerMissing || uploadFailed) {
    injectedText = [
      "<chat-file-attachment-upload-error>",
      providerMissing
        ? "The user attached one or more images or files, but durable object storage is not configured for this app."
        : "The user attached one or more images or files, but the storage upload did not complete.",
      "Call `connect-file-storage` now to render the inline storage setup card. The user can connect Builder for managed storage or open the same card's custom-key setup for S3-compatible object storage.",
      "Do not claim the attachment is durably available, and do not persist its base64 contents in SQL. Until storage is connected, use the attachment only for this turn.",
      "</chat-file-attachment-upload-error>",
    ].join("\n");
  }

  return {
    attachments: list,
    uploaded,
    uploadedFiles,
    providerMissing,
    injectedText,
  };
}
