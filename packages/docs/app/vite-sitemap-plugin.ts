import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Plugin } from "vite";

const SITE_URL = "https://agent-native.com";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vite plugin that auto-generates sitemap.xml from the file-based routes
 * in src/routes/ at build time. No more manual sitemap maintenance.
 */
export function sitemapPlugin(): Plugin {
  const rootDir = path.resolve(__dirname, "..");
  const routesDir = path.resolve(__dirname, "routes");

  return {
    name: "sitemap-generator",
    apply: "build",
    closeBundle() {
      const paths = [...new Set(discoverRoutes(routesDir, ""))];
      if (paths.length === 0) return;

      const urls = paths.map((p) => {
        const priority =
          p === "/" ? "1.0" : p.split("/").length <= 2 ? "0.9" : "0.8";
        return `  <url>
    <loc>${SITE_URL}${p}</loc>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
      });

      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;

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

function discoverRoutes(dir: string, prefix: string): string[] {
  const paths: string[] = [];

  if (!fs.existsSync(dir)) return paths;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("__")) continue;

    if (entry.isDirectory()) {
      paths.push(
        ...discoverRoutes(
          path.join(dir, entry.name),
          `${prefix}/${entry.name}`,
        ),
      );
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      const name = entry.name.replace(/\.tsx?$/, "");
      if (name === "index") {
        paths.push(prefix || "/");
      } else {
        paths.push(`${prefix}/${name}`);
      }
    }
  }

  return paths.sort();
}
