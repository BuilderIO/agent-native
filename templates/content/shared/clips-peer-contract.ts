// Content's copy of the contract Clips publishes in
// `templates/clips/shared/content-clip-contract.ts`. Content never imports
// from Clips, so these strings must match that file by hand.

/** Appended to the Clips app URL to form the token's `aud`. */
export const CONTENT_CLIP_AUDIENCE_PATH = "content-clips";

export const CONTENT_CLIP_SCOPES = {
  /** A signed-in page reader: playback and the comment list. */
  read: "content-clip:read",
  /** A signed-in page reader: adding and changing comments. */
  comment: "content-clip:comment",
  /** A signed-out reader of a public page: playback and the comment list. */
  publicRead: "content-clip:public-read",
} as const;

export type ContentClipScope =
  (typeof CONTENT_CLIP_SCOPES)[keyof typeof CONTENT_CLIP_SCOPES];

/** The token subject for a signed-out reader; Clips never treats it as a user. */
export const CONTENT_CLIP_PUBLIC_READER = "content-public-doc-reader";

export const CONTENT_CLIP_CLAIMS = {
  documentId: "document_id",
  recordingId: "recording_id",
  viewerName: "name",
} as const;

/** The most comment threads one comment-list call returns. */
export const CONTENT_CLIP_MAX_COMMENT_THREADS = 500;

/**
 * Clips cuts a listed thread start's text to this many characters, and its
 * author's name and email to `CONTENT_CLIP_COMMENT_AUTHOR_CHARS`, so the
 * longest comment list has a known size.
 */
export const CONTENT_CLIP_COMMENT_PREVIEW_CHARS = 280;
export const CONTENT_CLIP_COMMENT_AUTHOR_CHARS = 320;

/** The `code` of a 403 media response refused only because its grant expired. */
export const CONTENT_CLIP_GRANT_EXPIRED = "content_grant_expired";

/** The `code` Clips answers with while it has no usable peer secret. */
export const CONTENT_CLIP_NOT_CONFIGURED = "content_clips_not_configured";

/**
 * Why Content could not play a Clip or list its comments. Each is its own
 * `errorCode` on the action's failure, so the player can say which.
 */
export const CLIP_PLAYBACK_ERRORS = {
  /** The Clip block's flag is off for this reader. */
  disabled: "clip_embed_disabled",
  /** The page doesn't exist or the reader can't read it. */
  documentNotFound: "document_not_found",
  /** This Content or Clips deployment has no usable peer secret. */
  notConfigured: "clips_not_configured",
  /** The Clip doesn't exist, is in Trash, or the reader has no access. */
  notFound: "clip_not_found",
  expired: "clip_expired",
  passwordRequired: "clip_password_required",
  redactionPending: "clip_redaction_pending",
  commentsDisabled: "clip_comments_disabled",
  forbidden: "clip_forbidden",
  /** Clips refused Content's token. */
  unauthorized: "clip_token_refused",
  rateLimited: "clip_rate_limited",
  /** Clips didn't answer, or answered with something Content can't read. */
  unreachable: "clips_unreachable",
} as const;

export type ClipPlaybackErrorCode =
  (typeof CLIP_PLAYBACK_ERRORS)[keyof typeof CLIP_PLAYBACK_ERRORS];

const PLAYBACK_ERROR_CODES: ReadonlySet<string> = new Set(
  Object.values(CLIP_PLAYBACK_ERRORS),
);

export function isClipPlaybackErrorCode(
  value: unknown,
): value is ClipPlaybackErrorCode {
  return typeof value === "string" && PLAYBACK_ERROR_CODES.has(value);
}

export interface ClipPlayback {
  recording: {
    id: string;
    title: string | null;
    kind: string | null;
    status: string | null;
    durationMs: number | null;
    width: number | null;
    height: number | null;
    enableComments: boolean;
    embedProvider: string | null;
  };
  playback: {
    videoUrl: string | null;
    posterUrl: string | null;
    expiresAt: string;
  };
  viewer: {
    isOwner: boolean;
    canComment: boolean;
  };
}

export interface ClipCommentMarker {
  id: string;
  videoTimestampMs: number;
  content: string;
  authorName: string | null;
}
