import { setupDispatch } from "@agent-native/dispatch/server";

export default setupDispatch({
  auth: {
    marketing: {
      learnMoreUrl: "https://agent-native.com/apps/dispatch",
    },
    publicPaths: [
      "/_agent-native/identity/availability",
      "/_agent-native/identity/bootstrap",
      "/_agent-native/identity/bootstrap/continue",
      "/_agent-native/identity/bootstrap/activate",
      "/_agent-native/identity/authorize",
      "/_agent-native/identity/token",
      "/_agent-native/identity/organization",
      "/_agent-native/org/apps",
    ],
  },
});
