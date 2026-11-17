import { registerReviewableResource } from "@agent-native/core/review";
import { defineNitroPlugin } from "@agent-native/core/server";

import { slideCommentAnchorSchema } from "../../shared/slide-comment-anchor.js";
import {
  DECK_REVIEW_RESOURCE,
  SLIDE_POINT_ANCHOR,
} from "../lib/slide-comment-mirror.js";

export default defineNitroPlugin(() => {
  registerReviewableResource({
    type: DECK_REVIEW_RESOURCE,
    displayName: "Deck",
    anchorKinds: {
      [SLIDE_POINT_ANCHOR]: {
        version: 1,
        parse: (anchor) => slideCommentAnchorSchema.parse(anchor),
      },
    },
    // Until Slides reads its comments from the kit, its own comment actions
    // write them, mirroring each into the kit. A write through the kit's
    // actions wouldn't show in Slides, so they're refused.
    commentsWrittenByApp:
      "Slide comments are written with add-slide-comment, update-slide-comment, delete-slide-comment and toggle-slide-comment-reaction.",
  });
});
