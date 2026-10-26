// The contract Agent-Native Content uses to call Clips server to server about
// a Clip in one of its documents. Content keeps its own copy of these strings.
//
// Content signs each request with the secret only Content and Clips hold,
// `CONTENT_CLIPS_PEER_SECRET`, read on both sides with
// `resolveContentClipsPeerSecret(getAppConfig().clips, getGlobalA2ASecret())`
// (null: not set up, so Content makes no call; a throw: misconfigured). Clips
// verifies with that secret alone, so neither the deployment `A2A_SECRET` nor a
// workspace secret can mint a token these routes accept:
//
//   signA2AToken(subject, undefined, peerSecret, {
//     expiresIn: "1m",
//     audience: `${canonicalA2AAudience(clipsAppUrl)}/${CONTENT_CLIP_AUDIENCE_PATH}`,
//     extraClaims: { scope, document_id, recording_id, name? },
//   })
//
// An `upload` token names no recording: Clips makes the recording when the
// upload starts. It may carry `client_ip`, the uploader's address as Content's
// edge saw it, which Clips' free storage counts per network.
//
// No org domain and no `preferGlobalSecret`: either would let core sign with
// another secret. That gives an HS256 token whose `iss` is Content's app URL,
// which must equal the `content_app` Clips stored for the document's Clip. The
// subject is the reader's email for `read` and `comment`, and
// `CONTENT_CLIP_PUBLIC_READER` for `publicRead`.

/** Appended to the Clips app URL to form the token's `aud`. */
export const CONTENT_CLIP_AUDIENCE_PATH = "content-clips";

export const CONTENT_CLIP_SCOPES = {
  /** A signed-in document reader: playback and the comment list. */
  read: "content-clip:read",
  /** A signed-in document reader: adding and changing comments. */
  comment: "content-clip:comment",
  /** A signed-out reader of a public document: playback and the comment list. */
  publicRead: "content-clip:public-read",
  /**
   * A signed-in editor of the document: reading their Clips storage, and
   * starting an upload that becomes a Clip bound to the document.
   */
  upload: "content-clip:upload",
} as const;

export type ContentClipScope =
  (typeof CONTENT_CLIP_SCOPES)[keyof typeof CONTENT_CLIP_SCOPES];

/** The token subject for a signed-out reader; it is never treated as a user. */
export const CONTENT_CLIP_PUBLIC_READER = "content-public-doc-reader";

export const CONTENT_CLIP_CLAIMS = {
  documentId: "document_id",
  recordingId: "recording_id",
  /** Optional display name of a signed-in reader, used on their comments. */
  viewerName: "name",
  /** Optional, on an upload token: the uploader's IP address. */
  clientIp: "client_ip",
} as const;

/** Longest token lifetime the routes accept; Content mints one-minute tokens. */
export const CONTENT_CLIP_MAX_TOKEN_SECONDS = 5 * 60;

/**
 * How long the media URLs from playback keep working, so a reader who loses
 * access to the document stops playing within minutes. When they run out
 * (`playback.expiresAt`, or a media request refused with
 * `CONTENT_CLIP_GRANT_EXPIRED`), Content's player asks Content for playback
 * again, and Content re-checks the reader's document access before it mints
 * the token that gets fresh URLs.
 *
 * A Clip that plays in YouTube's player (`recording.embedProvider` is
 * `"youtube"`) is the exception: its `videoUrl` is YouTube's own embed URL
 * with no grant. Clips checks access only when it answers playback; YouTube
 * then serves the video under that video's YouTube settings.
 */
export const CONTENT_CLIP_PLAYBACK_GRANT_SECONDS = 5 * 60;

/**
 * The most comment threads one comment-list call returns. Content asks with
 * `?limit=<n>`, n from 1 to this, and gets the first n thread starts by video
 * time, with `truncated: true` when there are more. Replies never come back.
 */
export const CONTENT_CLIP_MAX_COMMENT_THREADS = 500;

/**
 * A listed thread start's text is cut to this many characters, and its
 * author's name and email to `CONTENT_CLIP_COMMENT_AUTHOR_CHARS`, so Content
 * can cap how much of a comment list it reads. A marker shows no more.
 */
export const CONTENT_CLIP_COMMENT_PREVIEW_CHARS = 280;
export const CONTENT_CLIP_COMMENT_AUTHOR_CHARS = 320;

/** The playback answer's recording title is cut to this many characters. */
export const CONTENT_CLIP_RECORDING_TITLE_CHARS = 500;

/** The `code` of a 403 media response refused only because its grant expired. */
export const CONTENT_CLIP_GRANT_EXPIRED = "content_grant_expired";

/**
 * The `code` of the 503 every route answers with while Clips has no usable
 * `CONTENT_CLIPS_PEER_SECRET`: unset, too short, or the same as `A2A_SECRET`.
 */
