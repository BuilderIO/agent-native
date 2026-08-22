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
 * fails on growth beyond the tolerance. It deliberately does NOT fail on an app
 * it has no baseline for — it names it instead, so an unmeasured app can never
 * be mistaken for a passing one.
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

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        try {
          total += statSync(full).size;
        } catch {
          // coercion-ok: an unreadable entry adds no measurable bytes and must
          // not abort a size report.
        }
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
  // Named, never silently passed: an app with no baseline is unmeasured, not
  // verified. Record one with --update.
  console.log(
    `[size-baseline] No baseline recorded for ${site}; sizes not asserted. ` +
      `Record with: pnpm check:function-size-baseline --site ${site} --dir ${functionsDir} --update`,
  );
  for (const [name, bytes] of Object.entries(measured).sort()) {
    console.log(`    ${name} ${mb(bytes)}MB`);
  }
  process.exit(0);
}

const grown = [];
for (const [name, bytes] of Object.entries(measured).sort()) {
  const before = recorded[name];
  if (before === undefined) {
    console.log(`  new  ${name} ${mb(bytes)}MB (not in baseline)`);
    continue;
  }
  const overRatio = bytes > before * TOLERANCE_RATIO;
  const overBytes = bytes - before > TOLERANCE_BYTES;
  const label = overRatio && overBytes ? "GREW" : "ok  ";
  console.log(`  ${label} ${name} ${mb(before)}MB -> ${mb(bytes)}MB`);
  if (overRatio && overBytes) grown.push({ name, before, bytes });
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
  process.exit(1);
}

console.log(`\n[size-baseline] ${site}: no function grew past its baseline.`);
