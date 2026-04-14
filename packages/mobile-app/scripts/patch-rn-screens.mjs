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
// rn-screens ships both the TS source AND compiled .d.ts declarations that
// codegen reads at build time; patch both copies so the build can't pick up
// the stale Readonly<{}> signature from whichever one codegen prefers.
const rnScreensRoot = resolve(here, "..", "node_modules", "react-native-screens");
const targets = [
  resolve(rnScreensRoot, "src", "fabric", "SearchBarNativeComponent.ts"),
  resolve(rnScreensRoot, "lib", "typescript", "fabric", "SearchBarNativeComponent.d.ts"),
];

let patchedCount = 0;
for (const target of targets) {
  if (!existsSync(target)) {
    console.log(`[patch-rn-screens] not present, skipping: ${target}`);
    continue;
  }
  const src = readFileSync(target, "utf8");
  const patched = src.replace(
    "export type SearchBarEvent = Readonly<{}>;",
    "export type SearchBarEvent = Readonly<{ placeholder?: string }>;",
  );
  if (src === patched) {
    console.log(`[patch-rn-screens] already patched: ${target}`);
    continue;
  }
  writeFileSync(target, patched, "utf8");
  console.log(`[patch-rn-screens] patched ${target}`);
  patchedCount++;
}

if (patchedCount === 0) {
  console.log(
    "[patch-rn-screens] no changes applied (either already patched or signature moved)",
  );
}
