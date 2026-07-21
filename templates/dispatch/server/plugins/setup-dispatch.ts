import { setupDispatch } from "@agent-native/dispatch/server";

export default setupDispatch({
  auth: {
    publicPaths: [
      "/_agent-native/identity/authorize",
      "/_agent-native/org/apps",
    ],
  },
});
