import type { Config } from "@react-router/dev/config";
import fs from "node:fs";
import path from "node:path";

// Auto-discover doc pages from content/ directory
function getDocRoutes(): string[] {
  const contentDir = path.join(import.meta.dirname, "content");
  if (!fs.existsSync(contentDir)) return [];
  return fs
    .readdirSync(contentDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const slug = f.replace(/\.md$/, "");
      return slug === "getting-started" ? "/docs" : `/docs/${slug}`;
    });
}

export default {
  appDirectory: "app",
  ssr: true,
  routeDiscovery: { mode: "initial" },
  prerender: [
    "/",
    "/download",
    "/templates",
    "/templates/analytics",
    "/templates/calendar",
    "/templates/content",
    "/templates/mail",
    "/templates/slides",
    "/templates/video",
    ...getDocRoutes(),
  ],
} satisfies Config;
