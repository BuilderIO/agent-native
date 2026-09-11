import type { Config } from "@react-router/dev/config";

import { buildPrerenderPaths } from "./app/vite-sitemap-plugin";

export default {
  appDirectory: "app",
  ssr: true,
  routeDiscovery: { mode: "initial" },
  // Every path here renders from build-time content only, so a CDN cache miss
  // serves a static file instead of cold-starting the SSR function (~5s TTFB).
  // Paths outside this list still SSR at request time.
  prerender: { paths: () => buildPrerenderPaths(), concurrency: 8 },
} satisfies Config;
