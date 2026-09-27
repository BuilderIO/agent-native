#!/usr/bin/env node
/**
 * SSR cold-start smoke test.
 *
 * Imports a template's built serverless SSR handler and asserts the
 * server module graph evaluates without throwing. This reproduces the serverless
 * cold-start: the runtime imports the handler at first invocation, and any code
 * that runs browser-only / SSR-incompatible logic at module scope throws here
 * instead of in production.
 *
 * Background: agent-native.com (and forms/slides/clips/videos/…) all 502'd in
 * prod because `@excalidraw/excalidraw` (which touches `window` at module load)
 * leaked into the Nitro server bundle and threw
 * `ReferenceError: window is not defined` at cold-start. Nothing in CI caught it
 * because no PR job boots a deploy bundle. This guard closes that gap.
 *
 * Pass/fail semantics — important:
 *   - The crash class we care about (a `window`/`document` reference at module
 *     scope) throws *during* module evaluation, which rejects the import quickly.
 *   - After evaluation, the handler may kick off async runtime init (DB
 *     connections, migrations, background services) that keeps the process alive.
 *     That is NOT a crash — evaluation already succeeded.
 * So: a thrown error during import => FAIL. A resolve within the evaluation
 * window without throwing => the crash class is absent. We then force-exit to
 * kill any lingering runtime init. The CI step also wraps this in an external
 * `timeout` as a backstop against a pathological synchronous hang.
 *
 * Each configured entry is the pure function handler (it does NOT call
 * `.listen()`), so
 * importing it evaluates the full server module graph without starting a server,
 * and needs no DATABASE_URL/env — the crash happens before any request.
 *
 * Boot budgets — the second reason this job exists:
 *   Not crashing is only half of "the cold start is healthy". Platform init
 *   scales with the deployed artifact: a 78MB Chromium that leaked into the
 *   server bundle (PR #2684) cost users seconds of TTFB on every cold Lambda
 *   and reached production because this job imported the handler and then threw
 *   the two numbers that matter away. So each template also asserts:
 *     1. how long the `await import(...)` itself took, and
 *     2. how many bytes the deployed function directory is.
 *   Both are hard budgets. There is no warn-and-pass tier, and a template we
 *   could not measure (missing artifact, unresolved import, unreadable manifest)
 *   reports NOT MEASURED and exits non-zero — an unmeasured template that reads
 *   like a clean run is exactly how this check would rot.
 *
 * Usage (after `NITRO_PRESET=<preset> pnpm --filter <template> build`):
 *   node scripts/ssr-boot-smoke.mjs [--preset <netlify|vercel|aws-lambda>]
 *     [--report-uncovered] <template> [<template> ...]
 *
 * A target containing `/` is treated as a repo-relative app directory
 * (e.g. `packages/docs`) instead of `templates/<name>`.
 *
 * `--report-uncovered` additionally names every `templates/*` app this run did
 * not build. Building all of them per PR is too slow, so the honest alternative
 * is to say out loud which ones nobody measured rather than let the summary
 * imply the whole fleet is green.
 */
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EVAL_WINDOW_MS = 30_000;
const HANDLER_REL_BY_PRESET = {
  netlify: ".netlify/functions-internal/server/main.mjs",
  vercel: ".vercel/output/functions/__server.func/index.mjs",
  "aws-lambda": ".output/server/index.mjs",
};

const IMPORT_BUDGET_MS = 3_000;

const PAGE_FUNCTION_BUDGET_MB = 80;
const BROWSER_RUNTIME_FUNCTION_BUDGET_MB = 180;

const SIZE_BUDGET_OVERRIDES_MB = {};

const BROWSER_RUNTIME_MARKERS = [
  "@sparticuz/chromium",
  "playwright-core",
  "@agent-native/creative-context",
];
const DEPENDENCY_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "devDependencies",
  "peerDependencies",
];

const MB = 1024 * 1024;

let preset = "netlify";
let reportUncovered = false;
const targets = [];
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === "--preset") {
    preset = process.argv[++i] ?? "";
  } else if (arg === "--report-uncovered") {
    reportUncovered = true;
  } else {
    targets.push(arg);
  }
}
const handlerRel = HANDLER_REL_BY_PRESET[preset];

if (!handlerRel || targets.length === 0) {
  console.error(
    "[ssr-smoke] Usage: node scripts/ssr-boot-smoke.mjs [--preset <netlify|vercel|aws-lambda>] [--report-uncovered] <template> [<template> ...]",
  );
  process.exit(2);
}

