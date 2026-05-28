import type { ChatThread } from "@agent-native/core/server";
import { getRequestContext, getThread } from "@agent-native/core/server";

export interface ThreadLinkPreview {
  title: string;
  description: string;
  imageUrl: string | null;
}

const IMAGE_URL_KEYS = new Set([
  "previewUrl",
  "thumbnailUrl",
  "imageUrl",
  "image",
  "downloadUrl",
]);

const GENERATION_TOOL_NAMES = new Set([
  "generate-image",
  "generate-image-batch",
  "refine-image",
  "rerun-generation-run",
]);

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function cleanUrlCandidate(value: string): string {
  return value
    .trim()
    .replace(/[),.;\]}]+$/g, "")
    .replace(/^["'(<]+/g, "");
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isImageLikeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      /\.(?:png|jpe?g|webp|gif|avif)(?:$|[?#])/i.test(url.pathname) ||
      /\/api\/assets\/[^/]+\/content(?:$|[?#])/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function validPreviewImageUrl(value: unknown, key?: string): string | null {
  if (typeof value !== "string") return null;
  const candidate = cleanUrlCandidate(value);
  if (!isAbsoluteHttpUrl(candidate)) return null;
  if (key && IMAGE_URL_KEYS.has(key)) return candidate;
  return isImageLikeUrl(candidate) ? candidate : null;
}

function imageUrlFromStructuredValue(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i--) {
      const found = imageUrlFromStructuredValue(value[i]);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of IMAGE_URL_KEYS) {
    const found = validPreviewImageUrl(record[key], key);
    if (found) return found;
  }
  for (const [key, child] of Object.entries(record).reverse()) {
    const direct = validPreviewImageUrl(child, key);
    if (direct) return direct;
    if (child && typeof child === "object") {
      const nested = imageUrlFromStructuredValue(child);
      if (nested) return nested;
    }
  }
  return null;
}

function imageUrlFromText(value: string): string | null {
  const matches = value.match(/https?:\/\/[^\s<>"']+/g);
  if (!matches) return null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const candidate = validPreviewImageUrl(matches[i]);
    if (candidate) return candidate;
  }
  return null;
}

export function extractThreadPreviewImageUrl(
  threadData: string,
): string | null {
  const parsed = safeJsonParse(threadData);
  if (!parsed || typeof parsed !== "object") return null;
  const messages = (parsed as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return null;

  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex--
  ) {
    const entry = messages[messageIndex] as any;
    const message = entry?.message ?? entry;
    const content = message?.content;
    if (!Array.isArray(content)) continue;

    for (let partIndex = content.length - 1; partIndex >= 0; partIndex--) {
      const part = content[partIndex] as Record<string, unknown>;
      const result = typeof part.result === "string" ? part.result : "";
      if (!result.trim()) continue;

      const toolName = typeof part.toolName === "string" ? part.toolName : "";
      const parsedResult = safeJsonParse(result);
      if (parsedResult && GENERATION_TOOL_NAMES.has(toolName)) {
        const structured = imageUrlFromStructuredValue(parsedResult);
        if (structured) return structured;
      }

      const fromText = imageUrlFromText(result);
      if (fromText) return fromText;
    }
  }
  return null;
}

function previewDescription(thread: ChatThread): string {
  const preview = thread.preview.trim();
  if (preview) return preview.slice(0, 180);
  return "Open this Agent-Native thread in Dispatch.";
}

export async function loadThreadLinkPreview(
  threadId: string | null | undefined,
): Promise<ThreadLinkPreview | null> {
  const id = threadId?.trim();
  if (!id) return null;
  const viewerEmail = getRequestContext()?.userEmail?.trim();
  if (!viewerEmail) return null;
  const thread = await getThread(id).catch(() => null);
  if (!thread) return null;
  if (thread.ownerEmail !== viewerEmail) return null;
  const title = thread.title.trim() || "Agent-Native thread";
  return {
    title,
    description: previewDescription(thread),
    imageUrl: extractThreadPreviewImageUrl(thread.threadData),
  };
}

export function buildThreadLinkPreviewMeta(preview: ThreadLinkPreview | null) {
  const title = preview?.title ? `${preview.title} - Dispatch` : "Dispatch";
  const description =
    preview?.description ||
    "Open this Agent-Native thread in the Dispatch workspace.";
  const image = preview?.imageUrl ?? null;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    ...(image ? [{ property: "og:image", content: image }] : []),
    {
      name: "twitter:card",
      content: image ? "summary_large_image" : "summary",
    },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    ...(image ? [{ name: "twitter:image", content: image }] : []),
  ];
}
