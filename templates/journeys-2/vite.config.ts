import { realpathSync } from "node:fs";

import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, searchForWorkspaceRoot } from "vite";
export default defineConfig({
  server: {
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        searchForWorkspaceRoot(
          realpathSync("node_modules/@agent-native/core/dist"),
        ),
      ],
    },
  },
  plugins: [...reactRouter(), ...agentNative({ ssrStubs: ["shiki"] })],
});
