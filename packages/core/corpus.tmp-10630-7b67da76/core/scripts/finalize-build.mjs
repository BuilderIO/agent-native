#!/usr/bin/env node
// Cross-platform post-TypeScript step: copies runtime templates + CSS into dist/.
// Inline shell (rm -rf, cp -r, mkdir -p) breaks on Windows cmd.exe, which
// blocks CI runs of the Clips Tauri workflow on windows-latest.
import { randomBytes } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  renameSync,
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

// Two overlapping `pnpm --filter @agent-native/core run build` invocations
// (e.g. concurrent `scripts/dev-lazy.ts` prebuilds) both land here and used
// to `rmSync`/`cpSync` "dist/templates" directly, which could throw EEXIST
// out of `cpSync` when one process's copy landed mid-walk of another's rm.
// Build into a unique temp dir first, then swap it into place with the same
// bounded, race-tolerant retry used for the source corpus in
// materialize-source-corpus.mjs.
const distTemplatesDir = "dist/templates";
const templatesTempDir = `${distTemplatesDir}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
const templateSwapMaxAttempts = 5;
const templateSwapRetryDelayMs = 40;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// src/templates always has content (default/, headless/, workspace-core/,
// workspace-root/), so a non-empty dist/templates is proof some build --
// ours or a concurrent one -- finished copying. No marker file is added so
// dist/templates stays a byte-for-byte mirror of src/templates.
function looksLikeMaterializedTemplates(dir) {
  if (!existsSync(dir)) return false;
  return readdirSync(dir).length > 0;
}

function swapTemplatesDirIntoPlace(tempDir) {
  for (let attempt = 1; attempt <= templateSwapMaxAttempts; attempt += 1) {
    try {
      rmSync(distTemplatesDir, { recursive: true, force: true });
    } catch {
      // A concurrent build may already be repopulating dist/templates; let
      // the renameSync below decide the outcome instead of failing here.
    }
    try {
      renameSync(tempDir, distTemplatesDir);
      return;
    } catch (error) {
      const code = error && error.code;
      const concurrentWriter =
        code === "ENOTEMPTY" ||
        code === "EEXIST" ||
        code === "ENOENT" ||
        code === "EPERM";
      if (!concurrentWriter) throw error;
      if (looksLikeMaterializedTemplates(distTemplatesDir)) {
        rmSync(tempDir, { recursive: true, force: true });
        return;
      }
      if (attempt < templateSwapMaxAttempts) {
        sleepSync(templateSwapRetryDelayMs * attempt);
        continue;
      }
      throw error;
    }
  }
}

rmSync(templatesTempDir, { recursive: true, force: true });
cpSync("src/templates", templatesTempDir, { recursive: true });
pruneSpecArtifacts(templatesTempDir);
swapTemplatesDirIntoPlace(templatesTempDir);
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
