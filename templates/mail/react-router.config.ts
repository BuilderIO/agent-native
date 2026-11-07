import {
  isDesktopClientBuild,
  desktopClientBasePath,
} from "@agent-native/core/vite";
import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  ssr: !isDesktopClientBuild(),
  basename: desktopClientBasePath(),
  routeDiscovery: { mode: "initial" },
} satisfies Config;
