import { ActionContractError } from "@agent-native/core";

import { newlySharedCommentAnchorIds } from "../../shared/comment-block-anchor.js";

/**
 * Refuses a body that saves a video id on more videos than `before` did, as a
 * `<video>` line copied with its id does. A thread on that id would show on
 * none of them. A body that already had the duplicate still saves, and a video
 * added without an id never counts.
 */
export function assertNoNewlySharedVideoIds(
  before: string | null | undefined,
  after: string,
) {
  const [blockId] = newlySharedCommentAnchorIds(before ?? "", after);
  if (!blockId) return;
  throw new ActionContractError(
    `More than one video would have the id "${blockId}". Give each video you add or copy a new unique id (video- and 8 letters or digits), or no id, and retry.`,
    {
      errorCode: "DOCUMENT_VIDEO_ID_SHARED",
      statusCode: 422,
      details: { blockId },
    },
  );
}
