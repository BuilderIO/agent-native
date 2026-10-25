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
  /** A signed-in editor of the page: their Clips storage, and uploads. */
  upload: "content-clip:upload",
} as const;

export type ContentClipScope =
  (typeof CONTENT_CLIP_SCOPES)[keyof typeof CONTENT_CLIP_SCOPES];

/** The token subject for a signed-out reader; Clips never treats it as a user. */
export const CONTENT_CLIP_PUBLIC_READER = "content-public-doc-reader";

export const CONTENT_CLIP_CLAIMS = {
  documentId: "document_id",
  recordingId: "recording_id",
  viewerName: "name",
  /** Optional, on an upload token: the uploader's IP address. */
  clientIp: "client_ip",
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

/** Clips cuts the playback answer's recording title to this many characters. */
export const CONTENT_CLIP_RECORDING_TITLE_CHARS = 500;

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

/** The video types an upload to Clips may be. */
export const CONTENT_CLIP_UPLOAD_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

export type ContentClipUploadMimeType =
  (typeof CONTENT_CLIP_UPLOAD_MIME_TYPES)[number];

export function isContentClipUploadMimeType(
  value: unknown,
): value is ContentClipUploadMimeType {
  return (CONTENT_CLIP_UPLOAD_MIME_TYPES as readonly unknown[]).includes(value);
}

/** The longest file name Clips takes with an upload; Content cuts to it. */
export const CONTENT_CLIP_UPLOAD_FILE_NAME_CHARS = 255;

/**
 * Where an editor's uploads would go, as Clips says. Content shows it as it
 * is and never works out a count of its own.
 */
export type ContentClipStorage =
  | { state: "ready"; provider: "builder" | "custom" | "local" }
  | { state: "free"; remaining: number; limit: number; maxClipBytes: number }
  | { state: "used_up"; limit: number }
  | { state: "none"; reason: string }
  | { state: "account_required" };

/** The `code` of an upload start Clips refused. */
export const CONTENT_CLIP_UPLOAD_REFUSED = {
  storageRequired: "storage_required",
  tooLarge: "upload_too_large",
  tooMany: "too_many_uploads",
  /**
   * A start repeated for one picked file whose upload Clips already has
   * whole, with `recordingId`.
   */
  alreadyFinished: "upload_already_finished",
  /**
   * A start repeated for one picked file while the first start is still
   * making its Clip. Repeat it in a few seconds; Clips answers
   * `upload_key_used` once that start has gone about ten minutes without one.
   */
  uploadStarting: "upload_starting",
  /** A start repeated for one picked file whose upload can't continue. */
  keyUsed: "upload_key_used",
} as const;

/**
 * The `uploadKey` Content makes once per picked file and sends with every
 * start of it: Clips answers a repeat with that upload, never a second Clip.
 */
export const CONTENT_CLIP_UPLOAD_KEY = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Why Content could not read an editor's Clips storage or start an upload.
 * Each is its own `errorCode`, so the Upload tab can say which; none of them
 * is a storage state.
 */
export const CLIP_UPLOAD_ERRORS = {
  disabled: CLIP_PLAYBACK_ERRORS.disabled,
  documentNotFound: CLIP_PLAYBACK_ERRORS.documentNotFound,
  /** The caller can read the page but not edit it. */
  editRequired: "document_edit_required",
  notConfigured: CLIP_PLAYBACK_ERRORS.notConfigured,
  unauthorized: CLIP_PLAYBACK_ERRORS.unauthorized,
  /** Too many uploads in progress, or too many requests. */
  rateLimited: CLIP_PLAYBACK_ERRORS.rateLimited,
  unreachable: CLIP_PLAYBACK_ERRORS.unreachable,
  /** Clips answered, but with a refusal or an answer Content can't read. */
  failed: "clip_upload_failed",
} as const;

export type ClipUploadErrorCode =
  (typeof CLIP_UPLOAD_ERRORS)[keyof typeof CLIP_UPLOAD_ERRORS];

const UPLOAD_ERROR_CODES: ReadonlySet<string> = new Set(
  Object.values(CLIP_UPLOAD_ERRORS),
);

export function isClipUploadErrorCode(
  value: unknown,
): value is ClipUploadErrorCode {
  return typeof value === "string" && UPLOAD_ERROR_CODES.has(value);
}

/** The ticketed upload Clips started, for the browser to post chunks to. */
export interface ClipUploadTicket {
  recordingId: string;
  /** On the Clips app; carries the ticket, so it is the only authority. */
  chunkUrl: string;
  /**
   * On the Clips app, with the same ticket: gives the upload up, so Clips
   * releases its free clip now rather than when its cleanup finds it.
   */
  cancelUrl: string;
  chunkSizeBytes: number;
  totalChunks: number;
  expiresAt: string;
}

export type CreateClipUploadResult =
  | ({ status: "started" } & ClipUploadTicket)
  /** An earlier start of the same file made this Clip, and Clips has it all. */
  | { status: "already_finished"; recordingId: string }
  /** An earlier start of the same file is still making its Clip. */
  | { status: "starting" }
  | { status: "storage_required"; storage: ContentClipStorage }
  | { status: "too_large"; maxBytes: number };

/**
 * The `outcome` a ticket's `cancelUrl` answers with: `cancelled` (200), the
 * upload failed in Clips and its free clip released; `already_finished`
 * (409), Clips had the whole file first and kept the Clip, with `status`
 * `processing` or `ready`. Any other answer is a refusal with only `error`.
 */
export const CLIP_CANCEL_OUTCOME = {
  cancelled: "cancelled",
  alreadyFinished: "already_finished",
} as const;

/** What giving an upload up did, as this tab knows it. */
export type ClipCancelResult =
  | { outcome: typeof CLIP_CANCEL_OUTCOME.cancelled }
  | {
      outcome: typeof CLIP_CANCEL_OUTCOME.alreadyFinished;
      status: "processing" | "ready";
    }
  /** Clips refused, or didn't answer: its cleanup fails the upload later. */
  | { outcome: "not_cancelled" };
