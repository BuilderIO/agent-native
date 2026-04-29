#!/usr/bin/env node
// Generates all logo/icon/favicon assets across the monorepo from the
// canonical SVGs in packages/core/src/assets/branding/.
//
// Run from the framework root:
//   node scripts/build-branding-assets.mjs
//
// Requires macOS `sips` and `iconutil` (no extra deps).

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BRANDING = join(ROOT, "packages/core/src/assets/branding");

const FAVICON_SVG = readFileSync(join(BRANDING, "favicon.svg"), "utf8");

function sized(svg, size) {
  return svg.replace(
    /<svg([^>]*)width="\d+"\s+height="\d+"/,
    `<svg$1width="${size}" height="${size}"`,
  );
}

function writeSizedSvg(path, size) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, sized(FAVICON_SVG, size));
}

function rasterize(svgPath, pngPath, size) {
  mkdirSync(dirname(pngPath), { recursive: true });
  execSync(
    `sips -s format png -z ${size} ${size} "${svgPath}" --out "${pngPath}"`,
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

// 1) Template & core scaffold favicons (SVGs)
const TEMPLATE_DIRS = [
  "packages/core/src/templates/default",
  "templates/analytics",
  "templates/calendar",
  "templates/calls",
  "templates/clips",
  "templates/content",
  "templates/design",
  "templates/dispatch",
  "templates/forms",
  "templates/issues",
  "templates/macros",
  "templates/mail",
  "templates/meeting-notes",
  "templates/recruiting",
  "templates/scheduling",
  "templates/slides",
  "templates/starter",
  "templates/videos",
  "templates/voice",
];

for (const t of TEMPLATE_DIRS) {
  const tplDir = join(ROOT, t);
  if (!existsSync(tplDir)) continue;
  const pub = join(tplDir, "public");
  mkdirSync(pub, { recursive: true });
  writeSizedSvg(join(pub, "favicon.svg"), 1024);
  writeSizedSvg(join(pub, "icon-180.svg"), 180);
  writeSizedSvg(join(pub, "icon-192.svg"), 192);
  writeSizedSvg(join(pub, "icon-512.svg"), 512);
  console.log(`✔ ${t}/public/{favicon,icon-180,icon-192,icon-512}.svg`);
}

// 2) Calls template historically uses logo.svg as its favicon — overwrite too
const CALLS_LOGO = join(ROOT, "templates/calls/public/logo.svg");
if (existsSync(CALLS_LOGO)) {
  writeFileSync(CALLS_LOGO, sized(FAVICON_SVG, 1024));
  console.log("✔ templates/calls/public/logo.svg");
}

// 3) Docs site
const DOCS_PUBLIC = join(ROOT, "packages/docs/public");
if (existsSync(DOCS_PUBLIC)) {
  writeSizedSvg(join(DOCS_PUBLIC, "favicon.svg"), 1024);
  writeSizedSvg(join(DOCS_PUBLIC, "icon-192.svg"), 192);
  writeSizedSvg(join(DOCS_PUBLIC, "icon-512.svg"), 512);
  rasterize(join(DOCS_PUBLIC, "favicon.svg"), join(DOCS_PUBLIC, "logo192.png"), 192);
  rasterize(join(DOCS_PUBLIC, "favicon.svg"), join(DOCS_PUBLIC, "logo512.png"), 512);
  // Modern browsers accept a PNG renamed to favicon.ico; keep our existing .ico path working.
  rasterize(join(DOCS_PUBLIC, "favicon.svg"), join(DOCS_PUBLIC, "favicon.ico"), 64);
  console.log("✔ packages/docs/public/{favicon.svg,icon-192,icon-512,logo192.png,logo512.png,favicon.ico}");
}

// 4) Electron desktop app icon
const DESKTOP_BUILD = join(ROOT, "packages/desktop-app/build");
if (existsSync(DESKTOP_BUILD)) {
  writeFileSync(join(DESKTOP_BUILD, "icon.svg"), sized(FAVICON_SVG, 1024));
  rasterize(join(DESKTOP_BUILD, "icon.svg"), join(DESKTOP_BUILD, "icon.png"), 1024);

  const ICONSET = join(DESKTOP_BUILD, "icon.iconset");
  rmSync(ICONSET, { recursive: true, force: true });
  mkdirSync(ICONSET, { recursive: true });
  const sizes = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];
  for (const [size, name] of sizes) {
    rasterize(join(DESKTOP_BUILD, "icon.svg"), join(ICONSET, name), size);
  }
  execSync(
    `iconutil -c icns -o "${join(DESKTOP_BUILD, "icon.icns")}" "${ICONSET}"`,
    { stdio: "inherit" },
  );
  console.log("✔ packages/desktop-app/build/{icon.svg,icon.png,icon.iconset,icon.icns}");
}

// 5) Mobile app
const MOBILE_ASSETS = join(ROOT, "packages/mobile-app/assets");
if (existsSync(MOBILE_ASSETS)) {
  const tmp = join(MOBILE_ASSETS, "_branding-source.svg");
  writeFileSync(tmp, sized(FAVICON_SVG, 1024));
  rasterize(tmp, join(MOBILE_ASSETS, "icon.png"), 1024);
  rasterize(tmp, join(MOBILE_ASSETS, "adaptive-icon.png"), 1024);
  rasterize(tmp, join(MOBILE_ASSETS, "favicon.png"), 64);
  rmSync(tmp);
  console.log("✔ packages/mobile-app/assets/{icon,adaptive-icon,favicon}.png");
}

console.log("\nDone.");
