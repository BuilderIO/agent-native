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
/**
 * The committed baseline. Overridable only so the guard's own test can record
 * and compare against a throwaway file instead of the tracked one — a test that
 * had to `--update` the real baseline would rewrite the thing it is asserting.
 */
const BASELINE_FILE =
  process.env.AGENT_NATIVE_FUNCTION_SIZE_BASELINE_FILE ||
  path.join(REPO_ROOT, "scripts", "serverless-function-baseline.json");

/**
 * Growth under this is normal drift — a dependency patch, a few new routes.
 * Above it is the shape that has actually hurt: a package tree arriving in the
 * function graph. Both bounds must be exceeded, so a small function is not
 * tripped by a rounding-scale change.
 */
const TOLERANCE_RATIO = 1.1;
const TOLERANCE_BYTES = 5 * 1024 * 1024;

/**
 * A function the baseline has never seen fails only from here up.
 *
 * Conditionally emitted functions are ordinary: AGENT_NATIVE_ENABLE_KEEP_WARM,
 * AGENT_INTEGRATION_DURABLE_DISPATCH, AGENT_CHAT_DURABLE_BACKGROUND and
 * AGENT_NATIVE_DISABLE_RECURRING_JOBS each add or remove one, so which
 * functions exist is a property of the deploy's configuration, not a
 * regression. Failing on the name means every flag not enumerated breaks a
 * deploy. Failing on the size means the risk that motivated the check — a large
 * new payload shipping unmeasured — is still caught, and a new trigger entry
 * is just reported.
 */
const NEW_FUNCTION_FAIL_BYTES = 5 * 1024 * 1024;

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
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

/**
 * Functions emitted only when a build flag is set, so whether they exist
 * differs between a local build and a deploy. They can be neither recorded nor
 * missed reliably: baseline one and every build without the flag fails
 * "no longer emitted"; leave it out and every build with the flag fails
 * "not in baseline".
 *
 * So their absence is never a failure — but their presence still has to be
 * bounded, or the exemption becomes somewhere a payload can hide. Each entry
 * carries the ceiling that applies whenever it IS emitted:
 *
 *   bytes    a fixed ceiling, for trigger-sized entries
 *   like     the name of another function it is derived from and can never
 *            legitimately exceed
 */
