import { defineAgentNativeConfig } from "@agent-native/core";

export default defineAgentNativeConfig({
  // English is the source locale. Add supported locale codes here when this
  // workspace is intentionally translated.
  translations: { locales: ["en-US"] },
  changelog: { enabled: false },
  // Build workspace apps in parallel on deploy, sized to the builder's cores
  // and memory. Set a number to cap it, or 1 to build one app at a time.
  deployment: { workspace: { buildConcurrency: "auto" } },
});
