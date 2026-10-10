import { createHash } from "node:crypto";

import type { AgentChatAttachment } from "../agent/types.js";
import { parseBase64DataUrl } from "../shared/data-url.js";
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

export function canonicalImageReferenceUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) {
      url.hash = "";
      const canonical = url.toString();
      if (canonical.length <= 2_048) return canonical;
    }
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  return value;
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

export interface PriorThreadImageHistoryCacheScope {
  ownerEmail: string;
  orgId?: string | null;
  threadId: string;
}

export const PRIOR_THREAD_IMAGE_CACHE_TTL_MS = 5 * 60 * 1000;
export const MAX_PRIOR_THREAD_IMAGE_CACHE_ENTRIES = 16;
export const MAX_PRIOR_THREAD_IMAGE_CACHE_ENCODED_BYTES = 32 * 1024 * 1024;

interface CachedPriorThreadImages {
  expiresAt: number;
  encodedBytes: number;
  byCandidate: Map<string, AgentChatAttachment>;
  expirationTimer: ReturnType<typeof setTimeout>;
}

const priorThreadImageCache = new Map<string, CachedPriorThreadImages>();
let priorThreadImageCacheEncodedBytes = 0;

function removeCachedPriorThreadImages(key: string): void {
  const entry = priorThreadImageCache.get(key);
  if (!entry) return;
  priorThreadImageCache.delete(key);
  priorThreadImageCacheEncodedBytes -= entry.encodedBytes;
  clearTimeout(entry.expirationTimer);
}

function expirePriorThreadImageCache(now: number): void {
  for (const [key, entry] of priorThreadImageCache) {
    if (entry.expiresAt <= now) removeCachedPriorThreadImages(key);
  }
}

function getCachedPriorThreadImages(
  key: string,
  now: number,
): CachedPriorThreadImages | undefined {
  expirePriorThreadImageCache(now);
  const entry = priorThreadImageCache.get(key);
  if (!entry) return undefined;
  priorThreadImageCache.delete(key);
  priorThreadImageCache.set(key, entry);
  return entry;
}

function encodedAttachmentBytes(attachment: AgentChatAttachment): number {
  return typeof attachment.data === "string"
    ? Buffer.byteLength(attachment.data, "utf8")
    : 0;
}

function cachePriorThreadImages(
  key: string,
  previous: CachedPriorThreadImages | undefined,
  successful: ReadonlyMap<string, AgentChatAttachment>,
  now: number,
): void {
  if (successful.size === 0) return;

  const byCandidate = new Map(previous?.byCandidate);
  for (const [identity, attachment] of successful) {
    byCandidate.set(identity, attachment);
  }
  const encodedBytes = [...byCandidate.values()].reduce(
    (total, attachment) => total + encodedAttachmentBytes(attachment),
    0,
  );
  if (encodedBytes > MAX_PRIOR_THREAD_IMAGE_CACHE_ENCODED_BYTES) return;

  removeCachedPriorThreadImages(key);
  while (
    priorThreadImageCache.size > 0 &&
    (priorThreadImageCache.size >= MAX_PRIOR_THREAD_IMAGE_CACHE_ENTRIES ||
      priorThreadImageCacheEncodedBytes + encodedBytes >
        MAX_PRIOR_THREAD_IMAGE_CACHE_ENCODED_BYTES)
  ) {
    const leastRecentlyUsed = priorThreadImageCache.keys().next().value;
    if (typeof leastRecentlyUsed !== "string") break;
    removeCachedPriorThreadImages(leastRecentlyUsed);
  }

  const entry: CachedPriorThreadImages = {
    expiresAt: now + PRIOR_THREAD_IMAGE_CACHE_TTL_MS,
    encodedBytes,
    byCandidate,
    expirationTimer: setTimeout(
      () => removeCachedPriorThreadImages(key),
      PRIOR_THREAD_IMAGE_CACHE_TTL_MS,
    ),
  };
  entry.expirationTimer.unref?.();
  priorThreadImageCache.set(key, entry);
  priorThreadImageCacheEncodedBytes += encodedBytes;
}

function candidateIdentity(candidate: PriorImageCandidate): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        candidate.name,
        candidate.contentType ?? null,
        candidate.url,
      ]),
    )
    .digest("hex");
}

function durableHistoryImageUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return undefined;
  }
  const durableUrl = url.toString();
  return durableUrl.length <= 2_048 ? durableUrl : undefined;
}

export function retainedStructuredHistoryImageUrls(
  history: unknown,
): ReadonlySet<string> {
  const urls = new Set<string>();
  if (!Array.isArray(history)) return urls;

  for (const message of history) {
    if (
      !message ||
      typeof message !== "object" ||
      (message as { role?: unknown }).role !== "user" ||
      !Array.isArray((message as { content?: unknown }).content)
    ) {
      continue;
    }
    for (const part of (message as { content: unknown[] }).content) {
      if (!part || typeof part !== "object") continue;
      const reference = part as Record<string, unknown>;
      if (
        reference.type !== "image-reference" ||
        typeof reference.url !== "string" ||
        reference.url.length > 2_048 ||
        (reference.name !== undefined &&
          (typeof reference.name !== "string" ||
            reference.name.length > 200)) ||
        (reference.mediaType !== undefined &&
          (typeof reference.mediaType !== "string" ||
            reference.mediaType.length > 100))
      ) {
        continue;
      }
      const url = durableHistoryImageUrl(reference.url);
      if (url) urls.add(url);
    }
  }

  return urls;
}

