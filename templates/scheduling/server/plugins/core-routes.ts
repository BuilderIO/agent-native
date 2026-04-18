import { createCoreRoutesPlugin } from "@agent-native/core/server";

export default createCoreRoutesPlugin({
  sseRoute: "/_agent-native/sse",
});
