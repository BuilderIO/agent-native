#!/usr/bin/env node
/**
 * guard-no-error-string-returns.mjs
 *
 * Actions must THROW on failure; they must never return plain prose error
 * strings like: return "Error: ..."  or  return (backtick)Error: ...(backtick)
 *
 * Background (2026-06-10): Returning a prose error string from an action
 * produces an HTTP-200 to the browser and a tool-success to the agent.
 * Neither surface can distinguish "Error: ..." from a real successful
 * string result.  Thrown errors are caught by action-routes.ts and mapped
 * to correct HTTP status codes; the agent dispatcher surfaces them as
 * tool errors so the model can retry or escalate.
 *
 * Patterns rejected:
 *   return "Error: ..."        (literal double-quoted)
 *   return (backtick)Error: ...(backtick)    (template literal)
 *   return "Failed to ..."                  (alternate prefix)
 *   return (backtick)Failed to ...(backtick)
 *
 * The check is case-insensitive on the Error/Failed prefix so it catches
 * typos like "error: " as well.
 *
 * Files or lines that have a legitimate reason to return an error-shaped
 * string (e.g. a test fixture, a function that intentionally builds a
 * prose error to attach to a result object) can opt out with:
 *
 *   // guard:allow-error-string — short reason
 *
 * Place the pragma on the same line as the return statement or on the
 * line immediately above it. Reviewers should push back on every new
 * opt-out.
 *
 * Scope: templates/TEMPLATE/actions/*.ts and the scaffold action template.
 * templates/plan is excluded (separate team ownership, fenced from this
 * wave of changes).
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
  ".react-router",
  ".generated",
  "coverage",
]);

/**
 * Patterns that flag a forbidden return.
 * Match:  return "Error: ..."  /  return `Error: ...`
 *         return "Failed to ..." / return `Failed to ...`
 * Case-insensitive on the keyword prefix.
 */
const FORBIDDEN = /return\s+[`"](?:error|failed\s+to)\s*:/i;

/** Opt-out pragma — on the same line or the line immediately above. */
const PRAGMA = /\/\/\s*guard:allow-error-string/i;

/** Collect all .ts files under a directory, skipping SKIP_DIRS. */
async function collectTs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTs(full)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  // Collect all template action files, but skip templates/plan.
  const templatesDir = path.join(REPO_ROOT, "templates");
  const templateEntries = await readdir(templatesDir, { withFileTypes: true });

  const actionDirs = [];
  for (const entry of templateEntries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "plan") continue; // fenced — separate team ownership
    const actionsDir = path.join(templatesDir, entry.name, "actions");
    actionDirs.push(actionsDir);
  }

  // Also check the scaffold action template if it exists.
  const scaffoldActionsDir = path.join(
    REPO_ROOT,
    "packages",
    "core",
    "src",
    "templates",
    "scaffold",
    "actions",
  );
  actionDirs.push(scaffoldActionsDir);

  const violations = [];

  for (const dir of actionDirs) {
    let files;
    try {
      files = await collectTs(dir);
    } catch {
      // Directory may not exist (e.g. scaffold); silently skip.
      continue;
    }

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!FORBIDDEN.test(line)) continue;

        // Allow if this line or the previous line carries the opt-out pragma.
        const prevLine = i > 0 ? lines[i - 1] : "";
        if (PRAGMA.test(line) || PRAGMA.test(prevLine)) continue;

        violations.push({
          file: path.relative(REPO_ROOT, file),
          line: i + 1,
          text: line.trim(),
        });
      }
    }
  }

  if (violations.length === 0) {
    console.log("guard-no-error-string-returns: OK");
    process.exit(0);
  }

  console.error(
    `\nguard-no-error-string-returns: ${violations.length} violation(s) found.\n`,
  );
  console.error(
    "Actions must THROW on failure; returning a prose error string produces\n" +
      'an HTTP-200 and a tool-success. Replace  return "Error: ..."  with\n' +
      '  throw new Error("...")  (drop the redundant "Error: " prefix).\n',
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  console.error(
    "\nTo opt out for a specific line add the comment:\n" +
      "  // guard:allow-error-string — <reason>\n" +
      "on the same line or the line immediately above it.\n",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("guard-no-error-string-returns: unexpected error:", err);
  process.exit(1);
});
