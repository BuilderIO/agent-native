import { defineAgentNativeConfig } from "@agent-native/core";

export default defineAgentNativeConfig({
  instructions: { runtime: "instructions/workspace.md" },
  translations: { locales: ["en-US"] },
  changelog: { enabled: false },
});
