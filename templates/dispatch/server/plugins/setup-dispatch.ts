import { setupDispatch } from "@agent-native/dispatch/server";

export default setupDispatch({
  auth: {
    marketing: {
      screenshotPath: "/auth-marketing/dispatch.webp",
      screenshotWidth: 914,
      screenshotHeight: 818,
      learnMoreUrl: "https://agent-native.com/apps/dispatch",
    },
    publicPaths: [
      "/_agent-native/identity/availability",
      "/_agent-native/identity/authorize",
      "/_agent-native/identity/token",
      "/_agent-native/identity/organization",
      "/_agent-native/org/apps",
    ],
  },
});
