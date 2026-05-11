#!/usr/bin/env node
/**
 * guard-extension-no-public.mjs
 *
 * Defensive CI guard: refuse to let extensions become reachable by a random
 * authenticated user.
 *
 * Background:
 *   Extensions are Alpine.js mini-apps that run inside a sandboxed iframe but
 *   call actions, raw SQL, and the secrets-injecting proxy as the *viewer*.
 *   Letting them be set to `visibility = "public"` is equivalent to letting
 *   anyone with the link run arbitrary code with the viewer's credentials,
 *   so the framework registers extensions with `allowPublic: false` and
 *   `requireOrgMemberForUserShares: true`.
 *
 * What this guard checks:
 *
 *   1. Every `registerShareableResource({ type: "extension", ... })` call in
 *      the repo must include `allowPublic: false` AND
 *      `requireOrgMemberForUserShares: true` in the same object literal.
 *
 *   2. Extension-source files (packages/core/src/extensions/**) must not
 *      contain string literals or raw SQL that flips an extension row to
 *      `visibility = "public"` (e.g. `'visibility: "public"'`,
 *      `'visibility = '"'"'public'"'"'`, raw `UPDATE tools SET visibility =
 *      'public'`).
 *
 * The single intentional exception is the framework-level
 * `set-resource-visibility` action — it accepts the literal "public" as a
 * Zod enum option because it's the generic visibility setter used by ALL
 * resources, and the per-resource `allowPublic` flag is what blocks it for
 * extensions. That file is explicitly skipped below.
 *
 * Allowed escape hatch: a single-line marker comment
 *   `// guard:allow-extension-public — <reason>`
 * placed within ~5 lines of a flagged construct opts that specific line out.
 * Reviewers should push back hard on every new opt-out.
 */

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  ".cache",
  ".turbo",
  ".netlify",
  ".vercel",
  ".wrangler",
  "coverage",
  ".generated",
]);

// Files where the literal-scan should be skipped — they legitimately accept
// "public" as one of several allowed values, and the runtime guards (the
// per-resource `allowPublic: false` flag, `updateExtension`'s
// ForbiddenError) are what actually block the value for extensions. These
// files are STILL scanned for the registration check.
const SKIP_LITERAL_SCAN = new Set([
  // Type unions and helper signatures use "public" for compile-time
  // compatibility with the generic share UI. Defense in depth lives in the
  // runtime guards inside `updateExtension`.
  "packages/core/src/extensions/store.ts",
  "packages/core/src/extensions/store.spec.ts",
]);

const ALLOW_MARKER = /guard:allow-extension-public/;

