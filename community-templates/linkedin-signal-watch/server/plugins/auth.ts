import { createAuthPlugin } from "@agent-native/core/server";

const appTitle = "LinkedIn Signal Watch";

export default createAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  marketing: {
    appName: appTitle,
    tagline: "Keep account priority aligned with the signals that matter now.",
    features: [
      "Review account context in one focused queue",
      "Use the agent to explain and update priorities",
      "Keep durable chat beside the workflow",
    ],
  },
});
