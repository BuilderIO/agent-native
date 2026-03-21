import { createSSEHandler } from "@agent-native/core";
import { watcher, sseExtraEmitters } from "../../lib/watcher.js";

export default createSSEHandler(watcher, {
  extraEmitters: sseExtraEmitters,
  contentRoot: "./content",
});
