import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  ssr: true,
  routeDiscovery: { mode: "initial" },
} satisfies Config;
