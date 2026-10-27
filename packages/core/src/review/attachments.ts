import { getActiveFileUploadProviderForRequest } from "../file-upload/registry.js";

const MAX_REVIEW_IMAGE_ATTACHMENTS = 5;

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
