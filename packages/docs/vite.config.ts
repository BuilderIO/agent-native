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
      // Syntax highlighting is hydrated after the document loads. Keeping
      // Shiki out of the SSR graph avoids loading its language catalog on a
      // cold docs Function just to render the initial Markdown shell.
      ssrStubs: ["shiki"],
      // Warm routes as they enter the real viewport. Render-warming the whole
      // docs graph stampedes uncached SSR/function calls after every mount.
      routeWarmup: {
        strategy: "viewport",
        data: true,
        modules: true,
        maxConcurrent: 8,
      },
    }),
  ],
});
