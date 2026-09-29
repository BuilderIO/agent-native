#!/usr/bin/env node
/**
 * guard-no-source-reading-tests.mjs
 *
 * A "source-reading test" loads one of our own modules as TEXT and asserts
 * that strings appear in it, instead of running the code:
 *
 *   const source = readFileSync(path.join(__dirname, "Editor.tsx"), "utf8");
 *   expect(source).toContain("overflow-y-auto");
 *
 * These pass when the behavior is broken (the string is still there, the
 * feature is not) and fail on harmless refactors (a rename, a reformat, a
 * CRLF checkout on Windows). They pin what the code says, not what it does.
 * An audit found 186 of them in 42 files and the habit was still growing.
 *
 * The existing ones are a separate cleanup. This guard is diff-scoped via
 * scripts/lib/changed-lines.mjs: it only fails on lines THIS branch added,
 * so the habit stops spreading without demanding the backlog be fixed in
 * the same PR.
 *
 * Rejected on added lines in test files (*.test.*, *.spec.*, __tests__/):
 *   - readFileSync / readFile / fs.promises.readFile (and aliases) that read
 *     a path ending in .ts .tsx .js .jsx .mjs .cjs .mts .cts as text, whether
 *     the path is a string literal, path.join/resolve(...) arguments, a
 *     new URL("./X.tsx", import.meta.url), or a const built on a nearby line
 *   - the same read behind a helper in the same file:
 *       const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
 *       read("app/Editor.tsx");   // flagged at this call
 *   - `import src from "./X.tsx?raw"` and dynamic import("./X.tsx?raw")
 *
 * Never flagged: reads of json, yaml, md, css, html, sql, txt, fixtures and
 * snapshots; reads with no encoding (a Buffer: copy, compare, serve); and
 * reads under a temp directory or build output (a test of a generator
 * reading back what it generated is testing behavior). The detector is in
 * scripts/lib/source-read-detector.mjs; where it cannot tell where a path
 * comes from it does not flag.
 *
 * Instead, render the component (Content UI: renderUi from
 * templates/content/app/test-utils/render-ui.tsx) or call the module through
 * its public interface and assert on what a user or caller observes.
 *
 * Sometimes source text really is the subject: an architecture or boundary
 * check, a workflow file. Opt out per line with
 *
 *   // source-read-ok: <reason>
 *
 * on the same line or the line immediately above it (a comment block whose
 * first line is the pragma also works). The reason must not be empty.
 *
 * Usage:
 *   node scripts/guard-no-source-reading-tests.mjs          diff-scoped (CI)
 *   node scripts/guard-no-source-reading-tests.mjs --all    every tracked
 *       test file, ignoring the diff. For MEASUREMENT ONLY: it reports the
 *       whole backlog and always exits 0. Do not use it as a CI gate.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  execGuardCommand,
  GUARD_EXIT_COULD_NOT_RUN,
  requireAddedLines,
} from "./lib/changed-lines.mjs";
import {
  findSourceReadViolations,
  isTestFile,
} from "./lib/source-read-detector.mjs";

const GUARD_NAME = "guard-no-source-reading-tests";
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const USAGE = `Usage: node scripts/guard-no-source-reading-tests.mjs [--all]

  (no flag)  Diff-scoped, for CI and pre-push: fails on lines this branch added.
  --all      Scan every tracked test file, ignoring the diff. For MEASUREMENT
             ONLY (reports the whole backlog, always exits 0). Not a CI mode.

Opt out one line with:  // source-read-ok: <reason>
`;

function readTestFile(rel) {
  try {
    return readFileSync(path.join(REPO_ROOT, rel), "utf8");
  } catch (err) {
    console.error(`${GUARD_NAME}: could not read ${rel}: ${err.message}`);
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }
}

function toRepoRelative(file) {
  return path.relative(REPO_ROOT, file).replace(/\\/g, "/");
}

function reportViolations(violations) {
  console.error(
    `\n${GUARD_NAME}: ${violations.length} violation(s) found on lines this branch added.\n`,
  );
  console.error(
    "Tests that read one of our own source files as text and assert on the\n" +
      "text pass when the behavior breaks (the string is still there, the\n" +
      "feature is not) and fail on harmless refactors (renames, reformatting,\n" +
      "CRLF checkouts). They check what the code says, not what it does.\n\n" +
      "Instead, run the code: render the component with renderUi from\n" +
      "templates/content/app/test-utils/render-ui.tsx (Content UI), or call the\n" +
      "module through its public interface, and assert on what a user or\n" +
      "caller observes.\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}\n    (${v.reason})`);
  }
  console.error(
    "\nIf the source text really is the subject (an architecture or boundary\n" +
      "check, a workflow file), opt out for that line with the comment:\n" +
      "  // source-read-ok: <reason>\n" +
      "on the same line or the line immediately above it. The reason must not\n" +
      "be empty.\n",
  );
}

function runDiffScoped() {
  const added = requireAddedLines(REPO_ROOT, GUARD_NAME);

  const violations = [];
  for (const [file, addedSet] of added) {
    const rel = toRepoRelative(file);
    if (!isTestFile(rel)) continue;
    violations.push(
      ...findSourceReadViolations(rel, readTestFile(rel), addedSet),
    );
  }

  if (violations.length === 0) {
    console.log(`${GUARD_NAME}: OK`);
    process.exit(0);
    return;
  }
  reportViolations(violations);
  process.exit(1);
}

function runAll() {
  const listing = execGuardCommand("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const files = listing.split("\0").filter((f) => f && isTestFile(f));

  let reads = 0;
  let flaggedFiles = 0;
  for (const rel of files) {
    const found = findSourceReadViolations(rel, readTestFile(rel), null);
    if (found.length > 0) flaggedFiles += 1;
    reads += found.length;
    for (const v of found) {
      console.log(`${v.file}:${v.line}  ${v.text}\n    (${v.reason})`);
    }
  }
  console.log(
    `\n${GUARD_NAME} --all (measurement only, not a CI mode): ` +
      `${reads} source-reading read(s) in ${flaggedFiles} of ` +
      `${files.length} test file(s).`,
  );
  process.exit(0);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
    return;
  }
  const unknown = args.filter((arg) => arg !== "--all");
  if (unknown.length > 0) {
    console.error(`${GUARD_NAME}: unknown option(s): ${unknown.join(", ")}\n`);
    console.error(USAGE);
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
    return;
  }

  if (args.includes("--all")) runAll();
  else runDiffScoped();
}

main();
