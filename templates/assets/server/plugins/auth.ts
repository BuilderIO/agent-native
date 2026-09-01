import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  marketing: {
    appName: "Assets",
    screenshotPath: "/auth-marketing/assets.webp",
    screenshotWidth: 914,
    screenshotHeight: 818,
    learnMoreUrl: "https://agent-native.com/apps/assets",
    tagline:
      "Your AI agent creates, refines, and organizes on-brand assets alongside you.",
    features: [
      "Build reusable asset libraries from logos, product shots, videos, and references",
      "Generate heroes, diagrams, slide art, product visuals, and videos from a prompt",
      "Audit prompts, references, outputs, and refinements across every run",
    ],
  },
});
