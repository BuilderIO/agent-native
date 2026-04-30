import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Plugin } from "vite";

const SITE_URL = "https://agent-native.com";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vite plugin that auto-generates sitemap.xml from the docs content and
 * template registry at build time. No more manual sitemap maintenance.
 */
export function sitemapPlugin(): Plugin {
  const rootDir = path.resolve(__dirname, "..");

  return {
    name: "sitemap-generator",
    apply: "build",
    closeBundle() {
      const paths = buildSitemapPaths(rootDir);
      if (paths.length === 0) return;

      const sitemap = buildSitemapXml(paths);

      // Write to public/ (source of truth) and dist outputs
      for (const dir of ["public", "dist/client", "dist/server/public"]) {
        const outDir = path.resolve(rootDir, dir);
        if (fs.existsSync(outDir)) {
          fs.writeFileSync(path.join(outDir, "sitemap.xml"), sitemap);
        }
      }

      console.log(`[sitemap] Generated sitemap.xml with ${paths.length} URLs`);
    },
  };
}

export function buildSitemapPaths(rootDir: string): string[] {
  const docsDir = path.resolve(rootDir, "../core/docs/content");
  const templateCardPath = path.resolve(
    rootDir,
    "app/components/TemplateCard.tsx",
  );

  const docsPaths = fs
    .readdirSync(docsDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.replace(/\.md$/, ""))
    .filter((slug) => slug !== "getting-started")
    .map((slug) => `/docs/${slug}`);

  const templateSource = fs.readFileSync(templateCardPath, "utf8");
  const templatePaths = Array.from(
    templateSource.matchAll(/slug:\s*"([^"]+)"/g),
    (match) => `/templates/${match[1]}`,
  );

  return [
    "/",
    "/docs",
    "/download",
    "/templates",
    ...docsPaths,
    ...templatePaths,
  ]
    .filter((route, index, routes) => routes.indexOf(route) === index)
    .sort((a, b) => {
      if (a === "/") return -1;
      if (b === "/") return 1;
      return a.localeCompare(b);
    });
}

export function buildSitemapXml(paths: string[]): string {
  const urls = paths.map((p) => {
    const priority =
      p === "/" ? "1.0" : p === "/docs" || p === "/templates" ? "0.9" : "0.8";
    return `  <url>
    <loc>${SITE_URL}${p}</loc>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}
