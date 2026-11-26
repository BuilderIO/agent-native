import { registerReviewableResource } from "@agent-native/core/review";
import { defineNitroPlugin } from "@agent-native/core/server";

import { recordingReviewResource } from "../lib/recording-comment-review.js";

export default defineNitroPlugin(() => {
  registerReviewableResource(recordingReviewResource);
});
