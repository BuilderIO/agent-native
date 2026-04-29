import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "@agent-native/core/vite";

const baseConfig = defineConfig({
  plugins: [reactRouter()],
  // shiki only runs in AssistantChat's useEffect — keep it out of the
  // CF Pages Functions bundle (25 MiB limit).
  ssrStubs: ["shiki"],
});

export default {
  ...baseConfig,
  server: {
    ...baseConfig.server,
    allowedHosts: [
      ".ngrok-free.dev",
      ".ngrok-free.app",
      ".ngrok.io",
      "archer-ophitic-unhortatively.ngrok-free.dev",
      "enjoyed-mutt-plainly.ngrok-free.app",
    ],
  },
};
