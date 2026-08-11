import { setupDispatch } from "@agent-native/dispatch/server";

export default setupDispatch({
  auth: {
    publicPaths: [
      "/_agent-native/identity/availability",
      "/_agent-native/identity/authorize",
      "/_agent-native/identity/token",
      "/_agent-native/org/apps",
    ],
  },
});
