#!/usr/bin/env node
/**
 * Fail a deploy whose serverless functions grew past their recorded size.
 *
 * The existing budget (`netlifyFunctionSizeBudget`, build.ts) is a single
 * 120MB ceiling plus allowances. It has never fired, because it was set above
 * the fleet's worst app and every app sat under it while quietly doubling —
 * docs went 59.8MB to 159.9MB inside that headroom. A ceiling nobody is near
 * measures nothing; growth from where an app actually is, does.
 *
 * This compares each emitted function against a committed per-app baseline and
 * fails on growth beyond the tolerance. An app with no baseline fails too: a
 * deploy nothing has measured is unmeasured, not small, and letting it exit 0
 * would rebuild the same "everything passes" signal this replaces. The only
 * apps allowed through unmeasured are the ones named in UNMEASURABLE_APPS, so
 * every gap is a line in the diff a reviewer can see.
 *
 * Usage:
 *   node scripts/check-function-size-baseline.mjs --site slides --dir <functions-internal>
 *   node scripts/check-function-size-baseline.mjs --site slides --dir <dir> --update
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const BASELINE_FILE = path.join(
  REPO_ROOT,
  "scripts",
  "serverless-function-baseline.json",
);

/**
 * Growth under this is normal drift — a dependency patch, a few new routes.
 * Above it is the shape that has actually hurt: a package tree arriving in the
 * function graph. Both bounds must be exceeded, so a small function is not
 * tripped by a rounding-scale change.
 */
const TOLERANCE_RATIO = 1.1;
const TOLERANCE_BYTES = 5 * 1024 * 1024;

/**
 * Apps with no recorded baseline that may still deploy, and why none exists.
 *
 * This waives only this check. It cannot rescue a deploy that failed earlier —
 * a build that never emitted functions never reaches here — so an entry means
 * exactly one thing: if this app does build, its size ships unasserted until
 * someone records a baseline.
 *
 * Both entries are here because the app could not be built locally to measure,
 * not because anything about them is unmeasurable in principle. Remove an entry
 * the moment a baseline is recorded; the app is then protected like the other
 * fifteen.
 */
const UNMEASURABLE_APPS = new Map([
  [
    "crm",
    "no baseline yet: templates/crm has no prebuilt build/client locally, so a local netlify build stops at the publish-dir guard before emitting functions",
  ],
  [
    "design",
    "no baseline yet: a local netlify build crashes tracing electron's Squirrel.framework, which does not exist on disk",
  ],
]);

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

/**
 * Total bytes under `dir`, or a throw.
 *
 * An unreadable entry must never be counted as zero here: this number decides
 * whether a payload grew, so a permissions or filesystem error that silently
 * shrinks the measurement is the one direction the check cannot fail in. A
 * partial measurement is not a small one.
 */
function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch (error) {
      throw new Error(
        `[size-baseline] Could not read ${cur}: ${error.message}. Refusing to ` +
          "report a size measured from an incomplete tree.",
      );
    }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      try {
        total += statSync(full).size;
      } catch (error) {
        throw new Error(
          `[size-baseline] Could not stat ${full}: ${error.message}. Refusing ` +
            "to report a size measured from an incomplete tree.",
        );
      }
    }
  }
  return total;
}

