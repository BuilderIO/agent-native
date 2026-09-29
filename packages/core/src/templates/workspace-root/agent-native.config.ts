import { defineAgentNativeConfig } from "@agent-native/core";

export default defineAgentNativeConfig({
  translations: { locales: ["en-US"] },
  changelog: { enabled: false },
  // Deploys build apps one at a time. To build several at once, sized to the
  // builder's cores and memory, uncomment this or set a number to cap it:
  // deployment: { workspace: { buildConcurrency: "auto" } },
});
