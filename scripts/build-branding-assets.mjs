#!/usr/bin/env node
// Generates all logo/icon/favicon assets across the monorepo from the
// canonical PNG in packages/core/src/assets/branding/favicon.png.
//
// Run from the framework root:
//   node scripts/build-branding-assets.mjs
//
// Requires macOS `sips` and `iconutil` (no extra deps).

import { execSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BRANDING = join(ROOT, "packages/core/src/assets/branding");

const WEB_ICON_PNG = join(BRANDING, "favicon.png");
const WEB_ICON_DATA_URI = `data:image/png;base64,${readFileSync(WEB_ICON_PNG).toString("base64")}`;

function webIconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 600 600"><image href="${WEB_ICON_DATA_URI}" width="600" height="600"/></svg>\n`;
}

function writeSizedSvg(path, size) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, webIconSvg(size));
}

writeSizedSvg(join(BRANDING, "favicon.svg"), 600);
writeSizedSvg(join(BRANDING, "mac-app-icon.svg"), 600);

function rasterize(svgPath, pngPath, size) {
  mkdirSync(dirname(pngPath), { recursive: true });
  execSync(
    `sips -s format png -z ${size} ${size} "${svgPath}" --out "${pngPath}"`,
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

// Tauri 2.x's image decoder only accepts 8-bit/channel RGBA PNGs. Apple's
// `ictool` writes 16-bit/channel PNGs, which crash the app at startup with
// `invalid icon: dimensions don't match the number of pixels supplied`. Run
// any PNG that Tauri loads directly through sharp-cli to coerce it to 8-bit.
function force8BitRgba(pngPath) {
  const outDir = dirname(pngPath);
  const tmpDir = join(outDir, ".__bitdepth_tmp");
  mkdirSync(tmpDir, { recursive: true });
  try {
    execSync(`pnpm dlx sharp-cli -i "${pngPath}" -o "${tmpDir}" -f png`, {
      stdio: ["ignore", "ignore", "inherit"],
    });
    copyFileSync(join(tmpDir, pngPath.split("/").pop()), pngPath);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
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
  const icoPath = join(pub, "favicon.ico");
  if (existsSync(icoPath)) {
    rasterize(join(pub, "favicon.svg"), icoPath, 64);
  }
  console.log(`✔ ${t}/public/{favicon,icon-180,icon-192,icon-512}.svg`);
}

// 2) Calls template historically uses logo.svg as its favicon — overwrite too
const CALLS_LOGO = join(ROOT, "templates/calls/public/logo.svg");
if (existsSync(CALLS_LOGO)) {
  writeSizedSvg(CALLS_LOGO, 1024);
  console.log("✔ templates/calls/public/logo.svg");
}

// 3) Docs site
const DOCS_PUBLIC = join(ROOT, "packages/docs/public");
if (existsSync(DOCS_PUBLIC)) {
  writeSizedSvg(join(DOCS_PUBLIC, "favicon.svg"), 1024);
  writeSizedSvg(join(DOCS_PUBLIC, "icon-192.svg"), 192);
  writeSizedSvg(join(DOCS_PUBLIC, "icon-512.svg"), 512);
  rasterize(
    join(DOCS_PUBLIC, "favicon.svg"),
    join(DOCS_PUBLIC, "logo192.png"),
    192,
  );
  rasterize(
    join(DOCS_PUBLIC, "favicon.svg"),
    join(DOCS_PUBLIC, "logo512.png"),
    512,
  );
  // Modern browsers accept a PNG renamed to favicon.ico; keep our existing .ico path working.
  rasterize(
    join(DOCS_PUBLIC, "favicon.svg"),
    join(DOCS_PUBLIC, "favicon.ico"),
    64,
  );
  console.log(
    "✔ packages/docs/public/{favicon.svg,icon-192,icon-512,logo192.png,logo512.png,favicon.ico}",
  );
}

// 4) Electron desktop app icon — Liquid Glass on macOS Tahoe via .icon → Assets.car,
// plus a Liquid-Glass-rendered .icns fallback for older macOS via Icon Composer's
// `ictool` (PNG output already includes shine + shadow, then iconutil packs to .icns).
const DESKTOP_BUILD = join(ROOT, "packages/desktop-app/build");
const ICON_BUNDLE = join(BRANDING, "agent-native.icon");
const ICTOOL =
  "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool";
const HAS_ICTOOL = existsSync(ICTOOL) && existsSync(ICON_BUNDLE);
if (existsSync(DESKTOP_BUILD)) {
  writeSizedSvg(join(DESKTOP_BUILD, "icon.svg"), 1024);
  rasterize(
    join(DESKTOP_BUILD, "icon.svg"),
    join(DESKTOP_BUILD, "icon.png"),
    1024,
  );

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
  if (HAS_ICTOOL) {
    // Render Liquid-Glass-styled PNGs (with specular highlight + shadow baked in).
    for (const [size, name] of sizes) {
      execSync(
        `"${ICTOOL}" "${ICON_BUNDLE}" --export-image --output-file "${join(ICONSET, name)}" --platform macOS --rendition Default --width ${size} --height ${size} --scale 1`,
        { stdio: ["ignore", "ignore", "inherit"] },
      );
    }
  } else {
    for (const [size, name] of sizes) {
      rasterize(join(DESKTOP_BUILD, "icon.svg"), join(ICONSET, name), size);
    }
  }
  execSync(
    `iconutil -c icns -o "${join(DESKTOP_BUILD, "icon.icns")}" "${ICONSET}"`,
    { stdio: "inherit" },
  );

  // Compile .icon → Assets.car for native macOS Tahoe Liquid Glass treatment.
  if (HAS_ICTOOL) {
    rmSync(join(DESKTOP_BUILD, "Assets.car"), { force: true });
    rmSync(join(DESKTOP_BUILD, "_actool.plist"), { force: true });
    execSync(
      `xcrun actool "${ICON_BUNDLE}" --compile "${DESKTOP_BUILD}" --include-all-app-icons --enable-on-demand-resources NO --enable-icon-stack-fallback-generation NO --development-region en --target-device mac --platform macosx --minimum-deployment-target 11.0 --app-icon agent-native --output-partial-info-plist "${join(DESKTOP_BUILD, "_actool.plist")}" --output-format human-readable-text --notices --warnings --errors`,
      { stdio: ["ignore", "ignore", "inherit"] },
    );
  }
  console.log(
    "✔ packages/desktop-app/build/{icon.svg,icon.png,icon.iconset,icon.icns,Assets.car}",
  );
}

// 5) Clips Tauri desktop app — same Liquid Glass treatment as Electron
const CLIPS_TAURI_DIR = join(ROOT, "templates/clips/desktop/src-tauri");
const CLIPS_TAURI_ICONS = join(CLIPS_TAURI_DIR, "icons");
if (existsSync(CLIPS_TAURI_ICONS)) {
  const tmpFav = join(CLIPS_TAURI_ICONS, "_branding-source.svg");
  writeSizedSvg(tmpFav, 1024);
  // Render the standalone PNGs Tauri references in tauri.conf.json with
  // the same `ictool` pipeline Electron uses, so the dock icon gets the
  // proper macOS template (correct safe-area + Liquid Glass shine) and
  // matches the size of every other app's dock icon. Without this the
  // PNG is a raw SVG rasterization that fills the whole 1024 canvas
  // and ends up visibly larger than every neighbouring app.
  if (HAS_ICTOOL) {
    execSync(
      `"${ICTOOL}" "${ICON_BUNDLE}" --export-image --output-file "${join(CLIPS_TAURI_ICONS, "icon.png")}" --platform macOS --rendition Default --width 1024 --height 1024 --scale 1`,
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    execSync(
      `"${ICTOOL}" "${ICON_BUNDLE}" --export-image --output-file "${join(CLIPS_TAURI_ICONS, "32x32.png")}" --platform macOS --rendition Default --width 32 --height 32 --scale 1`,
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    execSync(
      `"${ICTOOL}" "${ICON_BUNDLE}" --export-image --output-file "${join(CLIPS_TAURI_ICONS, "128x128.png")}" --platform macOS --rendition Default --width 128 --height 128 --scale 1`,
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    execSync(
      `"${ICTOOL}" "${ICON_BUNDLE}" --export-image --output-file "${join(CLIPS_TAURI_ICONS, "128x128@2x.png")}" --platform macOS --rendition Default --width 256 --height 256 --scale 1`,
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    // ictool writes 16-bit PNGs; Tauri requires 8-bit RGBA at runtime.
    for (const name of [
      "icon.png",
      "32x32.png",
      "128x128.png",
      "128x128@2x.png",
    ]) {
      force8BitRgba(join(CLIPS_TAURI_ICONS, name));
    }
  } else {
    rasterize(tmpFav, join(CLIPS_TAURI_ICONS, "icon.png"), 1024);
    rasterize(tmpFav, join(CLIPS_TAURI_ICONS, "32x32.png"), 32);
    rasterize(tmpFav, join(CLIPS_TAURI_ICONS, "128x128.png"), 128);
    rasterize(tmpFav, join(CLIPS_TAURI_ICONS, "128x128@2x.png"), 256);
  }

  // Build .icns from a fresh iconset — render via ictool when available so the
  // Liquid Glass shine is baked in for older macOS versions.
  const ICONSET = join(CLIPS_TAURI_ICONS, "_iconset.iconset");
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
  if (HAS_ICTOOL) {
    for (const [size, name] of sizes) {
      execSync(
        `"${ICTOOL}" "${ICON_BUNDLE}" --export-image --output-file "${join(ICONSET, name)}" --platform macOS --rendition Default --width ${size} --height ${size} --scale 1`,
        { stdio: ["ignore", "ignore", "inherit"] },
      );
    }
  } else {
    for (const [size, name] of sizes) {
      rasterize(tmpFav, join(ICONSET, name), size);
    }
  }
  execSync(
    `iconutil -c icns -o "${join(CLIPS_TAURI_ICONS, "icon.icns")}" "${ICONSET}"`,
    { stdio: "inherit" },
  );
  rmSync(ICONSET, { recursive: true, force: true });

  // Compile Assets.car so a release `tauri build` ships Liquid Glass on macOS Tahoe.
  // Tauri's bundle.macOS.files copies it into Contents/Resources/Assets.car at bundle time.
  if (HAS_ICTOOL) {
    rmSync(join(CLIPS_TAURI_DIR, "Assets.car"), { force: true });
    execSync(
      `xcrun actool "${ICON_BUNDLE}" --compile "${CLIPS_TAURI_DIR}" --include-all-app-icons --enable-on-demand-resources NO --enable-icon-stack-fallback-generation NO --development-region en --target-device mac --platform macosx --minimum-deployment-target 11.0 --app-icon agent-native --output-partial-info-plist "${join(CLIPS_TAURI_DIR, "_actool.plist")}" --output-format human-readable-text --notices --warnings --errors`,
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    rmSync(join(CLIPS_TAURI_DIR, "_actool.plist"), { force: true });
  }

  // .ico — sips writes a PNG-renamed-to-.ico, which Windows tolerates.
  rasterize(tmpFav, join(CLIPS_TAURI_ICONS, "icon.ico"), 256);

  rmSync(tmpFav);

  // Tray (macOS menu bar) — monochrome white on transparent at template-image size.
  const traySrc = readFileSync(join(BRANDING, "tray-icon.svg"), "utf8");
  const tmpTray = join(CLIPS_TAURI_ICONS, "_tray-source.svg");
  writeFileSync(tmpTray, traySrc);
  rasterize(tmpTray, join(CLIPS_TAURI_ICONS, "tray.png"), 44);
  rmSync(tmpTray);

  console.log("✔ templates/clips/desktop/src-tauri/{icons/*,Assets.car}");
}

// 6) Slack bot icon (manual upload to api.slack.com/apps → Basic Information → Display)
const SLACK_OUT = join(BRANDING, "slack-bot");
mkdirSync(SLACK_OUT, { recursive: true });
rasterize(
  join(BRANDING, "favicon.svg"),
  join(SLACK_OUT, "agent-native-512.png"),
  512,
);
rasterize(
  join(BRANDING, "favicon.svg"),
  join(SLACK_OUT, "agent-native-1024.png"),
  1024,
);
console.log(
  "✔ packages/core/src/assets/branding/slack-bot/{agent-native-512,agent-native-1024}.png",
);

// 7) Mobile app
const MOBILE_ASSETS = join(ROOT, "packages/mobile-app/assets");
if (existsSync(MOBILE_ASSETS)) {
  const tmp = join(MOBILE_ASSETS, "_branding-source.svg");
  writeSizedSvg(tmp, 1024);
  rasterize(tmp, join(MOBILE_ASSETS, "icon.png"), 1024);
  rasterize(tmp, join(MOBILE_ASSETS, "adaptive-icon.png"), 1024);
  rasterize(tmp, join(MOBILE_ASSETS, "favicon.png"), 64);
  rmSync(tmp);
  console.log("✔ packages/mobile-app/assets/{icon,adaptive-icon,favicon}.png");
}

// 7b) Native iOS AppIcon (Expo prebuild output — does NOT auto-regenerate)
const IOS_APPICON = join(
  ROOT,
  "packages/mobile-app/ios/AgentNative/Images.xcassets/AppIcon.appiconset",
);
if (existsSync(IOS_APPICON)) {
  rasterize(
    join(BRANDING, "favicon.svg"),
    join(IOS_APPICON, "App-Icon-1024x1024@1x.png"),
    1024,
  );
  console.log(
    "✔ packages/mobile-app/ios/.../AppIcon.appiconset/App-Icon-1024x1024@1x.png",
  );
}

console.log("\nDone.");
