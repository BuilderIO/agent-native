import { fail } from "../action.js";
import { getActiveFileUploadProviderForRequest } from "../file-upload/registry.js";

/** As many images as one comment keeps. */
export const MAX_REVIEW_IMAGE_ATTACHMENTS = 5;

interface ReviewAttachmentRecord {
  url: string;
  name: string;
  contentType?: string;
  provider?: string;
}

export async function sanitizeReviewCommentMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (!metadata || !Array.isArray(metadata.attachments)) {
    return metadata ?? null;
  }

  const provider = await getActiveFileUploadProviderForRequest();
  const attachments: ReviewAttachmentRecord[] = [];
  for (const value of metadata.attachments) {
    if (!value || typeof value !== "object") continue;
    const attachment = value as Record<string, unknown>;
    const url = typeof attachment.url === "string" ? attachment.url.trim() : "";
    const contentType =
      typeof attachment.contentType === "string"
        ? attachment.contentType.trim().toLowerCase()
        : undefined;
    const providerId =
      typeof attachment.provider === "string"
        ? attachment.provider.trim()
        : undefined;
    if (
      !url ||
      !isReviewImageAttachmentContentType(contentType) ||
      (providerId && providerId !== provider?.id) ||
      !(await isOwnedReviewAttachmentUrl(url, provider))
    ) {
      continue;
    }
    attachments.push({
      url,
      name:
        typeof attachment.name === "string" && attachment.name.trim()
          ? attachment.name.trim().slice(0, 200)
          : "image",
      ...(contentType ? { contentType } : {}),
      ...(providerId ? { provider: providerId } : {}),
    });
    if (attachments.length >= MAX_REVIEW_IMAGE_ATTACHMENTS) break;
  }

  const next = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => key !== "attachments"),
  );
  if (attachments.length > 0) next.attachments = attachments;
  return next;
}

/**
 * The attachments an edit gives a comment, in the edit's order. Ones the
 * comment already keeps stay as stored, without their checks running again,
 * so a change of upload provider since never drops them. New ones are checked
 * as a new comment's are.
 */
export async function sanitizeReviewCommentAttachmentEdit(
  attachments: readonly unknown[],
  storedMetadata: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown>[]> {
  const stored = attachmentsByUrl(storedMetadata?.attachments);
  const sanitized = await sanitizeReviewCommentMetadata({
    attachments: attachments.filter((value) => {
      const url = attachmentUrl(value);
      return url !== null && !stored.has(url);
    }),
  });
  const checked = attachmentsByUrl(sanitized?.attachments);
  const next: Record<string, unknown>[] = [];
  const taken = new Set<string>();
  for (const value of attachments) {
    const url = attachmentUrl(value);
    const attachment = url ? (stored.get(url) ?? checked.get(url)) : undefined;
    if (!url || !attachment || taken.has(url)) continue;
    taken.add(url);
    next.push(attachment);
    if (next.length >= MAX_REVIEW_IMAGE_ATTACHMENTS) break;
  }
  return next;
}

function attachmentUrl(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const url = (value as Record<string, unknown>).url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

function attachmentsByUrl(
  values: unknown,
): Map<string, Record<string, unknown>> {
  const byUrl = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(values)) return byUrl;
  for (const value of values) {
    const url = attachmentUrl(value);
    if (url && !byUrl.has(url)) {
      byUrl.set(url, value as Record<string, unknown>);
    }
  }
  return byUrl;
}

/**
 * Refuses a comment with nothing in it: no text, and no image left once its
 * attachments were checked. An image is a comment on its own.
 */
export function assertReviewCommentHasContent(
  body: string,
  metadata: Record<string, unknown> | null,
): void {
  const images = metadata?.attachments;
  if (body.trim() || (Array.isArray(images) && images.length > 0)) return;
  fail("A comment needs text or an image.", { errorCode: "empty_comment" });
}

function isReviewImageAttachmentContentType(
  contentType: string | undefined,
): boolean {
  return contentType === undefined || contentType.startsWith("image/");
}

async function isOwnedReviewAttachmentUrl(
  value: string,
  provider: Awaited<ReturnType<typeof getActiveFileUploadProviderForRequest>>,
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(value);
    // coercion-ok: malformed attachment URLs are untrusted and must be dropped.
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.protocol === "https:" && url.hostname === "cdn.builder.io") {
    return true;
  }
  if (!provider?.isOwnedUrl) return false;
  try {
    return Boolean(await provider.isOwnedUrl(value));
    // coercion-ok: provider ownership failures fail closed for persisted media.
  } catch {
    return false;
  }
}
