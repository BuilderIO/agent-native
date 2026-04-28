import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Forms",
    tagline:
      "Your AI agent builds, publishes, and analyzes forms alongside you.",
    features: [
      "Create complete forms from a single sentence",
      "Instant publishing with shareable links and captcha",
      "Response summaries, exports, and trend analysis on demand",
    ],
  },
  publicPaths: ["/f", "/api/forms/public", "/api/submit"],
});
