import { setupDispatch } from "@agent-native/dispatch/server";

import { isFirstPartyHostedDispatch } from "../lib/hosted-auth";

export default setupDispatch({
  auth: {
    googleOnly: isFirstPartyHostedDispatch(),
    publicPaths: [
      "/_agent-native/identity/authorize",
      "/_agent-native/org/apps",
    ],
  },
});
