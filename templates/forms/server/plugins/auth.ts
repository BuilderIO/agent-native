import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

export default createToolkitAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  marketing: {
    appName: "Forms",
    learnMoreUrl:
      "https://agent-native.com/apps/forms?utm_source=app&utm_medium=product&utm_content=onboarding-learn-more",
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
