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

/** The `code` of a 403 media response refused only because its grant expired. */
export const CONTENT_CLIP_GRANT_EXPIRED = "content_grant_expired";

/**
 * The `code` of the 503 every route answers with while Clips has no usable
 * `CONTENT_CLIPS_PEER_SECRET`: unset, too short, or the same as `A2A_SECRET`.
 */
export const CONTENT_CLIP_NOT_CONFIGURED = "content_clips_not_configured";