export const CONTENT_CLIP_NOT_CONFIGURED = "content_clips_not_configured";

/**
 * The video types an upload from a document may be. Content sends the chunks
 * with no `Content-Type`, so the browser makes no CORS preflight; the type
 * travels in the chunk URL Clips returns. A cancel goes to the cancel URL the
 * same way, with no body.
 */
export const CONTENT_CLIP_UPLOAD_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

export type ContentClipUploadMimeType =
  (typeof CONTENT_CLIP_UPLOAD_MIME_TYPES)[number];

/** The longest file name an upload start takes; Clips titles the Clip with it. */
export const CONTENT_CLIP_UPLOAD_FILE_NAME_CHARS = 255;

/**
 * Where an editor's uploads would go, from `GET /api/content-clips/upload-status`
 * and with every refused upload start. Content shows it as it is.
 *
 * - `ready`: the editor's workspace has its own storage (`builder` or
 *   `custom`), or a local development Clips keeps chunks in SQL (`local`).
 * - `free`: Clips' free hosted storage takes `remaining` more of `limit`.
 * - `used_up`: the free clips are used up; connecting storage continues.
 * - `none`: no storage and no free clips. `reason` is the free storage's
 *   refusal: `disabled` when this Clips offers none, or why this editor
 *   can't have it now.
 * - `account_required`: the email has no Clips account with a workspace yet.
 */
export type ContentClipStorage =
  | { state: "ready"; provider: "builder" | "custom" | "local" }
  | { state: "free"; remaining: number; limit: number; maxClipBytes: number }
  | { state: "used_up"; limit: number }
  | { state: "none"; reason: string }
  | { state: "account_required" };

/**
 * What `POST /api/uploads/:recordingId/content-cancel` did, as `outcome`.
 *
 * - `cancelled` (200): the upload is failed in Clips. Its free clip is
 *   released once Clips confirms the upload's cleanup.
 * - `already_finished` (409): Clips has the whole file and is making the
 *   Clip, or made it; `status` says which. Nothing changed.
 * - `upload_finishing` (409): Clips is taking the final chunk and doesn't
 *   know yet whether it will make the Clip. Nothing changed; cancel again
 *   after a few seconds, and the answer is `cancelled` or
 *   `already_finished`.
 *
 * Any other answer is a refusal with only `error`: the upload wasn't
 * cancelled, and Clips fails it once its lease runs out.
 */
export const CONTENT_CLIP_CANCEL_OUTCOME = {
  cancelled: "cancelled",
  alreadyFinished: "already_finished",
  finishing: "upload_finishing",
} as const;

export type ContentClipCancelAnswer =
  | {
      outcome: typeof CONTENT_CLIP_CANCEL_OUTCOME.cancelled;
      recordingId: string;
    }
  | {
      outcome: typeof CONTENT_CLIP_CANCEL_OUTCOME.alreadyFinished;
      recordingId: string;
      status: "processing" | "ready";
    }
  | {
      outcome: typeof CONTENT_CLIP_CANCEL_OUTCOME.finishing;
      recordingId: string;
    };

/**
 * The `outcome` a final chunk posted to the chunk URL answers, 409, while
 * Clips is still taking an earlier send of it: nothing changed, and the same
 * chunk can go again in a few seconds, until the earlier send's claim ends
 * (`FINAL_CHUNK_CLAIM_TTL_MS`, two minutes). A final chunk sent again once
 * Clips took the first answers with that one's success.
 */
export const CONTENT_CLIP_CHUNK_FINISHING =
  CONTENT_CLIP_CANCEL_OUTCOME.finishing;

/** The `code` of an upload start Clips refused, with `storage` in the body. */
export const CONTENT_CLIP_UPLOAD_REFUSED = {
  /** No storage takes the file: see `storage`. */
  storageRequired: "storage_required",
  /** The file is larger than the storage takes; `maxBytes` says how large. */
  tooLarge: "upload_too_large",
  /** The editor has too many uploads in progress. */
  tooMany: "too_many_uploads",
  /**
   * A start repeated with an `uploadKey` whose upload already has the whole
   * file: `recordingId` names the Clip and `status` is `processing` or
   * `ready`. Nothing was made.
   */
  alreadyFinished: "upload_already_finished",
  /**
   * A start repeated with an `uploadKey` while the first start is still
   * making its recording. Repeat it again in a few seconds. Once a start
   * failed without saying it left nothing, or has gone about ten minutes
   * without its recording, the next repeat takes it over and starts it
   * again with the same recording id.
   */
  uploadStarting: "upload_starting",
  /**
   * A start repeated with an `uploadKey` that can't continue: its upload
   * was cancelled or failed, is parked until storage is connected, began in
   * another block, or was for a file of another type or size.
   */
  keyUsed: "upload_key_used",
} as const;
