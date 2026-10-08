import type { Config } from "@react-router/dev/config";

import { PRERENDERED_PUBLIC_PAGE_PATHS } from "./shared/prerendered-public-paths";

export default {
  appDirectory: "app",
  ssr: true,
  routeDiscovery: { mode: "initial" },
  prerender: { paths: () => [...PRERENDERED_PUBLIC_PAGE_PATHS] },
} satisfies Config;
