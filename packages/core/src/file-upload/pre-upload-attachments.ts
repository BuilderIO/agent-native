import type { AgentChatAttachment } from "../agent/types.js";
import { uploadFile } from "./registry.js";

export interface PreUploadedImageAttachment {
  name?: string;
  url: string;
  provider: string;
  contentType?: string;
}

export interface PreUploadAttachmentsResult {
  /** Same array reference. Each image attachment that was uploaded also gets a
   *  `url` property attached (non-breaking; consumers that don't read it are
   *  unaffected). */
  attachments: AgentChatAttachment[];
  /** Set when at least one image was uploaded. List of hosted URLs the agent
   *  can embed in HTML, slide content, documents, etc. */
  uploaded: PreUploadedImageAttachment[];
  /** True if at least one image attachment failed to upload because no
   *  file-upload provider is configured. Templates use this to render a
   *  "Connect Builder.io" suggestion. */
  providerMissing: boolean;
  /** A pre-formatted block to inject into the user message text so the agent
   *  has each hosted URL inline. Null when nothing was uploaded or no provider
   *  is configured. */
  injectedText: string | null;
}

const DATA_URL_RE = /^data:(image\/[^;]+);base64,(.+)$/;

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  const list = Array.isArray(opts.attachments) ? opts.attachments : [];
  const uploaded: PreUploadedImageAttachment[] = [];
  let providerMissing = false;

  if (list.length === 0) {
    return {
      attachments: list,
      uploaded,
      providerMissing: false,
      injectedText: null,
    };
  }

  for (const att of list) {
    if (att.type !== "image" || typeof att.data !== "string") continue;
    if ((att as any).url) {
      // Already pre-uploaded earlier in the pipeline — reuse it.
      uploaded.push({
        name: att.name,
        url: (att as any).url as string,
        provider: ((att as any).uploadProvider as string) || "unknown",
        contentType: att.contentType,
      });
      continue;
    }

    const match = att.data.match(DATA_URL_RE);
    if (!match) continue;
    const mimeType = match[1];
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
        continue;
      }
      (att as any).url = result.url;
      (att as any).uploadProvider = result.provider;
      uploaded.push({
        name: att.name,
        url: result.url,
        provider: result.provider,
        contentType: att.contentType,
      });
    } catch (err) {
      // Real upload failure (network, API). Keep the base64 so the model
      // can still see the image, but don't crash the turn.
      console.warn(
        "[agent-native] pre-upload of chat image attachment failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  let injectedText: string | null = null;
  if (uploaded.length > 0) {
    const lines = uploaded.map((u) => {
      const attrs = [
        u.name ? `name="${escapeXmlAttr(u.name)}"` : null,
        `url="${escapeXmlAttr(u.url)}"`,
        u.contentType ? `contentType="${escapeXmlAttr(u.contentType)}"` : null,
        `provider="${escapeXmlAttr(u.provider)}"`,
      ].filter(Boolean);
      return `<chat-image-attachment ${attrs.join(" ")} />`;
    });
    injectedText = [
      '<chat-image-attachments note="The user attached these images. They have been uploaded — use the url attribute when embedding in HTML, slide content, or any outbound message.">',
      ...lines,
      "</chat-image-attachments>",
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

  return { attachments: list, uploaded, providerMissing, injectedText };
}
