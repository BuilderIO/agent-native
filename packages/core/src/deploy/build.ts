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

const nitro = await createNitro({
  rootDir: cwd,
  dev: false,
  preset,
  minify: true,
  serverDir: "./server",
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
