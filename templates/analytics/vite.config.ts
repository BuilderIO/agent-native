import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

import { ANALYTICS_NATIVE_MCP_PRESET_EXCLUSIONS } from "./app/lib/native-mcp-exclusions";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];

export default defineConfig({
  plugins: [
    ...reactRouterPlugins(),
    ...agentNativePlugins({
      // shiki only runs in AssistantChat's useEffect — keep it out of the
      // CF Pages Functions bundle (25 MiB limit).
      ssrStubs: ["shiki"],
      // Native data-source actions own these providers in Analytics; showing
      // their MCP presets would create a second, conflicting setup path.
      mcpIntegrations: {
        defaults: { exclude: [...ANALYTICS_NATIVE_MCP_PRESET_EXCLUSIONS] },
      },
    }),
  ],
});
