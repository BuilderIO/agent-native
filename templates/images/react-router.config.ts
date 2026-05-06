import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  ssr: true,
  future: {
    v8_viteEnvironmentApi: true,
  },
} satisfies Config;
