import { createCoreRoutesPlugin } from "@agent-native/core/server";
import { envKeys } from "../lib/env-config.js";

export default createCoreRoutesPlugin({
  envKeys,
});
