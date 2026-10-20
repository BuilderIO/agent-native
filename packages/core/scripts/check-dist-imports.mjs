#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

const tiptapImports = [];
function findTiptapImports(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      findTiptapImports(full);
    } else if (
      entry.name.endsWith(".js") &&
      /["'](?:@tiptap\/|tiptap-markdown["'/])/.test(readFileSync(full, "utf8"))
    ) {
      tiptapImports.push(full);
    }
  }
}
findTiptapImports("dist/client");
if (tiptapImports.length > 0) {
  failed = true;
  console.error(
    `[check-dist-imports] Core client output must not retain Tiptap imports:\n${tiptapImports.map((file) => `  ${file}`).join("\n")}`,
  );
}

if (failed) process.exit(1);
console.log(
  `[check-dist-imports] SSR entry points import cleanly (${ENTRY_POINTS.join(", ")})`,
);