function declaresBrowserRuntime(appDir) {
  const manifest = JSON.parse(
    readFileSync(path.join(appDir, "package.json"), "utf8"),
  );
  return BROWSER_RUNTIME_MARKERS.some(
    (name) =>
      DEPENDENCY_FIELDS.some(
        (field) => manifest[field]?.[name] !== undefined,
      ) || existsSync(path.join(appDir, "node_modules", ...name.split("/"))),
  );
}

function annotate(level, message) {
  if (!process.env.GITHUB_ACTIONS) return;
  console.log(`::${level}::${message.replaceAll("\n", "%0A")}`);
}

/**
 * Bytes under `dir`, attributed to the directory that owns them: a top-level
 * entry of `dir`, or the `name` / `@scope/name` package under any node_modules.
 * Nested node_modules re-attribute to the inner package, so a hoisted payload is
 * named where it actually lives.
 *
 * Symlinks are measured as links and never followed — a traced node_modules
 * tree is full of them, and following would double-count or escape the artifact.
 */
function measureDir(dir) {
  const byPackage = new Map();
  let total = 0;

  const walk = (current, owner, place) => {
    for (const dirent of readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, dirent.name);

      let childOwner = owner;
      let childPlace = "owned";
      if (dirent.name === "node_modules" && dirent.isDirectory()) {
        childOwner = undefined;
        childPlace = "packages";
      } else if (place === "packages") {
        childOwner = dirent.name;
        if (dirent.name.startsWith("@")) childPlace = "scoped";
      } else if (place === "scoped") {
        childOwner = `${owner}/${dirent.name}`;
      }

      if (dirent.isDirectory()) {
        walk(child, childOwner, childPlace);
        continue;
      }
      const size = lstatSync(child).size;
      total += size;
      const key = childOwner ?? dirent.name;
      byPackage.set(key, (byPackage.get(key) ?? 0) + size);
    }
  };

  walk(dir, undefined, "packages");
  return { total, byPackage };
}

function formatBreakdown(byPackage) {
  return [...byPackage.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, bytes]) => `${name} ${(bytes / MB).toFixed(1)}MB`)
    .join(", ");
}

const results = [];

for (const target of targets) {
  const appDir = target.includes("/")
    ? path.resolve(target)
    : path.resolve("templates", target);
  const entry = path.join(appDir, handlerRel);
  const serverDir = path.dirname(entry);

  if (!existsSync(entry)) {
    results.push({
      target,
      status: "not-measured",
      reason: `no built handler at ${entry}`,
      hint: `Run \`NITRO_PRESET=${preset} pnpm --filter ${target} build\` first.`,
    });
    continue;
  }

  const override = SIZE_BUDGET_OVERRIDES_MB[`${preset}/${target}`];
  let budgetMb = override;
  let budgetWhy = "per-target override";
  if (budgetMb === undefined) {
    let shipsBrowser;
    try {
      shipsBrowser = declaresBrowserRuntime(appDir);
    } catch (err) {
      results.push({
        target,
        status: "not-measured",
        reason: `cannot read ${target}/package.json, so the size budget is unknown: ${String(err?.message ?? err)}`,
        hint: "Fix the manifest — an unreadable one is not the same as an app with no browser runtime.",
      });
      continue;
    }
    budgetMb = shipsBrowser
      ? BROWSER_RUNTIME_FUNCTION_BUDGET_MB
      : PAGE_FUNCTION_BUDGET_MB;
    budgetWhy = shipsBrowser
      ? "declares the serverless browser runtime"
      : "no browser runtime";
  }

  const startedAt = performance.now();
  const outcome = await Promise.race([
    import(pathToFileURL(entry).href).then(
      () => ({ kind: "resolved" }),
      (err) => ({ kind: "threw", err }),
    ),
    new Promise((resolve) =>
      setTimeout(() => resolve({ kind: "still-pending" }), EVAL_WINDOW_MS),
    ),
  ]);
  const importMs = Math.round(performance.now() - startedAt);

  if (outcome.kind === "threw") {
    const err = outcome.err;
    const name = err?.constructor?.name ?? "Error";
    const message = String(err?.message ?? err).split("\n")[0];
    results.push({
      target,
      status: "failed",
      reason: `server handler threw at module load: ${name}: ${message}`,
      stack: err?.stack,
    });
    continue;
  }

  if (outcome.kind === "still-pending") {
    results.push({
      target,
      status: "not-measured",
      reason: `import did not settle within ${EVAL_WINDOW_MS / 1000}s, so boot time is unknown`,
      hint: "No module-load crash was observed, but the budget was never applied.",
    });
    continue;
  }

  const { total, byPackage } = measureDir(serverDir);
  const totalMb = total / MB;
  const measurement =
    `import ${importMs}ms, ${totalMb.toFixed(0)}MB function dir ` +
    `(budget ${budgetMb}MB — ${budgetWhy})`;

  const overBudget = [];
  if (importMs > IMPORT_BUDGET_MS) {
    overBudget.push(`import took ${importMs}ms (budget ${IMPORT_BUDGET_MS}ms)`);
  }
  if (totalMb > budgetMb) {
    overBudget.push(
      `function dir is ${totalMb.toFixed(0)}MB (budget ${budgetMb}MB — ${budgetWhy})`,
    );
  }

  results.push({
    target,
    status: overBudget.length > 0 ? "failed" : "passed",
    reason: overBudget.length > 0 ? overBudget.join("; ") : measurement,
    breakdown: overBudget.length > 0 ? formatBreakdown(byPackage) : undefined,
  });
}

