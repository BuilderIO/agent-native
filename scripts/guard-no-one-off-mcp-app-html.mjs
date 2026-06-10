#!/usr/bin/env node
/**
 * guard-no-one-off-mcp-app-html.mjs
 *
 * Template MCP Apps must reuse the real app UI. Use embedApp() to launch the
 * app at a focused route instead of hand-writing product surfaces in inline
 * HTML. This catches the old _mcp-apps helper pattern and direct mcpApp HTML
 * blocks in template actions.
 */

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const TEMPLATES_DIR = path.join(REPO_ROOT, "templates");

const failures = [];

async function walk(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, files);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function relative(file) {
  return path.relative(REPO_ROOT, file);
}

function findObjectSpan(source, start) {
  const open = source.indexOf("{", start);
  if (open === -1) return "";

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = open; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      i++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }

  return "";
}

const files = await walk(TEMPLATES_DIR);

for (const file of files) {
  const rel = relative(file);
  const source = readFileSync(file, "utf8");

  if (/\/actions\/_mcp-apps\.ts$/.test(rel)) {
    failures.push({
      file: rel,
      reason: "delete the bespoke MCP App HTML helper and use embedApp()",
    });
    continue;
  }

  if (source.includes('from "./_mcp-apps.js"')) {
    failures.push({
      file: rel,
      reason: "imports a bespoke MCP App HTML helper",
    });
  }

  const matches = source.matchAll(/\bmcpApp\s*:/g);
  for (const match of matches) {
    const block = findObjectSpan(source, match.index ?? 0);
    if (!block) continue;
    if (/\bhtml\s*:/.test(block)) {
      failures.push({
        file: rel,
        reason: "defines direct MCP App HTML instead of embedApp()",
      });
    }
    // Catalog-only configs (e.g. `{ compactCatalog: true }`) define no UI
    // surface, so the full-app embed helper is not required for them.
    if (/\bresource\s*:/.test(block) && !block.includes("embedApp(")) {
      failures.push({
        file: rel,
        reason:
          "defines an MCP App resource without the shared full-app embed helper",
      });
    }
  }
}

if (failures.length) {
  console.error("\n[guard-no-one-off-mcp-app-html] Failures:\n");
  for (const failure of failures) {
    console.error(`- ${failure.file}: ${failure.reason}`);
  }
  console.error(
    "\nUse embedApp() with a pure link builder so MCP hosts render the real React app route.",
  );
  process.exit(1);
}

console.log(
  `[guard-no-one-off-mcp-app-html] OK - scanned ${files.length} template source files.`,
);