function measure(functionsDir) {
  const sizes = {};
  for (const entry of readdirSync(functionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    sizes[entry.name] = dirSize(path.join(functionsDir, entry.name));
  }
  return sizes;
}

function readBaseline() {
  if (!existsSync(BASELINE_FILE)) return {};
  return JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
}

const site = arg("site");
const functionsDir = arg("dir");
const update = process.argv.includes("--update");

if (!site || !functionsDir) {
  console.error(
    "usage: check-function-size-baseline --site <id> --dir <functions-internal> [--update]",
  );
  process.exit(2);
}
if (!existsSync(functionsDir)) {
  console.error(`[size-baseline] No functions directory at ${functionsDir}.`);
  process.exit(2);
}

const measured = measure(functionsDir);
const baseline = readBaseline();
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

if (update) {
  baseline[site] = measured;
  // Sort by rebuilding the object. JSON.stringify's second argument is a key
  // ALLOWLIST, not a sort order — passing site names there silently drops every
  // function entry and writes `{"slides":{}}`.
  const sorted = {};
  for (const key of Object.keys(baseline).sort()) {
    const fns = baseline[key];
    sorted[key] = Object.fromEntries(
      Object.keys(fns)
        .sort()
        .map((name) => [name, fns[name]]),
    );
  }
  writeFileSync(BASELINE_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(
    `[size-baseline] Recorded ${Object.keys(measured).length} function(s) for ${site}.`,
  );
  process.exit(0);
}

const recorded = baseline[site];
if (!recorded) {
  const allowed = UNMEASURABLE_APPS.get(site);
  for (const [name, bytes] of Object.entries(measured).sort()) {
    console.log(`    ${name} ${mb(bytes)}MB`);
  }
  if (allowed) {
    console.log(
      `[size-baseline] ${site} has no baseline and is a known exception: ${allowed}. ` +
        "Sizes above are reported, not asserted.",
    );
    process.exit(0);
  }
  console.error(
    `\n[size-baseline] No baseline recorded for ${site}, so nothing about this ` +
      "deploy's size is asserted. Record the current sizes once you have " +
      "confirmed they are what you intend:\n" +
      `  pnpm check:function-size-baseline --site ${site} --dir ${functionsDir} --update\n` +
      "If the app genuinely cannot be built and measured, add it to " +
      "UNMEASURABLE_APPS with the reason so the gap is visible in review.",
  );
  process.exit(1);
}

const grown = [];
const unrecorded = [];
for (const [name, bytes] of Object.entries(measured).sort()) {
  const before = recorded[name];
  if (before === undefined) {
    // A function the baseline has never seen is unmeasured, and unmeasured is
    // not "small": without this the build could emit a brand new 100MB
    // function and deploy it unchallenged.
    console.log(`  NEW  ${name} ${mb(bytes)}MB (not in baseline)`);
    unrecorded.push({ name, bytes });
    continue;
  }
  const overRatio = bytes > before * TOLERANCE_RATIO;
  const overBytes = bytes - before > TOLERANCE_BYTES;
  const label = overRatio && overBytes ? "GREW" : "ok  ";
  console.log(`  ${label} ${name} ${mb(before)}MB -> ${mb(bytes)}MB`);
  if (overRatio && overBytes) grown.push({ name, before, bytes });
}

if (unrecorded.length > 0) {
  console.error(
    `\n[size-baseline] ${site}: ${unrecorded.length} function(s) are not in the baseline:`,
  );
  for (const fn of unrecorded) {
    console.error(`  - ${fn.name}: ${mb(fn.bytes)}MB, never recorded`);
  }
  console.error(
    "\nA function nothing has measured cannot be asserted small. Record the " +
      "current sizes once you have confirmed they are what you intend:\n" +
      `  pnpm check:function-size-baseline --site ${site} --dir ${functionsDir} --update`,
  );
}

if (grown.length > 0) {
  console.error(`\n[size-baseline] ${site}: function payload grew:`);
  for (const g of grown) {
    console.error(
      `  - ${g.name}: ${mb(g.before)}MB -> ${mb(g.bytes)}MB (+${mb(g.bytes - g.before)}MB)`,
    );
  }
  console.error(
    "\nEvery byte here is unzipped on each cold start, and Netlify uploads every\n" +
      "function separately. Find what entered the graph before accepting this. If\n" +
      "the growth is intended, re-record with --update so the new size is the\n" +
      "thing future builds are measured against.",
  );
}

if (grown.length > 0 || unrecorded.length > 0) process.exit(1);

console.log(`\n[size-baseline] ${site}: no function grew past its baseline.`);
