#!/usr/bin/env node

/**
 * Post-build step for deploying agent-native apps to any platform.
 *
 * Uses Nitro's programmatic build API to package the app for any deployment
 * target — Netlify, Vercel, Cloudflare, AWS, Deno, etc. No hardcoded
 * platform logic. Set NITRO_PRESET to choose the target.
 *
 * The React Router build runs first (producing build/client/ + build/server/),
 * then this script runs Nitro's build to generate the platform-specific output.
 *
 * Usage: node deploy/build.js (called automatically by `agent-native build`)
 */

import path from "path";
import fs from "fs";

const cwd = process.cwd();
const preset = process.env.NITRO_PRESET || "node";

if (preset === "node") {
  process.exit(0);
}

console.log(`[deploy] Building for preset "${preset}" via Nitro...`);

const { createNitro, prepare, copyPublicAssets, build } =
  await import("nitro/builder");

// Resolve the React Router server build so the SSR catch-all route
// can import "virtual:react-router/server-build" in production.
const rrServerBuild = path.join(cwd, "build", "server", "index.js");
const nitro = await createNitro({
  rootDir: cwd,
  dev: false,
  preset,
  minify: true,
  serverDir: "./server",
  alias: fs.existsSync(rrServerBuild)
    ? { "virtual:react-router/server-build": rrServerBuild }
    : undefined,
} as any);

await prepare(nitro);
await copyPublicAssets(nitro);
await build(nitro);

// Copy React Router's client build into Nitro's public output dir so the
// deployment includes static assets alongside the server function.
const clientDir = path.join(cwd, "build", "client");
const publicOutputDir = nitro.options.output.publicDir;
if (fs.existsSync(clientDir) && publicOutputDir) {
  copyDir(clientDir, publicOutputDir);
  console.log(
    `[deploy] Copied client assets to ${path.relative(cwd, publicOutputDir)}`,
  );
}

// Generate SPA fallback index.html by scanning client assets.
// H3 v2 beta has a bug where event.node.req is accessed internally in Web
// runtimes (Netlify, CF Workers), causing SSR to fail. This fallback ensures
// the app works via client-side rendering until the H3 bug is fixed.
if (
  publicOutputDir &&
  !fs.existsSync(path.join(publicOutputDir, "index.html"))
) {
  const assetsDir = path.join(publicOutputDir, "assets");
  if (fs.existsSync(assetsDir)) {
    const files = fs.readdirSync(assetsDir);
    const css = files.filter((f) => f.endsWith(".css"));
    const entry =
      files.find((f) => f.startsWith("entry.client")) ||
      files.find((f) => f.startsWith("client-")) ||
      files.find((f) => f.startsWith("root-") && f.endsWith(".js"));

    if (entry) {
      const html = [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1" />',
        ...css.map((c) => `<link rel="stylesheet" href="/assets/${c}" />`),
        "</head>",
        "<body>",
        '<div id="root"></div>',
        `<script type="module" src="/assets/${entry}"></script>`,
        "</body>",
        "</html>",
      ].join("\n");
      fs.writeFileSync(path.join(publicOutputDir, "index.html"), html);
      console.log("[deploy] Generated SPA fallback index.html");
    }
  }
}

await nitro.close();
console.log(`[deploy] Nitro build complete for preset "${preset}".`);

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}
