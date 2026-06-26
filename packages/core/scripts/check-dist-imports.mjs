#!/usr/bin/env node
// Postbuild guard: actually import the SSR-critical entry points under Node's
// strict ESM resolver. This reproduces the failure class where compiled client
// code reaches into copy-only template scaffolding (src/templates ships verbatim
// .ts, so its .js never exists in dist). Such imports work under Vite's
// on-the-fly client transform but throw ERR_MODULE_NOT_FOUND during SSR.
//
// A static scan can't tell a real broken import from a JSDoc example, a codegen
// string literal, or a dynamic import of a consumer-generated file, so we run
// the real resolver instead.
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ENTRY_POINTS = ["dist/client/i18n.js"];

let failed = false;
for (const entry of ENTRY_POINTS) {
  if (!existsSync(entry)) {
    console.error(`[check-dist-imports] missing entry ${entry} — build first`);
    failed = true;
    continue;
  }
  try {
    await import(pathToFileURL(entry).href);
  } catch (error) {
    failed = true;
    console.error(`[check-dist-imports] failed to import ${entry}:`);
    console.error(`  ${error?.message ?? error}`);
  }
}

if (failed) process.exit(1);
console.log(
  `[check-dist-imports] SSR entry points import cleanly (${ENTRY_POINTS.join(", ")})`,
);
