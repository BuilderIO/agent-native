import { defineAgentNativeConfig } from "@agent-native/core/config";

export default defineAgentNativeConfig({
  deployment: {
    workspace: {
      appsDirectory: ".",
      authMode: "shared",
      rootPage: "directory",
    },
  },
});
