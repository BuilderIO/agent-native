import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Agent-Native Code",
    tagline:
      "A customizable local Agent-Native Code UI for long-running coding sessions, slash commands, and migration goals.",
    features: [
      "Start and resume local coding sessions",
      "Use the same transcript store as the CLI and Desktop",
      "Customize the UI while reusing the agent-native run harness",
    ],
  },
});
