import type {
  ReviewComment,
  ReviewResourceAccess,
  ReviewResourceContext,
  ReviewStatusEntry,
} from "./types.js";

export function reviewAuthorNameFromContext(
  ctx: ReviewResourceContext | undefined,
): string | null {
  const value = ctx?.userName;
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)) return null;
  return name;
}

export function shouldRedactReviewIdentity(
  ctx: ReviewResourceContext | undefined,
  access: Pick<ReviewResourceAccess, "role" | "visibility">,
): boolean {
  return (
    !ctx?.userEmail ||
    (access.visibility === "public" && access.role === "viewer")
  );
}

export function redactPublicReviewCommentIdentity(
  comment: ReviewComment,
): ReviewComment {
  return {
    ...comment,
    authorEmail: null,
    authorName: safeReviewDisplayName(comment.authorName),
    mentions: comment.mentions.map((mention) => ({
      label: safeReviewDisplayName(mention.label) ?? "Mentioned user",
    })),
    ownerEmail: null,
    orgId: null,
    resolvedBy: null,
    deletedBy: null,
    metadata: redactPublicReviewMetadata(comment.metadata),
  };
}

export function redactPublicReviewStatusIdentity(
  status: ReviewStatusEntry | null,
): ReviewStatusEntry | null {
  return status
    ? {
        ...status,
        updatedBy: null,
        ownerEmail: null,
        orgId: null,
        metadata: redactPublicReviewMetadata(status.metadata),
      }
    : null;
}

function safeReviewDisplayName(
  value: string | null | undefined,
): string | null {
  const name = value?.trim();
  if (!name || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)) {
    return null;
  }
  return name;
}

function redactPublicReviewMetadata(
  metadata: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!metadata) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(metadata).flatMap(([key, value]) =>
      /^(authorEmail|ownerEmail|orgId|updatedBy|resolvedBy|deletedBy|email|userEmail|userId)$/i.test(
        key,
      )
        ? []
        : [[key, redactPublicReviewMetadataValue(value)]],
    ),
  );
}

function redactPublicReviewMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactPublicReviewMetadataValue);
  }
  if (typeof value === "object" && value !== null) {
    return redactPublicReviewMetadata(value as Record<string, unknown>);
  }
  if (
    typeof value === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  ) {
    return null;
  }
  return value;
}