function priorThreadImageCacheKey(
  scope: PriorThreadImageHistoryCacheScope | undefined,
  candidates: readonly PriorImageCandidate[],
): string | undefined {
  if (!scope?.ownerEmail || !scope.threadId || candidates.length === 0) {
    return undefined;
  }
  const identities = candidates.map(candidateIdentity);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(identities))
    .digest("hex");
  return JSON.stringify([
    scope.ownerEmail,
    scope.orgId ?? null,
    scope.threadId,
    fingerprint,
  ]);
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
  const seenCanonicalUrls = new Set<string>();
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
      const canonicalUrl = canonicalImageReferenceUrl(url);
      if (seenCanonicalUrls.has(canonicalUrl)) continue;
      seenCanonicalUrls.add(canonicalUrl);
      candidates.push({
        name: typeof stored.name === "string" ? stored.name : "image",
        ...(typeof stored.contentType === "string"
          ? { contentType: stored.contentType }
          : {}),
        url: canonicalUrl,
      });
    }
  }

  return { retained: candidates.reverse(), neverRetainedCount };
}

/**
 * Rehydrate only recent image references from an already-authorized thread.
 * URL ownership and download limits are enforced by hydrateOwnedImageUrl.
 */
export async function hydratePriorThreadImages(
  threadData: string,
  options: {
    cacheScope?: PriorThreadImageHistoryCacheScope;
    excludeUrls?: ReadonlySet<string>;
    budget?: OwnedAttachmentHydrationBudget;
  } = {},
): Promise<PriorThreadImageHistory> {
  const { retained: candidates, neverRetainedCount } =
    candidatesFromThreadData(threadData);
  const remainingCandidates = candidates.filter((candidate) => {
    // Candidates are canonical, so exclusion sets must use the same form.
    return !options.excludeUrls?.has(candidate.url);
  });
  const budget = options.budget ?? createOwnedAttachmentHydrationBudget();
  const candidateLimit = Math.max(
    0,
    Math.min(
      MAX_OWNED_ATTACHMENT_HYDRATION_CANDIDATES,
      budget.remainingCandidates,
    ),
  );
  const selected =
    candidateLimit > 0 ? remainingCandidates.slice(-candidateLimit) : [];
  const omittedCount = remainingCandidates.length - selected.length;
  const now = Date.now();
  const cacheKey = priorThreadImageCacheKey(options.cacheScope, selected);
  const cached = cacheKey
    ? getCachedPriorThreadImages(cacheKey, now)
    : undefined;
  const attachments: AgentChatAttachment[] = [];
  const newlyHydrated = new Map<string, AgentChatAttachment>();
  let unreadableCount = 0;
  let budgetOmittedCount = 0;

  const hydrationOrder = [...selected].reverse();
  for (let index = 0; index < hydrationOrder.length; index++) {
    const candidate = hydrationOrder[index]!;
    if (!claimOwnedAttachmentHydrationCandidate(budget)) break;
    const identity = candidateIdentity(candidate);
    const cachedAttachment = cached?.byCandidate.get(identity);
    if (cachedAttachment) {
      const parsed =
        typeof cachedAttachment.data === "string"
          ? parseBase64DataUrl(cachedAttachment.data)
          : null;
      const cachedBytes = parsed
        ? Buffer.byteLength(parsed.data, "base64")
        : Number.POSITIVE_INFINITY;
      if (cachedBytes > budget.remainingBytes) {
        budgetOmittedCount++;
        continue;
      }
      budget.remainingBytes -= cachedBytes;
      attachments.push({ ...cachedAttachment });
      continue;
    }
    const result = await hydrateOwnedImageUrl(
      candidate.url,
      candidate.contentType,
      budget,
    );
    if (result.kind !== "hydrated") {
      if (result.code === "request-time-limit") {
        // The deadline is shared, so every later candidate would fail the same way.
        budgetOmittedCount += hydrationOrder.length - index;
        break;
      }
      if (result.code === "request-byte-limit") {
        budgetOmittedCount++;
        continue;
      }
      unreadableCount++;
      continue;
    }
    const attachment: AgentChatAttachment = {
      type: "image",
      name: candidate.name,
      contentType: result.mediaType,
      data: result.dataUrl,
    };
    attachments.push(attachment);
    newlyHydrated.set(identity, attachment);
  }

  if (cacheKey) {
    cachePriorThreadImages(cacheKey, cached, newlyHydrated, now);
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
  if (budgetOmittedCount > 0) {
    notes.push(
      `${budgetOmittedCount} retained image attachment${budgetOmittedCount === 1 ? " was" : "s were"} omitted to stay within the request-wide image hydration budget.`,
    );
  }
  if (omittedCount > 0) {
    notes.push(
      candidateLimit > 0
        ? `Only the ${selected.length} most recent earlier images with retained upload URLs fit the bounded vision history; ${omittedCount} older retained image attachment${omittedCount === 1 ? " was" : "s were"} omitted.`
        : `${omittedCount} retained image attachment${omittedCount === 1 ? " was" : "s were"} omitted because the request-wide image hydration budget is exhausted.`,
    );
  }

  return {
    attachments: attachments.reverse(),
    ...(notes.length > 0
      ? {
          contextNote: `<prior-chat-image-context>${notes.join(" ")}</prior-chat-image-context>`,
        }
      : {}),
  };
}
