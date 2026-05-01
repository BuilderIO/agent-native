import type { Config } from "@react-router/dev/config";

function appBasename() {
  const raw =
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "/";
  if (!raw || raw === "/") return "/";
  return `/${raw.replace(/^\/+|\/+$/g, "")}/`;
}
export default {
  appDirectory: "app",
  basename: appBasename(),
  ssr: true,
  future: {
    v8_viteEnvironmentApi: true,
  },
} satisfies Config;
