export const COMMENT_ACCESS_TOKEN_HEADER = "x-clips-comment-token";

export function canReadRecordingComments(input: {
  enableComments: boolean;
  viewerIsOwner: boolean;
}): boolean {
  return input.enableComments || input.viewerIsOwner;
}
