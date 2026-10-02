import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  future: { unstable_optimizeDeps: true },
  ssr: true,
  routeDiscovery: { mode: "initial" },
} satisfies Config;
