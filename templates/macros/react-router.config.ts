import type { Config } from "@react-router/dev/config";

function normalizeBasePath(value: string | undefined): string {
  if (!value || value === "/") return "/";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}/`;
}

export default {
  appDirectory: "app",
  basename: normalizeBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  ),
  ssr: true,
  future: {
    v8_viteEnvironmentApi: true,
  },
} satisfies Config;
