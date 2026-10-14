import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

export default createToolkitAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  marketing: {
    appName: "Assets",
    learnMoreUrl:
      "https://agent-native.com/apps/assets?utm_source=app&utm_medium=product&utm_content=onboarding-learn-more",
    tagline:
      "Your AI agent creates, refines, and organizes on-brand assets alongside you.",
    features: [
      "Build reusable asset libraries from logos, product shots, videos, and references",
      "Generate heroes, diagrams, slide art, product visuals, and videos from a prompt",
      "Audit prompts, references, outputs, and refinements across every run",
    ],
  },
});
