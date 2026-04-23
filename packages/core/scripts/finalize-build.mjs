#!/usr/bin/env node
// Cross-platform post-tsc step: copies runtime templates + CSS into dist/.
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

rmSync("dist/templates", { recursive: true, force: true });
cpSync("src/templates", "dist/templates", { recursive: true });
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
