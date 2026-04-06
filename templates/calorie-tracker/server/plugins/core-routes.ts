import { createCoreRoutesPlugin } from "@agent-native/core/server";

export default createCoreRoutesPlugin({
  envKeys: ["ANTHROPIC_API_KEY"],
});
