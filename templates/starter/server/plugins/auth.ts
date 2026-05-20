import { createAuthPlugin } from "@agent-native/core/server";

const rawAppTitle = "{{APP_TITLE}}";
const appTitle =
  rawAppTitle === "{" + "{APP_TITLE}}" ? "Blank app" : rawAppTitle;

export default createAuthPlugin({
  marketing: {
    appName: appTitle,
    tagline:
      "Build an agent-native app where the AI agent and UI share state, actions, and context.",
    features: [
      "Define once, use everywhere — actions work as agent tools and API endpoints",
      "The agent always knows what you're looking at and can act on it",
      "Modify your app's own code, routes, and styles through conversation",
    ],
  },
});
