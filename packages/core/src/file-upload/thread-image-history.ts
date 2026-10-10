import type { AgentChatAttachment } from "../agent/types.js";
import {
  createOwnedAttachmentHydrationBudget,
  hydrateOwnedImageUrl,
  MAX_OWNED_ATTACHMENT_HYDRATION_CANDIDATES,
} from "./owned-attachment.js";

interface PriorImageCandidate {
  name: string;
  contentType?: string;
  url?: string;
}

export class PriorThreadImageHistoryReadError extends Error {
  readonly code = "prior_attachment_history_unreadable";

  constructor() {
    super("Prior chat attachment history could not be read.");
    this.name = "PriorThreadImageHistoryReadError";
  }
}

export interface PriorThreadImageHistory {
  attachments: AgentChatAttachment[];
  contextNote?: string;
}

function candidatesFromThreadData(threadData: string): PriorImageCandidate[] {
  let data: unknown;
  try {
    data = JSON.parse(threadData);
  } catch {
    throw new PriorThreadImageHistoryReadError();
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new PriorThreadImageHistoryReadError();
  }

  const messages = (data as { messages?: unknown }).messages;
  if (messages === undefined) return [];
  if (!Array.isArray(messages)) throw new PriorThreadImageHistoryReadError();

  const candidates: PriorImageCandidate[] = [];
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex--
  ) {
    const entry = messages[messageIndex];
    const message =
      entry && typeof entry === "object" && "message" in entry
        ? (entry as { message?: unknown }).message
        : entry;
    if (!message || typeof message !== "object") continue;
    const userMessage = message as {
      role?: unknown;
      attachments?: unknown;
    };
    if (
      userMessage.role !== "user" ||
      !Array.isArray(userMessage.attachments)
    ) {
      continue;
    }

    for (
      let attachmentIndex = userMessage.attachments.length - 1;
      attachmentIndex >= 0;
      attachmentIndex--
    ) {
      const attachment = userMessage.attachments[attachmentIndex];
      if (!attachment || typeof attachment !== "object") continue;
      const stored = attachment as {
        type?: unknown;
        name?: unknown;
        contentType?: unknown;
        content?: unknown;
        metadata?: unknown;
      };
      if (stored.type !== "image") continue;

      const imagePart = Array.isArray(stored.content)
        ? stored.content.find(
            (part) =>
              part &&
              typeof part === "object" &&
              (part as { type?: unknown }).type === "image",
          )
        : undefined;
      const imageUrl =
        imagePart && typeof imagePart === "object"
          ? (imagePart as { image?: unknown }).image
          : undefined;
      const metadataUrl =
        stored.metadata && typeof stored.metadata === "object"
          ? (stored.metadata as { uploadUrl?: unknown }).uploadUrl
          : undefined;
      candidates.push({
        name: typeof stored.name === "string" ? stored.name : "image",
        ...(typeof stored.contentType === "string"
          ? { contentType: stored.contentType }
          : {}),
        ...(typeof imageUrl === "string" && !imageUrl.startsWith("data:")
          ? { url: imageUrl }
          : typeof metadataUrl === "string" && !metadataUrl.startsWith("data:")
            ? { url: metadataUrl }
            : {}),
      });
    }
  }

  return candidates.reverse();
}

/**
 * Rehydrate only recent image references from an already-authorized thread.
 * URL ownership and download limits are enforced by hydrateOwnedImageUrl.
 */
export async function hydratePriorThreadImages(
  threadData: string,
): Promise<PriorThreadImageHistory> {
  const candidates = candidatesFromThreadData(threadData);
  const selected = candidates.slice(-MAX_OWNED_ATTACHMENT_HYDRATION_CANDIDATES);
  const omittedCount = candidates.length - selected.length;
  const budget = createOwnedAttachmentHydrationBudget();
  const attachments: AgentChatAttachment[] = [];
  let unreadableCount = 0;

  for (const candidate of selected) {
    if (!candidate.url) {
      unreadableCount++;
      continue;
    }
    const result = await hydrateOwnedImageUrl(
      candidate.url,
      candidate.contentType,
      budget,
    );
    if (result.kind !== "hydrated") {
      unreadableCount++;
      continue;
    }
    attachments.push({
      type: "image",
      name: candidate.name,
      contentType: result.mediaType,
      data: result.dataUrl,
    });
  }

  const notes: string[] = [];
  if (unreadableCount > 0) {
    notes.push(
      `${unreadableCount} earlier image attachment${unreadableCount === 1 ? " was" : "s were"} not readable from configured upload storage. Do not describe or infer their contents.`,
    );
  }
  if (omittedCount > 0) {
    notes.push(
      `Only the ${selected.length} most recent earlier images fit the bounded vision history; ${omittedCount} older image attachment${omittedCount === 1 ? " was" : "s were"} omitted.`,
    );
  }

  return {
    attachments,
    ...(notes.length > 0
      ? {
          contextNote: `<prior-chat-image-context>${notes.join(" ")}</prior-chat-image-context>`,
        }
      : {}),
  };
}
