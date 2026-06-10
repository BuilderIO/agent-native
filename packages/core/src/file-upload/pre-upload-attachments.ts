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

const IMAGE_DATA_URL_RE = /^data:(image\/[^;]+);base64,(.+)$/;
const FILE_DATA_URL_RE = /^data:([^;]+);base64,(.+)$/;

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
      const entry = {
        name: att.name,
        url: (att as any).url as string,
        provider: ((att as any).uploadProvider as string) || "unknown",
        contentType: att.contentType,
      };
      if (isImage) {
        uploaded.push(entry);
      } else {
        uploadedFiles.push(entry);
      }
      continue;
    }

    const re = isImage ? IMAGE_DATA_URL_RE : FILE_DATA_URL_RE;
    const match = att.data.match(re);
    if (!match) continue;
    const mimeType = att.contentType || match[1];
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
        if (isImage) providerMissing = true;
        continue;
      }
      (att as any).url = result.url;
      (att as any).uploadProvider = result.provider;
      const entry = {
        name: att.name,
        url: result.url,
        provider: result.provider,
        contentType: att.contentType,
        sizeBytes: bytes.byteLength,
      };
      if (isImage) {
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
      ].filter(Boolean);
      lines.push(`<chat-file-attachment ${attrs.join(" ")} />`);
    }
    injectedText = [
      '<chat-attachments note="The user attached these files. They have been uploaded — use the url attribute when embedding in HTML, slide content, or any outbound message.">',
      ...lines,
      "</chat-attachments>",
    ].join("\n");
  } else if (providerMissing) {
    injectedText = [
      "<chat-image-attachment-upload-error>",
      "The user attached one or more images, but no file-upload provider is configured for this app.",
      "Tell the user they need to configure one of: (a) Builder.io — recommended, free credits, one-click connect from Settings → File uploads, (b) BUILDER_PRIVATE_KEY environment variable, (c) a custom provider like S3 / R2 / GCS registered via registerFileUploadProvider(). Use `connect-builder` to render an inline connect card for option (a) when available.",
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
