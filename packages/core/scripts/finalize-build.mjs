#!/usr/bin/env node
// Cross-platform post-tsc step: copies runtime templates + CSS into dist/.
// Inline shell (rm -rf, cp -r, mkdir -p) breaks on Windows cmd.exe, which
// blocks CI runs of the Clips Tauri workflow on windows-latest.
import { readdirSync, rmSync, cpSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

rmSync("dist/templates", { recursive: true, force: true });
cpSync("src/templates", "dist/templates", { recursive: true });
mkdirSync("dist/styles", { recursive: true });
for (const f of readdirSync("src/styles").filter((n) => n.endsWith(".css"))) {
  copyFileSync(join("src/styles", f), join("dist/styles", f));
}
