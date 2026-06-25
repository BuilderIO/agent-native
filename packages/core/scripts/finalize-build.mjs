#!/usr/bin/env node
// Cross-platform post-TypeScript step: copies runtime templates + CSS into dist/.
// Inline shell (rm -rf, cp -r, mkdir -p) breaks on Windows cmd.exe, which
// blocks CI runs of the Clips Tauri workflow on windows-latest.
import {
  readFileSync,
  readdirSync,
  rmSync,
  cpSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";

import { materializeSourceCorpus } from "./materialize-source-corpus.mjs";

// Prune any spec/test files that TypeScript emitted or template copying preserved.
// They must never ship in the published package.
function pruneSpecArtifacts(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      pruneSpecArtifacts(full);
    } else if (
      /\.(spec|test)\.[cm]?[jt]sx?$/.test(entry.name) ||
      /\.(spec|test)\.d\.ts(\.map)?$/.test(entry.name) ||
      /\.(spec|test)\.[cm]?js\.map$/.test(entry.name)
    ) {
      rmSync(full, { force: true });
    }
  }
}
if (existsSync("dist")) pruneSpecArtifacts("dist");

rmSync("dist/templates", { recursive: true, force: true });
cpSync("src/templates", "dist/templates", { recursive: true });
pruneSpecArtifacts("dist/templates");
mkdirSync("dist/styles", { recursive: true });
for (const f of readdirSync("src/styles").filter((n) => n.endsWith(".css"))) {
  copyFileSync(join("src/styles", f), join("dist/styles", f));
}

// Snapshot the pnpm catalog into dist/catalog.json so the CLI can inject it
// into scaffolded workspaces even when running as a published npm package
// (where the monorepo pnpm-workspace.yaml doesn't exist).
const wsPath = join("..", "..", "pnpm-workspace.yaml");
if (existsSync(wsPath)) {
  const content = readFileSync(wsPath, "utf-8");
  const catalog = {};
  let inCatalog = false;
  for (const line of content.split("\n")) {
    if (/^catalog:\s*$/.test(line)) {
      inCatalog = true;
      continue;
    }
    if (inCatalog) {
      if (/^\S/.test(line)) break;
      const match = line.match(/^\s+"?([^":]+)"?\s*:\s*"?([^"]+)"?\s*$/);
      if (match) catalog[match[1]] = match[2];
    }
  }
  writeFileSync("dist/catalog.json", JSON.stringify(catalog, null, 2) + "\n");
}

materializeSourceCorpus();
