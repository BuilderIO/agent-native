#!/usr/bin/env node
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
const BASELINE_FILE =
  process.env.AGENT_NATIVE_FUNCTION_SIZE_BASELINE_FILE ||
  path.join(REPO_ROOT, "scripts", "serverless-function-baseline.json");

const TOLERANCE_RATIO = 1.1;
const TOLERANCE_BYTES = 5 * 1024 * 1024;

const NEW_FUNCTION_FAIL_BYTES = 5 * 1024 * 1024;

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

const BUILD_FLAG_GATED_FUNCTIONS = new Map([
  [
    "agent-native-keep-warm",
    {
      bytes: 1024 * 1024,
      why: "a scheduled trigger entry, not a bundle",
    },
  ],
  [
    "server-integration-recovery",
    {
      like: "server",
      why: "a pruned clone of the server function",
    },
  ],
]);

/**
 * The byte ceiling for a gated function, or null when the function it derives
 * from is not in this build and no bound can be stated.
 *
 * A derived ceiling reads THIS build's sibling before the baseline's: the
 * invariant is that the clone cannot exceed the function it was cloned from in
 * the same build. Comparing it against a baseline recorded from an older build
 * fails on ordinary drift.
 */
function gatedFunctionCap(name, measured, recorded) {
  const rule = BUILD_FLAG_GATED_FUNCTIONS.get(name);
  if (!rule) return null;
  if (rule.bytes !== undefined) return rule.bytes;
  return measured?.[rule.like] ?? recorded?.[rule.like] ?? null;
}

function oversizedGatedFunctions(measured, recorded) {
  const over = [];
  for (const [name, bytes] of Object.entries(measured)) {
    const cap = gatedFunctionCap(name, measured, recorded);
    if (cap !== null && bytes > cap) over.push({ name, bytes, cap });
  }
  return over;
}

function reportOversizedGated(site, over) {
  console.error(
    `\n[size-baseline] ${site}: ${over.length} build-flag-gated function(s) over their ceiling:`,
  );
  for (const fn of over) {
    const rule = BUILD_FLAG_GATED_FUNCTIONS.get(fn.name);
    console.error(
      `  - ${fn.name}: ${mb(fn.bytes)}MB, ceiling ${mb(fn.cap)}MB (${rule.why})`,
    );
  }
  console.error(
    "\nThese are exempt from the new/removed checks only because of what they " +
      "are. One this large is carrying something else; find what entered its " +
      "graph rather than raising the ceiling.",
  );
}

