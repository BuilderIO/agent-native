#!/usr/bin/env node
/**
 * guard-one-sign-in.mjs
 *
 * There is exactly one way for a template to send a visitor to sign in and get
 * them back where they started: `buildSignInReturnHref()` on the client and
 * `signInJourney()` on the server, both from `@agent-native/core`.
 *
 * Templates used to hand-roll `/_agent-native/sign-in?return=<encoded path>`
 * (and `/login?next=`) in twelve places. Every anti-loop and return-path fix
 * then landed on whichever copy the ticket named, so the reports never
 * stopped. This guard exists so template #12 cannot reintroduce a fork.
 *
 * It flags PRODUCERS only. The `?return=` CONSUMER in core is permanent API
 * surface — generated apps in the wild hand-write it and cannot be upgraded.
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

/**
 * End-to-end suites drive the real sign-in URL through a browser; they are
 * consumers of the entry route, not producers of a return path.
 */
const SKIP_FILE = /\.(spec|test|e2e)\.(ts|tsx)$/;

const RULES = [
  {
    // Any hand-built sign-in entry href. The helper is the only producer.
    pattern: /_agent-native\/sign-in/,
    reason:
      "hand-rolls the sign-in entry path; call buildSignInReturnHref() (client) or signInJourney() (server) instead",
  },
  {
    // `/login?next=`, `/signup?return=`, … — a second continuation grammar the
    // login document does not read, so the visitor lands on the app root.
    pattern: /\/(?:login|signup)\?[^"'`]*\b(?:next|return|returnTo|redirect)=/,
    reason:
      "invents a second continuation param on the login route; call buildSignInReturnHref() instead",
  },
];

/** Strip comments and import specifiers so prose and paths do not trip rules. */
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
