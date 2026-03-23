import { createSSEHandler } from "@agent-native/core";
import { getDefaultSSEEmitters } from "@agent-native/core/server";
import { watcher } from "../../lib/watcher.js";

export default createSSEHandler(watcher, {
  extraEmitters: getDefaultSSEEmitters(),
  contentRoot: "./content",
});
