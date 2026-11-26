import type { Config } from "@react-router/dev/config";

import { PRERENDERED_PUBLIC_PAGE_PATHS } from "./shared/prerendered-public-paths";

// A workspace build mounts this app under a base path (APP_BASE_PATH, e.g.
// "/clips"). Prerender then requests the bare path (e.g. "/download"), which
// never matches the mounted routes and 404s the build, so skip prerender in a
// workspace — these pages are public and SSR serves them fine. A standalone
// build keeps prerendering.
const workspaceBasePath = process.env.APP_BASE_PATH?.trim();

export default {
  appDirectory: "app",
  ssr: true,
  routeDiscovery: { mode: "initial" },
  ...(workspaceBasePath
    ? {}
    : { prerender: { paths: () => [...PRERENDERED_PUBLIC_PAGE_PATHS] } }),
} satisfies Config;
