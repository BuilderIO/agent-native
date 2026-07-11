import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import { sitemapPlugin } from "./app/vite-sitemap-plugin";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];

export default defineConfig({
  plugins: [
    tailwindcss(),
    ...reactRouterPlugins(),
    sitemapPlugin(),
    ...agentNativePlugins({
      tailwind: false,
      // Warm route data and matched JS on hover/focus/touch, while links marked
      // with data-an-prefetch="render" continue warming immediately.
      routeWarmup: { strategy: "intent", data: true, modules: true },
    }),
  ],
});
