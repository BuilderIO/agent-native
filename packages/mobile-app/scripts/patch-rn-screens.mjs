#!/usr/bin/env node
// Patches react-native-screens's SearchBarNativeComponent.ts so RN codegen
// doesn't fail with "Unknown prop type for onSearchFocus: undefined". The
// upstream spec declares `SearchBarEvent = Readonly<{}>`; an empty object
// type trips the codegen parser, and this app doesn't use SearchBar.
//
// Runs as `eas-build-post-install` after pnpm install on EAS workers.
// Previously handled via pnpm's patchedDependencies, but EAS's bundled
// pnpm 9 rejects the resulting lockfile with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH
// even when it's in sync — a hand-rolled post-install sed avoids the whole
// pnpm-version dance.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(
  here,
  "..",
  "node_modules",
  "react-native-screens",
  "src",
  "fabric",
  "SearchBarNativeComponent.ts",
);

if (!existsSync(target)) {
  console.log(`[patch-rn-screens] file not present, skipping: ${target}`);
  process.exit(0);
}

const src = readFileSync(target, "utf8");
const patched = src.replace(
  "export type SearchBarEvent = Readonly<{}>;",
  "export type SearchBarEvent = Readonly<{ placeholder?: string }>;",
);

if (src === patched) {
  console.log("[patch-rn-screens] no change needed (already patched or signature moved)");
  process.exit(0);
}

writeFileSync(target, patched, "utf8");
console.log(`[patch-rn-screens] patched ${target}`);