async function walk(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".agents") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, files);
    } else if (entry.isFile() && /\.(ts|tsx|mjs|js|cjs)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const failures = [];

function relative(file) {
  return path.relative(REPO_ROOT, file);
}

function hasAllowMarkerNear(lines, idx) {
  const lo = Math.max(0, idx - 5);
  const hi = Math.min(lines.length - 1, idx + 5);
  for (let i = lo; i <= hi; i++) {
    if (ALLOW_MARKER.test(lines[i])) return true;
  }
  return false;
}

/**
 * Strip `// ...` line comments and `/* ... *\/` block comments from a TS/JS
 * snippet. The simple state machine here also ignores comment-shaped
 * sequences inside single, double, and backtick string literals so we don't
 * accidentally chop out user-facing strings — but it doesn't try to handle
 * regex literals or template-literal interpolation. That's fine for the
 * registration object literals we scan, which are plain key/value pairs.
 */
function stripComments(input) {
  let out = "";
  let i = 0;
  const len = input.length;
  while (i < len) {
    const ch = input[i];
    const next = input[i + 1];
    if (ch === "/" && next === "/") {
      while (i < len && input[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < len - 1 && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch;
      i++;
      while (i < len) {
        const c = input[i];
        out += c;
        i++;
        if (c === "\\") {
          if (i < len) {
            out += input[i];
            i++;
          }
          continue;
        }
        if (c === quote) break;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Find `registerShareableResource({ ... type: "extension" ... })` invocations
 * and verify the same object literal sets `allowPublic: false` AND
 * `requireOrgMemberForUserShares: true`. Comments inside the literal are
 * stripped before matching so a doc comment that *mentions* the flag in
 * prose doesn't satisfy the check.
 *
 * Uses a brace-balanced scan rather than a regex so multi-line object
 * literals (which is the normal style) are picked up correctly.
 */
function checkExtensionRegistration(file, source) {
  const idx = source.indexOf("registerShareableResource(");
  if (idx === -1) return;
  let cursor = idx;
  while (cursor !== -1) {
    const openParen = source.indexOf("(", cursor);
    const openBrace = source.indexOf("{", openParen);
    if (openBrace === -1) break;
    let depth = 1;
    let end = openBrace + 1;
    while (end < source.length && depth > 0) {
      const ch = source[end];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      end++;
      if (depth === 0) break;
    }
    if (depth !== 0) break;
    const literal = stripComments(source.slice(openBrace, end));
    if (/type\s*:\s*["']extension["']/.test(literal)) {
      const allowsPublic = /allowPublic\s*:\s*false/.test(literal);
      const requiresOrgMember = /requireOrgMemberForUserShares\s*:\s*true/.test(
        literal,
      );
      if (!allowsPublic || !requiresOrgMember) {
        failures.push(
          `${relative(file)}: registerShareableResource({ type: "extension" }) must include \`allowPublic: false\` AND \`requireOrgMemberForUserShares: true\`. ` +
            `Found: allowPublic=${allowsPublic}, requireOrgMemberForUserShares=${requiresOrgMember}.`,
        );
      }
    }
    cursor = source.indexOf("registerShareableResource(", end);
  }
}

/**
 * Flag string literals and raw SQL in extension source that would set an
 * extension row to `visibility = "public"`. The framework-level
 * set-resource-visibility action is skipped via SKIP_FILES — that file
 * legitimately accepts "public" as a Zod enum value because it's the
 * generic API; the per-resource `allowPublic: false` flag blocks the value
 * for extensions.
 */
function checkPublicLiterals(file, source) {
  const rel = relative(file);
  if (!rel.startsWith("packages/core/src/extensions/")) return;
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (hasAllowMarkerNear(lines, i)) continue;
    // JS/TS object-literal form
    if (/visibility\s*:\s*["']public["']/.test(line)) {
      failures.push(
        `${relative(file)}:${i + 1}: extension code must not set \`visibility: "public"\` — extensions are restricted to private/org sharing.`,
      );
    }
    // Raw SQL form
    if (/visibility\s*=\s*'public'/.test(line)) {
      failures.push(
        `${relative(file)}:${i + 1}: extension SQL must not write \`visibility = 'public'\` — extensions are restricted to private/org sharing.`,
      );
    }
  }
}

// The guard file itself is excluded from both checks — it contains example
// snippets in prose that would otherwise self-flag.
const SELF_PATH = path.relative(REPO_ROOT, fileURLToPath(import.meta.url));

const files = await walk(REPO_ROOT);
for (const file of files) {
  const rel = relative(file);
  if (rel === SELF_PATH) continue;
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  // Registration check always runs (the regression we care about most is a
  // registration that drops the flags). Literal scan skips files that
  // legitimately accept "public" as a generic enum value.
  checkExtensionRegistration(file, source);
  if (!SKIP_LITERAL_SCAN.has(rel)) {
    checkPublicLiterals(file, source);
  }
}

if (failures.length > 0) {
  console.error("\n[guard-extension-no-public] Failures:\n");
  for (const f of failures) console.error("  ✗ " + f);
  console.error(
    "\nExtensions execute arbitrary code with the *viewer's* credentials. " +
      "They must remain private/org-only — see CLAUDE.md > Extensions and the " +
      "`sharing` skill for the rules.\n",
  );
  process.exit(1);
}

console.log(
  `[guard-extension-no-public] OK — scanned ${files.length} files, no violations.`,
);
