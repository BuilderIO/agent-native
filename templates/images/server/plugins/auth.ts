import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Agent-Native Images",
    tagline:
      "Your AI agent creates, refines, and organizes on-brand images alongside you.",
    features: [
      "Build reusable brand image libraries from logos, product shots, and references",
      "Generate heroes, diagrams, slide art, and product visuals from a prompt",
      "Audit prompts, references, outputs, and refinements across every run",
    ],
  },
});
