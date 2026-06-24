import { reactRouter } from "@react-router/dev/vite";
import { agentNative } from "@agent-native/core/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    reactRouter(),
    agentNative({
      port: 8100,
      // shiki only runs in AssistantChat's useEffect — keep it out of the
      // CF Pages Functions bundle (25 MiB limit).
      ssrStubs: ["shiki"],
    }),
  ],
});
