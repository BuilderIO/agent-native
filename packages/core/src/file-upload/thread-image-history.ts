import type { AgentChatAttachment } from "../agent/types.js";
import {
  claimOwnedAttachmentHydrationCandidate,
  createOwnedAttachmentHydrationBudget,
  hydrateOwnedImageUrl,
  MAX_OWNED_ATTACHMENT_HYDRATION_CANDIDATES,
  type OwnedAttachmentHydrationBudget,
} from "./owned-attachment.js";

interface PriorImageCandidate {
  name: string;
  contentType?: string;
  url: string;
}

interface PriorImageCandidates {
  retained: PriorImageCandidate[];
  neverRetainedCount: number;
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

function candidatesFromThreadData(threadData: string): PriorImageCandidates {
  let data: unknown;
  try {
    data = threadData.trim() ? JSON.parse(threadData) : {};
  } catch {
    throw new PriorThreadImageHistoryReadError();
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new PriorThreadImageHistoryReadError();
  }

  const messages = (data as { messages?: unknown }).messages;
  if (messages === undefined) return { retained: [], neverRetainedCount: 0 };
  if (!Array.isArray(messages)) throw new PriorThreadImageHistoryReadError();

  const candidates: PriorImageCandidate[] = [];
  let neverRetainedCount = 0;
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
      const url =
        typeof imageUrl === "string" && !imageUrl.startsWith("data:")
          ? imageUrl
          : typeof metadataUrl === "string" && !metadataUrl.startsWith("data:")
            ? metadataUrl
            : undefined;
      if (!url) {
        neverRetainedCount++;
        continue;
      }
      candidates.push({
        name: typeof stored.name === "string" ? stored.name : "image",
        ...(typeof stored.contentType === "string"
          ? { contentType: stored.contentType }
          : {}),
        url,
      });
    }
  }

  return { retained: candidates.reverse(), neverRetainedCount };
}

/**
 * Rehydrate only recent image references from an already-authorized thread.
 * URL ownership and download limits are enforced by hydrateOwnedImageUrl.
 * Images named in excludeUrls are dropped before the candidate cap, so they
 * do not use up a slot.
 */
export async function hydratePriorThreadImages(
  threadData: string,
  options: {
    excludeUrls?: readonly string[];
    budget?: OwnedAttachmentHydrationBudget;
  } = {},
): Promise<PriorThreadImageHistory> {
  const { retained, neverRetainedCount } = candidatesFromThreadData(threadData);
  // Exact-string match is deliberate: structured history only sends canonical
  // https URLs without query or hash, so a near-miss URL is sent twice rather
  // than dropped.
  const excludedUrls = new Set(options.excludeUrls ?? []);
  const candidates = retained.filter(
    (candidate) => !excludedUrls.has(candidate.url),
  );
  const budget = options.budget ?? createOwnedAttachmentHydrationBudget();
  const candidateLimit = Math.min(
    MAX_OWNED_ATTACHMENT_HYDRATION_CANDIDATES,
    budget.remainingCandidates,
  );
  const selected = candidateLimit > 0 ? candidates.slice(-candidateLimit) : [];
  const omittedCount = candidates.length - selected.length;
  const attachments: AgentChatAttachment[] = [];
  let unreadableCount = 0;

  for (const candidate of selected) {
    if (!claimOwnedAttachmentHydrationCandidate(budget)) break;
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
  if (neverRetainedCount > 0) {
    notes.push(
      `${neverRetainedCount} earlier image attachment${neverRetainedCount === 1 ? " had" : "s had"} no retained upload URL, so its contents were not restored. Do not describe or infer them.`,
    );
  }
  if (unreadableCount > 0) {
    notes.push(
      `${unreadableCount} retained image attachment${unreadableCount === 1 ? " was" : "s were"} not readable from configured upload storage. Do not describe or infer their contents.`,
    );
  }
  if (omittedCount > 0) {
    notes.push(
      `Only the ${selected.length} most recent earlier images with retained upload URLs fit the bounded vision history; ${omittedCount} older retained image attachment${omittedCount === 1 ? " was" : "s were"} omitted.`,
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
