import { createCoreRoutesPlugin } from "@agent-native/core/server";
import { envKeys } from "../lib/env-config.js";
import { resolvePublicViewerOwner } from "../lib/public-documents.js";

export default createCoreRoutesPlugin({
  envKeys,
  anonymousOwner: resolvePublicViewerOwner,
});
