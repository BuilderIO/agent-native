import { registerReviewableResource } from "@agent-native/core/review";
import { defineNitroPlugin } from "@agent-native/core/server";

export default defineNitroPlugin(() => {
  registerReviewableResource({
    type: "design",
    displayName: "Design",
  });
});
