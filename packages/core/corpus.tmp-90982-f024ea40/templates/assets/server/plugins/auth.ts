import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Agent-Native Assets",
    tagline:
      "Your AI agent creates, refines, and organizes on-brand assets alongside you.",
    features: [
      "Build reusable asset libraries from logos, product shots, videos, and references",
      "Generate heroes, diagrams, slide art, product visuals, and videos from a prompt",
      "Audit prompts, references, outputs, and refinements across every run",
    ],
  },
});
