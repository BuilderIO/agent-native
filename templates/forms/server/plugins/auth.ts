import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  marketing: {
    appName: "Forms",
    screenshotPath: "/auth-marketing/forms.webp",
    screenshotWidth: 914,
    screenshotHeight: 818,
    learnMoreUrl: "https://agent-native.com/apps/forms",
    tagline:
      "Your AI agent builds, publishes, and analyzes forms alongside you.",
    features: [
      "Create complete forms from a single sentence",
      "Instant publishing with shareable links and captcha",
      "Response summaries, exports, and trend analysis on demand",
    ],
  },
  publicPaths: [
    "/f",
    "/api/forms/public",
    "/api/forms/og",
    "/api/upload",
    "/api/submit",
  ],
});
