import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  ssr: true,
  prerender: [
    "/",
    "/docs",
    "/docs/server",
    "/docs/client",
    "/docs/scripts",
    "/docs/deployment",
    "/docs/file-sync",
    "/docs/key-concepts",
    "/docs/harnesses",
    "/docs/creating-templates",
    "/docs/cli-adapters",
    "/docs/database-adapters",
    "/templates",
    "/templates/analytics",
    "/templates/calendar",
    "/templates/content",
    "/templates/mail",
    "/templates/slides",
    "/templates/video",
  ],
} satisfies Config;
