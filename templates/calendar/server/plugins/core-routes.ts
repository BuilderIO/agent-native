import { createCoreRoutesPlugin } from "@agent-native/core/server";

import { envKeys } from "../lib/env-config.js";

export default createCoreRoutesPlugin({
  googleOAuthManagedConnection: "required",
  sseRoute: "/_agent-native/sse",
  envKeys,
  resolveOpenPath: ({ view }) => {
    if (view === "calendar") return "/home";
    return null;
  },
});
