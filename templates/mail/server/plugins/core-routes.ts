import { createCoreRoutesPlugin } from "@agent-native/core/server";
import { resolveMailOpenPath } from "@shared/mail-routes.js";

import { envKeys } from "../lib/env-config.js";

export default createCoreRoutesPlugin({
  googleOAuthManagedConnection: "required",
  envKeys,
  resolveOpenPath: resolveMailOpenPath,
});
