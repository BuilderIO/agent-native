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
  /** True if at least one image attachment failed to upload because no
   *  file-upload provider is configured. Templates use this to render a
   *  "Connect Builder.io" suggestion. */
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
 * Used to decide whether to attempt upload-first or fall back to base64.
 */
export function isFileUploadProviderConfigured(): boolean {
  return getActiveFileUploadProvider() !== null;
}

/**
 * Pre-upload chat image attachments through the active file-upload provider
 * (Builder.io by default) so the agent can embed hosted URLs in HTML, slide
 * content, and outbound messages. Keeps the original base64 data URL on the
 * attachment so multimodal vision still works — only adds a hosted `url`.
 *
 * Safe to call when no provider is configured: it returns the attachments
 * untouched with `providerMissing: true` so callers can surface a connect-
 * Builder.io hint to the agent.
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
 * Falls back gracefully when no provider is configured: returns untouched
 * attachments with `providerMissing: true` for image-type failures.
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
    if (typeof att.data !== "string") continue;

    if ((att as any).url) {
      // Already pre-uploaded earlier in the pipeline — reuse it.
      const isReferenceOnlySvg = isSvgAttachment(att);
      if (isReferenceOnlySvg) {
        markReferenceOnlySvgAttachment(att, att.contentType);
      }
      const entry = {
        name: att.name,
        url: (att as any).url as string,
        provider: ((att as any).uploadProvider as string) || "unknown",
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

    const match = att.data.match(FILE_DATA_URL_RE);
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
        if (uploadAsImage) providerMissing = true;
        continue;
      }
      (att as any).url = result.url;
      (att as any).uploadProvider = result.provider;
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
      // Real upload failure (network, API). Keep the base64 so the model
      // can still see the image/file, but don't crash the turn.
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
    injectedText = [
      hasReferenceOnlySvg
        ? '<chat-attachments note="The user attached these files. Image attachment URLs may be used for embedding. File attachment URLs are references; SVG files are unsanitized vector source and must not be inlined as HTML or embedded in outbound content unless the target app sanitizes or stores them safely.">'
        : '<chat-attachments note="The user attached these files. Image attachment URLs may be used for embedding in HTML, slide content, or outbound messages. File attachment URLs are references for reading or attaching in target apps.">',
      ...lines,
      "</chat-attachments>",
    ].join("\n");
  } else if (providerMissing) {
    injectedText = [
      "<chat-image-attachment-upload-error>",
      "The user attached one or more images, but no file-upload provider is configured for this app.",
      "If `connect-builder` is available, use it to render the inline Builder.io connection card. Workspaces with a custom storage provider can also use one registered via registerFileUploadProvider().",
      "Until that's done, you can still SEE the image, but you do NOT have a URL to embed it in HTML or share with other apps.",
      "</chat-image-attachment-upload-error>",
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
