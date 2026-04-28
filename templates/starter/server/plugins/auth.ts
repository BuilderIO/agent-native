import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Starter",
    tagline:
      "Build apps where the AI agent and UI are equal partners — sharing state, actions, and context in real time.",
    features: [
      "Define once, use everywhere — actions work as agent tools and API endpoints",
      "The agent always knows what you're looking at and can act on it",
      "Modify your app's own code, routes, and styles through conversation",
    ],
  },
});
