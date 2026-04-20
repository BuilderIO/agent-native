#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, "../templates");
const templates = fs
  .readdirSync(TEMPLATES_DIR)
  .filter((n) => fs.statSync(path.join(TEMPLATES_DIR, n)).isDirectory());

function migrateGlobalCss(filePath) {
  if (!fs.existsSync(filePath)) return false;
  let src = fs.readFileSync(filePath, "utf8");

  const v4Imports = `@import "tailwindcss";
@import "@agent-native/core/styles/agent-native.css";

@source "./**/*.{ts,tsx}";`;

  const tailwindBlockRe =
    /@tailwind\s+base\s*;\s*\n\s*@tailwind\s+components\s*;\s*\n\s*@tailwind\s+utilities\s*;/;
  if (tailwindBlockRe.test(src)) {
    src = src.replace(tailwindBlockRe, v4Imports);
  } else {
    src = src
      .replace(/^\s*@tailwind\s+base\s*;\s*$/m, v4Imports)
      .replace(/^\s*@tailwind\s+components\s*;\s*$/m, "")
      .replace(/^\s*@tailwind\s+utilities\s*;\s*$/m, "");
  }

  src = unwrapLayerBaseAroundSelectors(src);
  src = src.replace(/\*\s*\{\s*@apply\s+border-border\s*;?\s*\}\s*\n?/g, "");
  src = src.replace(/\n\s*\n\s*\n+/g, "\n\n");
  fs.writeFileSync(filePath, src);
  return true;
}

function unwrapLayerBaseAroundSelectors(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const layerIdx = src.indexOf("@layer base", i);
    if (layerIdx === -1) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, layerIdx);
    const openIdx = src.indexOf("{", layerIdx);
    if (openIdx === -1) { out += src.slice(layerIdx); break; }
    const closeIdx = findMatchingBrace(src, openIdx);
    if (closeIdx === -1) { out += src.slice(layerIdx); break; }
    const body = src.slice(openIdx + 1, closeIdx);
    if (/(:root|\.dark|\.light)\s*\{/.test(body)) {
      out += body;
    } else {
      out += src.slice(layerIdx, closeIdx + 1);
    }
    i = closeIdx + 1;
  }
  return out;
}

function findMatchingBrace(src, openIdx) {
  let depth = 0;
  for (let j = openIdx; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) return j; }
  }
  return -1;
}

function migratePackageJson(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const raw = fs.readFileSync(filePath, "utf8");
  const pkg = JSON.parse(raw);
  let changed = false;
  for (const section of ["dependencies", "devDependencies"]) {
    const deps = pkg[section];
    if (!deps) continue;
    for (const key of ["autoprefixer", "postcss", "tailwindcss-animate"]) {
      if (key in deps) { delete deps[key]; changed = true; }
    }
    if ("tailwindcss" in deps && deps.tailwindcss !== "catalog:") {
      deps.tailwindcss = "catalog:";
      changed = true;
    }
    if ("tailwindcss" in deps && !("@tailwindcss/vite" in deps)) {
      const merged = { ...deps, "@tailwindcss/vite": "catalog:" };
      const sortedKeys = Object.keys(merged).sort();
      const ordered = {};
      for (const k of sortedKeys) ordered[k] = merged[k];
      pkg[section] = ordered;
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + "\n");
  return changed;
}

function deleteIfExists(p) {
  if (fs.existsSync(p)) { fs.unlinkSync(p); return true; }
  return false;
}

const summary = [];
for (const t of templates) {
  const dir = path.join(TEMPLATES_DIR, t);
  const result = { template: t, deleted: [], cssRewritten: false, pkgUpdated: false };
  if (deleteIfExists(path.join(dir, "tailwind.config.ts"))) result.deleted.push("tailwind.config.ts");
  if (deleteIfExists(path.join(dir, "postcss.config.js"))) result.deleted.push("postcss.config.js");
  result.cssRewritten = migrateGlobalCss(path.join(dir, "app/global.css"));
  result.pkgUpdated = migratePackageJson(path.join(dir, "package.json"));
  summary.push(result);
}

console.log(JSON.stringify(summary, null, 2));
