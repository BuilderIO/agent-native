import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

import { MAIL_NATIVE_MCP_PRESET_EXCLUSIONS } from "./app/lib/native-mcp-exclusions";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];

export default defineConfig({
  plugins: [
    ...reactRouterPlugins(),
    ...agentNativePlugins({
      ssrStubs: ["shiki"],
      mcpIntegrations: {
        defaults: { exclude: [...MAIL_NATIVE_MCP_PRESET_EXCLUSIONS] },
      },
    }),
  ],
});
