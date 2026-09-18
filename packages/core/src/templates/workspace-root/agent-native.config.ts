import { defineAgentNativeConfig } from "@agent-native/core";

export default defineAgentNativeConfig({
  // English is the source locale. Add supported locale codes here when this
  // workspace is intentionally translated.
  translations: { locales: ["en-US"] },
  changelog: { enabled: false },
});
