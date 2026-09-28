#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { requireAddedLines } from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SOURCE_EXTENSIONS = /\.(?:tsx?|jsx?|mjs|cjs)$/;
const EXCLUDED_PATH =
  /(^|\/)(node_modules|dist|build|\.next|\.nuxt|\.output|\.cache|\.turbo|\.netlify|\.vercel|\.wrangler|coverage)(\/|$)/;
export const EVENT_CALL =
  /(?:^|[^\w$])(?:[\w$]+\??\.)*?(trackEvent|track)(?:\?\.)?\(\s*["'`]([^"'`]+)["'`]/g;
const RESERVED_EVENT_NAMES = new Set([
  "action.response",
  "app.first_action",
  "http.response",
]);

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function isCanonicalEventName(name) {
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(name);
}

function isReservedEventName(name) {
  return name.startsWith("$") || RESERVED_EVENT_NAMES.has(name);
}

function relative(absolutePath) {
  return path.relative(REPO_ROOT, absolutePath).replaceAll("\\", "/");
}

function main() {
  const added = requireAddedLines(REPO_ROOT, "guard:tracking-event-names");
  const violations = [];
  let filesChecked = 0;
  let callsChecked = 0;

  for (const [absolutePath, addedLineNumbers] of added) {
    const relativePath = relative(absolutePath);
    if (
      !SOURCE_EXTENSIONS.test(relativePath) ||
      EXCLUDED_PATH.test(relativePath)
    ) {
      continue;
    }

    let source;
    try {
      source = readFileSync(absolutePath, "utf8");
    } catch {
      console.error(`guard:tracking-event-names: unreadable ${relativePath}`);
      process.exit(2);
    }

    filesChecked += 1;
    for (const match of source.matchAll(EVENT_CALL)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const startLine = lineNumberAt(source, start);
      const endLine = lineNumberAt(source, end);
      const touched = [...addedLineNumbers].some(
        (line) => line >= startLine && line <= endLine,
      );
      if (!touched) continue;

      const name = match[2];
      callsChecked += 1;
      if (isCanonicalEventName(name) || isReservedEventName(name)) continue;
      violations.push({
        file: relativePath,
        line: startLine,
        name,
      });
    }
  }

  if (violations.length === 0) {
    console.log(
      `guard:tracking-event-names: OK (${callsChecked} added tracking call(s) across ${filesChecked} file(s))`,
    );
    return;
  }

  console.error(
    `guard:tracking-event-names: ${violations.length} new non-canonical event name(s):`,
  );
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line} ${violation.name} - use lowercase snake_case`,
    );
  }
  console.error(
    "  Keep provider-reserved names explicit; do not add new legacy aliases.",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
