import { createSSEHandler } from "@agent-native/core";
import { watcher, sseExtraEmitters } from "../../lib/watcher";
export default createSSEHandler(watcher, {
  extraEmitters: sseExtraEmitters,
  contentRoot: "./data",
});
