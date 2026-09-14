import { createCoreRoutesPlugin } from "@agent-native/core/server";

export default createCoreRoutesPlugin({
  googleOAuthManagedConnection: "not_applicable",
  envKeys: [{ key: "ANTHROPIC_API_KEY", label: "Anthropic API Key" }],
});
