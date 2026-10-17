#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const TEMPLATES_DIR = path.join(REPO_ROOT, "templates");
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".cache",
  ".generated",
  ".netlify",
  ".react-router",
  "coverage",
  "e2e",
]);

const SKIP_FILE = /\.(spec|test|e2e)\.(ts|tsx)$/;

const RULES = [
  {
    pattern: /_agent-native\/sign-in/,
    reason:
      "hand-rolls the sign-in entry path; call buildSignInReturnHref() (client) or signInJourney() (server) instead",
  },
  {
    pattern: /\/(?:login|signup)\?[^"'`]*\b(?:next|return|returnTo|redirect)=/,
    reason:
      "invents a second continuation param on the login route; call buildSignInReturnHref() instead",
  },
];

function stripNonCode(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*\*.*$/gm, "");
}

async function walk(dir, files = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return files;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, files);
    } else if (
      entry.isFile() &&
      /\.(ts|tsx)$/.test(entry.name) &&
      !SKIP_FILE.test(entry.name)
    ) {
      files.push(full);
    }
  }
  return files;
}

const files = await walk(TEMPLATES_DIR);
const failures = [];

for (const file of files) {
  const source = stripNonCode(readFileSync(file, "utf8"));
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const rule of RULES) {
      if (rule.pattern.test(lines[i])) {
        failures.push({
          file: `${path.relative(REPO_ROOT, file)}:${i + 1}`,
          reason: rule.reason,
        });
      }
    }
  }
}

if (failures.length) {
  console.error("\n[guard-one-sign-in] Failures:\n");
  for (const failure of failures) {
    console.error(`- ${failure.file}: ${failure.reason}`);
  }
  console.error(
    "\nOne primitive establishes a session and returns the visitor where they" +
      "\nstarted. Import buildSignInReturnHref from" +
      '\n"@agent-native/core/client/ui", or signInJourney from' +
      '\n"@agent-native/core/shared" on the server.\n',
  );
  process.exit(1);
}

console.log(
  `[guard-one-sign-in] OK - scanned ${files.length} template source files.`,
);
