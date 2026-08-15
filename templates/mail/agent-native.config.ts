import { defineAgentNativeConfig } from "@agent-native/core/config";

export default defineAgentNativeConfig({
  harness: {
    enabled: true,
    runtimes: ["claude-code", "codex", "pi", "opencode"],
    ui: "desktop",
  },
});