const BUILD_FLAG_GATED_FUNCTIONS = new Map([
  [
    "agent-native-keep-warm",
    {
      // A scheduled ping, 4KB today. AGENT_NATIVE_ENABLE_KEEP_WARM=1 in the
      // beta workflow; a plain local build does not emit it.
      bytes: 1024 * 1024,
      why: "a scheduled trigger entry, not a bundle",
    },
  ],
  [
    "server-integration-recovery",
    {
      // AGENT_INTEGRATION_DURABLE_DISPATCH, which no workflow sets today but a
      // Netlify site env var can. It is a clone of the server function with the
      // SSR island pruned, so server is the ceiling it cannot legitimately pass.
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

/**
 * Gated functions in `measured` that exceed their ceiling. Every exit path runs
 * this — including --update and the unmeasurable-app allowance — because a
 * ceiling only enforced on one path is not a ceiling.
 */
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

/**
 * Payloads whose presence is decided by the deploy environment rather than by
 * anything in the app, so the same commit emits them in one build context and
 * not another. These are reported, never subtracted — see below for why.
 *
 * `ffmpeg-static` is bundled only when `AGENT_NATIVE_SERVERLESS_FFMPEG_ARCH`
 * names an architecture matching the serverless target (`build.ts`,
 * `shouldBundleFfmpegStaticForServerless`). Production sets it, beta does not,
 * and the gap is ~76MB per emitted function.
 *
 * One baseline map serves both contexts, so whichever context recorded it last
 * decides what the other is measured against, and it fails in both directions:
 *
 *   - Recorded on beta, checked on production: clips read 112.6MB against a
 *     36.1MB baseline. Every production promotion of the media apps failed on
 *     a 76MB "regression" that was the same binary both builds intended, and
 *     clips served a stale build for two days because of it.
 *   - Recorded on production, checked on beta: the inverse, and worse, because
 *     it fails open — beta can absorb a real 76MB regression unnoticed.
 *
 * Printing the split does not fix that. It makes an otherwise inexplicable
 * ±76MB swing legible at the moment someone hits it, which is the part that
 * cost two days. Subtracting it here would NOT be safe while the committed
 * baselines are a mix of both units: a build measured after subtraction and
 * compared against a payload-inclusive baseline silently passes anything under
 * the payload's own size. Making the metric context-independent means
 * recording every baseline in one unit — a change to the baseline format, not
 * to this measurement.
 */
const DEPLOY_GATED_RUNTIME_PAYLOADS = [
  {
    relativePath: path.join("node_modules", "ffmpeg-static"),
    reason: "bundled only when AGENT_NATIVE_SERVERLESS_FFMPEG_ARCH matches",
  },
];

/** Deploy-gated payloads present in one emitted function, for reporting. */
function deployGatedPayloads(functionDir) {
  const found = [];
  for (const payload of DEPLOY_GATED_RUNTIME_PAYLOADS) {
    const payloadDir = path.join(functionDir, payload.relativePath);
    if (!existsSync(payloadDir)) continue;
    found.push({ ...payload, bytes: dirSize(payloadDir) });
  }
  return found;
}

function measure(functionsDir) {
  const sizes = {};
  const gated = [];
  for (const entry of readdirSync(functionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const functionDir = path.join(functionsDir, entry.name);
    sizes[entry.name] = dirSize(functionDir);
    for (const payload of deployGatedPayloads(functionDir)) {
      gated.push({ fn: entry.name, ...payload });
    }
  }
  if (gated.length > 0) {
    console.log(
      `\n[size-baseline] ${gated.length} deploy-gated runtime payload(s) are in this ` +
        "build and counted in the sizes below. A baseline recorded in the other " +
        "build context differs by this much before any app code changes:",
    );
    for (const item of gated) {
      console.log(
        `  ${item.fn}: ${item.relativePath} ${mb(item.bytes)}MB (${item.reason})`,
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
  // Recording is how a size becomes the thing future builds are measured
  // against, so it must not be the way an over-ceiling gated function gets
  // written in and normalised.
  const over = oversizedGatedFunctions(measured, baseline[site]);
  if (over.length > 0) {
    reportOversizedGated(site, over);
    console.error("\nRefusing to record it.");
    process.exit(1);
  }
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
    // The app-level allowance waives the baseline, never a gated function's own
    // ceiling: an allowance is for a size nobody has measured, not a licence
    // for one that is measured and too big.
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
const unrecorded = [];
const oversizedGated = [];
const newSmall = [];
for (const [name, bytes] of Object.entries(measured).sort()) {
  const before = recorded[name];
  // The ceiling applies whether or not the function is recorded. Being in the
  // baseline would otherwise buy it the general tolerance, where both bounds
  // must be exceeded — so a 4KB trigger entry could reach 5MB unchallenged,
  // the opposite of what the ceiling is for.
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
    // A function the baseline has never seen is unmeasured, so it cannot be
    // asserted — but whether that matters is a question of bytes, not of
    // which build flag produced it. Enumerating the conditional functions was
    // the losing version of this: there are at least five build flags that add
    // or remove one, and every flag missed from the list breaks a deploy.
    // Bound the thing that actually matters instead. A brand new 100MB
    // function still cannot ship unchallenged; a new trigger entry is noise.
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
}

// A function in the baseline that the build no longer emits is not a pass. It
// is a route, cron, or background worker that silently stopped shipping, and
// "nothing grew" is exactly the wrong thing to say about it.
// Reported, never failed. A function is absent because a feature is switched
// off for this deploy at least as often as because something broke, and an
// absence is not a size regression either way. Failing here would make a
// legitimate configuration — durable background off, recurring jobs disabled —
// unable to deploy.
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

// Individually under the bar, together over it. Without this, an unbounded
// number of small unrecorded functions ships unasserted, which is the same
// hole the per-function bar closes, arrived at by addition.
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
