import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  ssr: true,
  routeDiscovery: { mode: "initial" },
  future: {
    v8_viteEnvironmentApi: true,
  },
} satisfies Config;
