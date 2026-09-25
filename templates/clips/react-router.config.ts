import type { Config } from "@react-router/dev/config";

import { PRERENDERED_PUBLIC_PAGE_PATHS } from "./shared/prerendered-public-paths";

export default {
  appDirectory: "app",
  ssr: true,
  routeDiscovery: { mode: "initial" },
  // Static HTML for the build-time-constant public pages, so a CDN cache miss
  // serves a file instead of cold-starting the SSR function. Read
  // `shared/prerendered-public-paths.ts` before adding a path — everything else
  // keeps rendering through the function.
  prerender: { paths: () => [...PRERENDERED_PUBLIC_PAGE_PATHS] },
} satisfies Config;