const UNMEASURABLE_APPS = new Map([
  [
    "crm",
    "no baseline yet: templates/crm has no prebuilt build/client locally, so a local netlify build stops at the publish-dir guard before emitting functions",
  ],
  [
    "workspace",
    "no baseline possible here: the workspace production site has no templates/workspace directory, so this checkout cannot build or measure it",
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

const DEPLOY_GATED_RUNTIME_PAYLOADS = [
  {
    relativePath: path.join("node_modules", "ffmpeg-static"),
    reason: "bundled only when AGENT_NATIVE_SERVERLESS_FFMPEG_ARCH matches",
    excludeFromBaseline: false,
  },
];

const RESVG_NATIVE_PACKAGE_NAME =
  /^resvg-js-(?:darwin|win32|linux|android|freebsd)-[a-z0-9]+(?:-[a-z0-9]+)?$/;

function deployGatedPayloads(functionDir) {
  const found = [];
  for (const payload of DEPLOY_GATED_RUNTIME_PAYLOADS) {
    const payloadDir = path.join(functionDir, payload.relativePath);
    if (!existsSync(payloadDir)) continue;
    found.push({ ...payload, bytes: dirSize(payloadDir) });
  }

  const resvgScopeDir = path.join(functionDir, "node_modules", "@resvg");
  if (existsSync(resvgScopeDir)) {
    for (const entry of readdirSync(resvgScopeDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !RESVG_NATIVE_PACKAGE_NAME.test(entry.name))
        continue;
      const packageDir = path.join(resvgScopeDir, entry.name);
      found.push({
        relativePath: path.relative(functionDir, packageDir),
        reason: "selected for the serverless runtime platform",
        excludeFromBaseline: true,
        bytes: dirSize(packageDir),
      });
    }
  }

  return found;
}

function measure(functionsDir) {
  const sizes = {};
  const gated = [];
  for (const entry of readdirSync(functionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const functionDir = path.join(functionsDir, entry.name);
    const payloads = deployGatedPayloads(functionDir);
    const excluded = payloads
      .filter((payload) => payload.excludeFromBaseline)
      .reduce((total, payload) => total + payload.bytes, 0);
    sizes[entry.name] = dirSize(functionDir) - excluded;
    for (const payload of payloads) {
      gated.push({ fn: entry.name, ...payload });
    }
  }
  if (gated.length > 0) {
    console.log(
      `\n[size-baseline] ${gated.length} deploy-gated runtime payload(s) are in this ` +
        "build. Platform-native payloads are excluded from the comparison; the " +
        "remaining payloads stay in the raw size:",
    );
    for (const item of gated) {
      console.log(
        `  ${item.fn}: ${item.relativePath} ${mb(item.bytes)}MB ` +
          `(${item.reason}; ${item.excludeFromBaseline ? "excluded" : "included"})`,
      );
    }
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

if (update) {
  const over = oversizedGatedFunctions(measured, baseline[site]);
  if (over.length > 0) {
    reportOversizedGated(site, over);
    console.error("\nRefusing to record it.");
    process.exit(1);
  }
  baseline[site] = measured;
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
    const over = oversizedGatedFunctions(measured, undefined);
    if (over.length > 0) {
      reportOversizedGated(site, over);
      process.exit(1);
    }
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
const shrunk = [];
const unrecorded = [];
const oversizedGated = [];
const newSmall = [];
for (const [name, bytes] of Object.entries(measured).sort()) {
  const before = recorded[name];
  if (BUILD_FLAG_GATED_FUNCTIONS.has(name)) {
    const cap = gatedFunctionCap(name, measured, recorded);
    if (cap !== null && bytes > cap) {
      console.log(`  BIG  ${name} ${mb(bytes)}MB (gated, over ${mb(cap)}MB)`);
      oversizedGated.push({ name, bytes, cap });
      continue;
    }
    console.log(`  gated ${name} ${mb(bytes)}MB (build-flag gated)`);
    continue;
  }
  if (before === undefined) {
    if (bytes < NEW_FUNCTION_FAIL_BYTES) {
      console.log(`  new  ${name} ${mb(bytes)}MB (not in baseline, under cap)`);
      newSmall.push({ name, bytes });
      continue;
    }
    console.log(`  NEW  ${name} ${mb(bytes)}MB (not in baseline)`);
    unrecorded.push({ name, bytes });
    continue;
  }
  const overRatio = bytes > before * TOLERANCE_RATIO;
  const overBytes = bytes - before > TOLERANCE_BYTES;
  const label = overRatio && overBytes ? "GREW" : "ok  ";
  console.log(`  ${label} ${name} ${mb(before)}MB -> ${mb(bytes)}MB`);
  if (overRatio && overBytes) grown.push({ name, before, bytes });
  if (before - bytes > 3 * 1024 * 1024) shrunk.push({ name, before, bytes });
}

const missing = Object.keys(recorded)
  .filter((name) => measured[name] === undefined)
  .sort();
if (missing.length > 0) {
  console.log(
    `\n[size-baseline] ${site}: ${missing.length} baseline function(s) not emitted by this build:`,
  );
  for (const name of missing) {
    console.log(`  - ${name}: was ${mb(recorded[name])}MB`);
  }
  console.log(
    "  Expected when a build flag disables one. If it is permanent, re-record " +
      "so the baseline stops listing it.",
  );
}

if (oversizedGated.length > 0) reportOversizedGated(site, oversizedGated);

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

if (shrunk.length > 0) {
  console.error(
    `\n[size-baseline] ${site}: function sizes fell more than 3MB below baseline:`,
  );
  for (const item of shrunk) {
    console.error(
      `  - ${item.name}: ${mb(item.before)}MB -> ${mb(item.bytes)}MB (-${mb(item.before - item.bytes)}MB)`,
    );
  }
  console.error(
    "This is a warning only. Re-record the baseline after confirming the smaller artifact is intentional.",
  );
}

const newSmallTotal = newSmall.reduce((sum, fn) => sum + fn.bytes, 0);
if (newSmall.length > 0) {
  console.log(
    `\n[size-baseline] ${site}: ${newSmall.length} function(s) not in the baseline, ` +
      `${mb(newSmallTotal)}MB together. Re-record to assert them.`,
  );
}
if (newSmallTotal >= NEW_FUNCTION_FAIL_BYTES) {
  console.error(
    `\n[size-baseline] ${site}: unrecorded functions total ${mb(newSmallTotal)}MB, ` +
      `at or over the ${mb(NEW_FUNCTION_FAIL_BYTES)}MB bar:`,
  );
  for (const fn of newSmall) {
    console.error(`  - ${fn.name}: ${mb(fn.bytes)}MB`);
  }
  console.error(
    "\nEach is small enough to be a conditional trigger entry, but not all of " +
      "them are. Record them so their sizes are asserted:\n" +
      `  pnpm check:function-size-baseline --site ${site} --dir ${functionsDir} --update`,
  );
}

if (
  grown.length > 0 ||
  unrecorded.length > 0 ||
  oversizedGated.length > 0 ||
  newSmallTotal >= NEW_FUNCTION_FAIL_BYTES
) {
  process.exit(1);
}

console.log(`\n[size-baseline] ${site}: no function grew past its baseline.`);
