import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.shared";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [
      ...reactRouterPlugins(),
      ...agentNativePlugins({
        // shiki only runs in AssistantChat's useEffect — keep it out of the
        // CF Pages Functions bundle (25 MiB limit).
        ssrStubs: ["shiki"],
      }),
    ],
  }),
);
