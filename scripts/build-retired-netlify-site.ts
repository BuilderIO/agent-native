#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const name = process.argv[2] || process.env.npm_package_name;

if (!name) {
  console.error("[retired-netlify] Missing retired site name.");
  process.exit(1);
}

const replacements = {
  contracts: {
    label: "Plans",
    url: "https://plan.agent-native.com",
  },
  images: {
    label: "Assets",
    url: "https://assets.agent-native.com",
  },
  videos: {
    label: "Clips",
    url: "https://clips.agent-native.com",
  },
  scheduling: {
    label: "Calendar",
    url: "https://calendar.agent-native.com",
  },
  "visual-plans": {
    label: "Plans",
    url: "https://plan.agent-native.com",
  },
};

const replacement = replacements[name];
const title = `Agent Native ${name.replace(/-/g, " ")}`;
const outputDir = path.join(repoRoot, "templates", name, "dist");
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} retired</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI", sans-serif;
        line-height: 1.5;
      }

      body {
        display: grid;
        min-height: 100vh;
        margin: 0;
        place-items: center;
        background: Canvas;
        color: CanvasText;
      }

      main {
        max-width: 36rem;
        padding: 3rem 1.5rem;
      }

      p {
        color: color-mix(in srgb, CanvasText 72%, transparent);
      }

      a {
        color: LinkText;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>This Agent Native app has been retired.</h1>
      <p>
        The ${escapeHtml(name)} template is no longer part of this repository.
        This static page keeps legacy Netlify projects deployable while their
        dashboard settings or DNS entries are cleaned up.
      </p>
      ${
        replacement
          ? `<p>Use <a href="${replacement.url}">${escapeHtml(
              replacement.label,
            )}</a> instead.</p>`
          : `<p>Visit <a href="https://agent-native.com">Agent Native</a> for the current apps.</p>`
      }
    </main>
  </body>
</html>
`;

mkdirSync(outputDir, { recursive: true });
writeFileSync(path.join(outputDir, "index.html"), html);

console.log(`[retired-netlify] Wrote templates/${name}/dist/index.html`);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
