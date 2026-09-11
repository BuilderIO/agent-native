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
      // shiki only runs in AssistantChat's useEffect — keep it out of the
      // CF Pages Functions bundle (25 MiB limit).
      ssrStubs: ["shiki"],
      // Mail's native Gmail actions own this workflow; don't offer a second,
      // restricted Google Workspace MCP setup from inside the chat.
      mcpIntegrations: {
        defaults: { exclude: [...MAIL_NATIVE_MCP_PRESET_EXCLUSIONS] },
      },
    }),
  ],
});
