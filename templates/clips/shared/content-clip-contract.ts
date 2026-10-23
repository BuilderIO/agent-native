// The contract Agent-Native Content uses to call Clips server to server about
// a Clip in one of its documents. Content mints an A2A token with
// `signA2AToken` from the deployment `A2A_SECRET`, bound to this audience path
// on the Clips app URL, and carrying one scope plus the document and recording
// it vouches for. Content keeps its own copy of these strings.

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
