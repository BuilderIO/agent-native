import { defineAgentNativeConfig } from "@agent-native/core";

export default defineAgentNativeConfig({
  translations: { locales: ["en-US"] },
  changelog: { enabled: false },
  // Build workspace apps in parallel on deploy, sized to the builder's cores
  // and memory. Set a number to cap it, or 1 to build one app at a time.
  deployment: { workspace: { buildConcurrency: "auto" } },
});
