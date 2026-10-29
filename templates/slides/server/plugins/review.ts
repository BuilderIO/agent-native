import { defineNitroPlugin } from "@agent-native/core/server";

import { registerSlideReview } from "../lib/slide-review.js";

export default defineNitroPlugin(() => {
  registerSlideReview();
});
