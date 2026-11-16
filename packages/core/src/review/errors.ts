/**
 * Refusals from the kit's storage. Each carries the shape an action reports as
 * its failure (`isActionContractError`), so a store error reaches the caller
 * with its status and code without the store importing the action runtime.
 */
class ReviewStorageError extends Error {
  readonly actionContractError = true;
  readonly errorCode: string;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    errorCode: string,
    statusCode: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    if (details) this.details = details;
  }
}

/** An anchor its resource's anchor kind refused, or one with no kind to check it. */
export class ReviewAnchorError extends ReviewStorageError {
  constructor(message: string) {
    super(message, "invalid_anchor", 400);
    this.name = "ReviewAnchorError";
  }
}

/** The comment changed after the caller read it; nothing was written. */
export class ReviewCommentRevisionConflictError extends ReviewStorageError {
  readonly currentRevision: number;

  constructor(commentId: string, currentRevision: number) {
    super(
      `Comment ${commentId} changed since it was read; read it again and retry.`,
      "revision_conflict",
      409,
      { commentId, currentRevision },
    );
    this.name = "ReviewCommentRevisionConflictError";
    this.currentRevision = currentRevision;
  }
}

/** An edit that would leave a comment with no text and no image. */
export class ReviewCommentEmptyError extends ReviewStorageError {
  constructor(commentId: string) {
    super("A comment needs text or an image.", "empty_comment", 400, {
      commentId,
    });
    this.name = "ReviewCommentEmptyError";
  }
}

/** An outside ID already linked to another comment. */
export class ReviewCommentLinkConflictError extends ReviewStorageError {
  constructor(provider: string, externalKind: string, externalId: string) {
    super(
      `The ${provider} ${externalKind} ${externalId} is already linked to another comment.`,
      "link_conflict",
      409,
      { provider, externalKind, externalId },
    );
    this.name = "ReviewCommentLinkConflictError";
  }
}

/**
 * A list cursor this kit didn't hand out, one from another list, or one used
 * with another order.
 */
export class ReviewCursorError extends ReviewStorageError {
  constructor(message: string) {
    super(message, "invalid_cursor", 400);
    this.name = "ReviewCursorError";
  }
}
