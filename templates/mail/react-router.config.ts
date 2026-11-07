import { isDesktopClientBuild } from "@agent-native/core/vite";
import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  ssr: !isDesktopClientBuild(),
  routeDiscovery: { mode: "initial" },
} satisfies Config;