for (const result of results) {
  const label = {
    passed: "OK",
    failed: "FAILED",
    "not-measured": "NOT MEASURED",
  }[result.status];
  const log = result.status === "passed" ? console.log : console.error;
  log(`[ssr-smoke] ${result.target}: ${label} — ${result.reason}`);
  if (result.status !== "passed") {
    annotate(
      result.status === "failed" ? "error" : "warning",
      `[ssr-smoke] ${result.target}: ${label} — ${result.reason}`,
    );
  }
  if (result.breakdown) {
    log(`            largest: ${result.breakdown}`);
  }
  if (result.hint) {
    log(`            ${result.hint}`);
  }
  if (result.stack) {
    log(
      result.stack
        .split("\n")
        .slice(0, 6)
        .map((line) => "            " + line)
        .join("\n"),
    );
  }
}

const failedCount = results.filter((r) => r.status === "failed").length;
const unmeasuredCount = results.filter(
  (r) => r.status === "not-measured",
).length;
const passedCount = results.filter((r) => r.status === "passed").length;
let uncoveredCount = 0;

console.error(
  `\n[ssr-smoke] ${passedCount} passed, ${failedCount} failed, ${unmeasuredCount} not measured (of ${results.length}).`,
);

if (reportUncovered) {
  const templatesDir = path.resolve("templates");
  const allTemplates = readdirSync(templatesDir, { withFileTypes: true })
    .filter(
      (dirent) =>
        dirent.isDirectory() &&
        existsSync(path.join(templatesDir, dirent.name, "package.json")),
    )
    .map((dirent) => dirent.name)
    .sort();
  const uncovered = allTemplates.filter((name) => !targets.includes(name));
  uncoveredCount = uncovered.length;

  if (uncovered.length > 0) {
    const headline =
      `[ssr-smoke] NOT COVERED — ${uncovered.length} of ${allTemplates.length} templates were never built ` +
      `in this run, so no boot or size budget was applied to them: ${uncovered.join(", ")}`;
    console.error(`\n${headline}`);
    console.error(
      "            Not a pass. Add one to the build set above when it starts\n" +
        "            carrying real SSR risk; its budget is derived, not configured.",
    );
    annotate("warning", headline);
  }
}

if (failedCount > 0) {
  console.error(
    "[ssr-smoke] A handler crashed at module load, took too long to import, or\n" +
      "shipped an oversized function directory. These are cold-start costs users\n" +
      "pay on every cache miss: look for browser-only code (window/document) or a\n" +
      "browser/binary payload reaching the server bundle.",
  );
  process.exit(1);
}

if (unmeasuredCount > 0) {
  console.error(
    "[ssr-smoke] Some targets were never measured. That is not a pass — the\n" +
      "boot budgets did not run for them.",
  );
  process.exit(3);
}

if (uncoveredCount > 0) {
  console.error(
    "[ssr-smoke] The requested coverage report found templates that were not measured.",
  );
  process.exit(3);
}

console.log(
  "[ssr-smoke] All SSR handlers evaluated cleanly and within budget.",
);
process.exit(0);
