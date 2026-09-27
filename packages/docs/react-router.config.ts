import type { Config } from "@react-router/dev/config";

import { buildPrerenderPaths } from "./app/vite-sitemap-plugin";

export default {
  appDirectory: "app",
  ssr: true,
  routeDiscovery: { mode: "initial" },
  prerender: { paths: () => buildPrerenderPaths(), concurrency: 8 },
} satisfies Config;
