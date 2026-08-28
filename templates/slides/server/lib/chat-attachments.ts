import path from "path";

import {
  getRequestRunContext,
  type AgentChatAttachment,
} from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";

import {
  isSlidesReferenceFileExtension,
  MAX_INLINE_IMAGE_BYTES,
  MAX_REFERENCE_FILE_BYTES,
} from "../../shared/upload-types.js";
import { saveUploadedReferenceFile } from "../handlers/uploads.js";

const MAX_CHAT_UPLOAD_BYTES = MAX_REFERENCE_FILE_BYTES;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

/** Keep the original deck brief and file handles in every scoped follow-up. */
export function buildSlidesDeckGenerationContext(
  value: unknown,
): string | null {
  if (!isRecord(value)) return null;
  const originalPrompt = boundedString(value.originalPrompt, 12_000);
  if (!originalPrompt) return null;

  const files = Array.isArray(value.files)
    ? value.files
        .flatMap((file) => {
          if (!isRecord(file)) return [];
          const name = boundedString(file.originalName, 160) ?? "reference";
          const path = boundedString(file.path, 2_000);
          const url = boundedString(file.url, 2_000);
          if (!path && !url) return [];
          const locations = [
            path ? `path: ${path}` : null,
            url ? `URL: ${url}` : null,
          ]
            .filter((location): location is string => Boolean(location))
            .join("; ");
          return [`- ${name} (${locations})`];
        })
        .slice(0, 20)
    : [];
  const mode = boundedString(value.mode, 40);
  const targetSlideCount =
    typeof value.targetSlideCount === "number" &&
    Number.isInteger(value.targetSlideCount) &&
    value.targetSlideCount > 0
      ? String(value.targetSlideCount)
      : null;
  const designSystemId = boundedString(value.designSystemId, 200);
  const referenceDeckId = boundedString(value.referenceDeckId, 200);
  const referenceSourceValue = isRecord(value.referenceSource)
    ? boundedString(value.referenceSource.value, 2_000)
    : null;
  const referenceSourceKind = isRecord(value.referenceSource)
    ? boundedString(value.referenceSource.kind, 40)
    : null;

  return [
    "<slides-deck-generation-context>",
    "This is the canonical context for the current deck's continuation. Treat the latest user message as a modifier to this original request unless it explicitly asks for a new story or deck.",
    `Original brief: ${originalPrompt}`,
    mode ? `Generation mode: ${mode}` : null,
    targetSlideCount ? `Target slide count: ${targetSlideCount}` : null,
    designSystemId ? `Design system id: ${designSystemId}` : null,
    referenceDeckId ? `Reference deck id: ${referenceDeckId}` : null,
    referenceSourceKind && referenceSourceValue
      ? `Selected reference source: ${referenceSourceKind}: ${referenceSourceValue}`
      : null,
    "Reference files from the original request:",
    ...(files.length > 0
      ? files
      : [
          "- No file handle was persisted; use the current deck and thread evidence.",
        ]),
    "Re-open visual references before editing with a persisted URL when present. Private paths are available to Slides file actions for supported document/deck formats; for a private raster image without a URL, call import-file with format=image to attach it to vision before editing. If a visual source cannot be reopened, do not claim visual inspection you did not perform. Do not infer a new unrelated topic from the follow-up message or from placeholder/brand text in the reference.",
    "For source-preserving generation, continue the original slide sequence and finish all original/source slides before adding unrelated content. Verify with get-deck compact=true and do not claim completion until sourceCoverage.complete is true for the ordered source manifest, or the target slide count is satisfied for a new deck.",
    "</slides-deck-generation-context>",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export async function readSlidesDeckGenerationContext(): Promise<
  string | null
> {
  const scope = getRequestRunContext()?.chatScope;
  if (scope?.type !== "deck" || !scope.id) return null;

  const access = await resolveAccess("deck", scope.id);
  if (!access) return null;

  try {
    const data = JSON.parse(access.resource.data) as unknown;
    return buildSlidesDeckGenerationContext(
      isRecord(data) ? data.generationContext : null,
    );
  } catch (error) {
    console.warn("[slides-agent-chat] Could not read persisted deck context", {
      deckId: scope.id,
      error,
    });
    return null;
  }
}

export function appendSlidesDeckGenerationContext(
  message: string,
  context: string | null,
): string {
  return context ? [message, context].join("\n\n") : message;
}

function decodeDataUrl(data: string | undefined): {
  bytes: Buffer;
  contentType: string;
} | null {
  const match = data?.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!match) return null;
  return {
    contentType: match[1] || "application/octet-stream",
    bytes: Buffer.from(match[2], "base64"),
  };
}

function attachmentDataUrl(attachment: AgentChatAttachment): string | null {
  if (typeof attachment.data !== "string") return null;
  if (
    attachment.type === "image" ||
    attachment.type === "file" ||
    attachment.type === "document"
  ) {
    return attachment.data;
  }
  return null;
}

export async function prepareSlidesChatAttachments(args: {
  ownerEmail: string | null;
  message: string;
  attachments: AgentChatAttachment[];
}): Promise<{ message?: string; attachments?: AgentChatAttachment[] } | void> {
  const generationContext = await readSlidesDeckGenerationContext();
  if (!args.ownerEmail || args.attachments.length === 0) {
    const message = appendSlidesDeckGenerationContext(
      args.message,
      generationContext,
    );
    return message === args.message ? undefined : { message };
  }

  const uploaded: Array<{
    originalName: string;
    path: string;
    url?: string;
    type: string;
    // Unset (not 0) for an attachment we never downloaded — an already-hosted
    // URL-only attachment has no known byte size, and "0" would misreport it
    // as an empty file instead of an unmeasured one.
    size?: number;
  }> = [];
  const failed: Array<{ name: string; reason: string }> = [];
  const nextAttachments = [...args.attachments];

  for (let index = 0; index < args.attachments.length; index++) {
    const attachment = args.attachments[index];
    if (!attachment) continue;
    const ext = path.extname(attachment.name).toLowerCase();

    // An attachment can arrive already durably hosted — a plain `url` with no
    // inline `data` (e.g. `referenceImagePaths`/image content parts wrap an
    // uploaded file as `{ type: "image", url }`, per
    // packages/core/src/client/agent-chat-adapter.ts). There are no bytes to
    // save, but the file IS attached; skipping it here because only `data`
    // was ever recognized as "attached" is what silently drops it and leaves
    // the agent with no signal it exists.
    if (
      typeof attachment.data !== "string" &&
      typeof attachment.url === "string"
    ) {
      if (isSlidesReferenceFileExtension(ext)) {
        uploaded.push({
          originalName: attachment.name,
          path: attachment.url,
          url: attachment.url,
          type: attachment.contentType || "application/octet-stream",
        });
      }
      continue;
    }

    const dataUrl = attachmentDataUrl(attachment);
    if (!dataUrl) continue;

    if (!isSlidesReferenceFileExtension(ext)) continue;

    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) continue;
    if (decoded.bytes.length > MAX_CHAT_UPLOAD_BYTES) {
      failed.push({
        name: attachment.name,
        reason: "file is larger than the 50 MB upload limit",
      });
      continue;
    }

    try {
      const saved = await saveUploadedReferenceFile({
        email: args.ownerEmail,
        originalName: attachment.name,
        data: decoded.bytes,
        type: attachment.contentType || decoded.contentType,
      });
      uploaded.push(saved);
      nextAttachments[index] = stripForwardedAttachmentData(attachment, saved);
    } catch (error) {
      failed.push({
        name: attachment.name,
        reason: error instanceof Error ? error.message : "upload failed",
      });
    }
  }

  if (uploaded.length === 0 && failed.length === 0) {
    const message = appendSlidesDeckGenerationContext(
      args.message,
      generationContext,
    );
    return message === args.message ? undefined : { message };
  }

  const fileList = uploaded
    .map(
      (file) =>
        `- ${file.originalName} (${file.type}${typeof file.size === "number" ? `, ${(file.size / 1024).toFixed(1)}KB` : ""}) at path: ${file.path}${file.url ? `; embeddable URL: ${file.url}` : ""}`,
    )
    .join("\n");
  const failureList = failed
    .map((file) => `- ${file.name}: ${file.reason}`)
    .join("\n");
  // saveUploadedReferenceFile() saves the file either way but swallows the
  // public-URL upload failure (missing/misbehaving file-upload provider) so
  // the private path is never blocked. Without this callout the agent has no
  // signal that embedding is impossible and silently drops the image from
  // the deck instead of telling the user why.
  const unembeddableImages = uploaded.filter(
    (file) => !file.url && file.type.startsWith("image/"),
  );
  const unembeddableImageList = unembeddableImages
    .map((file) => `- ${file.originalName}`)
    .join("\n");
  const attachmentContext = [
    "<slides-chat-attachments>",
    uploaded.length > 0
      ? [
          "The user attached file(s) in chat. They have been saved as real server upload paths that Slides import actions can read:",
          fileList,
          "",
          "File handling rules:",
          "- If the request refers to the current or visible deck, call `view-screen` first to confirm the active deckId, then pass that deckId to import or slide-edit actions.",
          '- PPTX files: when the user wants the visible deck improved, call `import-pptx --filePath "<path>" --deckId <deckId>` first, then use one patch-deck call with requireAllSourceSlides=true and one content patch per imported slide for a deck-wide restyle. Use update-slide only for a targeted one-slide edit. Do not rebuild the source deck with add-slide.',
          '- PDF and DOCX files: call `import-file --filePath "<path>" --format auto --deckId <deckId>` and use the returned extracted text as source material before creating editable slides. For a visual PDF that the user wants preserved, beautified, or restyled from its original layout, pass `--importIntoDeck true` first: a PDF exported from this app restores its original editable slides, and any other PDF is rebuilt into positioned text boxes and images. Keep what the import produced and style around it rather than retyping it; source text is persisted in slide notes for inspection.',
          '- Figma `.fig` files: call `import-file --filePath "<path>" --format fig` to start Builder design-system indexing. Do not create a local design system directly from the upload.',
          "- For deck-generation requests, start mutating promptly: create or update the first slide as soon as source material is extracted, then continue slide-by-slide with add-slide/update-slide.",
          '- Image files with an embeddable URL can be inserted directly into slide HTML as `<img src="...">` or used as visual references.',
          "- Do not say no PDF/PPTX/DOCX/FIG/image was attached when a matching saved path is listed here.",
        ].join("\n")
      : "",
    unembeddableImages.length > 0
      ? [
          "The following attached image(s) have NO embeddable URL — the file-upload provider that hosts public image URLs failed or is not configured, so they were only saved to private import storage and CANNOT be embedded as `<img>` in slide HTML:",
          unembeddableImageList,
          "Do not silently skip these images. Tell the user the image(s) could not be added to the deck because no public file-upload provider is available, and that connecting Builder.io (or another file provider) in Settings will enable embedding.",
        ].join("\n")
      : "",
    failed.length > 0
      ? [
          "Some attached file(s) could not be saved to Slides upload storage:",
          failureList,
          "The binary attachment is still present in the chat request; use it directly if the model supports it, otherwise report the save error exactly.",
        ].join("\n")
      : "",
    "</slides-chat-attachments>",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    message: appendSlidesDeckGenerationContext(
      [args.message, attachmentContext].join("\n\n"),
      generationContext,
    ),
    attachments: nextAttachments,
  };
}

function stripForwardedAttachmentData(
  attachment: AgentChatAttachment,
  saved: { path: string; url?: string },
): AgentChatAttachment {
  const next = { ...attachment };
  // Keep visual data for the current model turn so uploaded screenshots remain
  // available for vision analysis. Keep non-visual bytes until core's shared
  // pre-upload boundary has created the durable public object-storage URL;
  // `slidesUploadPath` is a private import handle, not a chat attachment URL.
  const inlineImage = isVisualAttachment(attachment)
    ? decodeDataUrl(attachment.data)
    : null;
  if (!inlineImage && (saved.url || !attachment.data)) {
    delete next.data;
  } else if (inlineImage && inlineImage.bytes.length > MAX_INLINE_IMAGE_BYTES) {
    delete next.data;
  }
  (next as any).slidesUploadPath = saved.path;
  if (saved.url) {
    (next as any).url = saved.url;
  }
  return next;
}

function isVisualAttachment(attachment: AgentChatAttachment): boolean {
  return (
    attachment.type === "image" ||
    (typeof attachment.contentType === "string" &&
      attachment.contentType.toLowerCase().startsWith("image/"))
  );
}
