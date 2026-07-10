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
 * So: a thrown error during import => FAIL. A resolve OR getting past a short
 * evaluation window without throwing => PASS. We then force-exit to kill any
 * lingering runtime init. The CI step also wraps this in an external `timeout`
 * as a backstop against a pathological synchronous hang during evaluation.
 *
 * Each configured entry is the pure function handler (it does NOT call
 * `.listen()`), so
 * importing it evaluates the full server module graph without starting a server,
 * and needs no DATABASE_URL/env — the crash happens before any request.
 *
 * Usage (after `NITRO_PRESET=<preset> pnpm --filter <template> build`):
 *   node scripts/ssr-boot-smoke.mjs [--preset <netlify|vercel|aws-lambda>] <template> [<template> ...]
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// How long to wait for the synchronous crash to surface. Module evaluation (and
// thus any `window is not defined`-style throw) happens almost immediately; if
// we get this far without a rejection, the dangerous code did not run.
const EVAL_WINDOW_MS = 30_000;
const HANDLER_REL_BY_PRESET = {
  netlify: ".netlify/functions-internal/server/main.mjs",
  vercel: ".vercel/output/functions/__server.func/index.mjs",
  "aws-lambda": ".output/server/index.mjs",
};

let args = process.argv.slice(2);
let preset = "netlify";
if (args[0] === "--preset") {
  preset = args[1] ?? "";
  args = args.slice(2);
}
const handlerRel = HANDLER_REL_BY_PRESET[preset];

if (!handlerRel || args.length === 0) {
  console.error(
    "[ssr-smoke] Usage: node scripts/ssr-boot-smoke.mjs [--preset <netlify|vercel|aws-lambda>] <template> [<template> ...]",
  );
  process.exit(2);
}

const templates = args;

let failed = false;

for (const template of templates) {
  const entry = path.resolve("templates", template, handlerRel);

  if (!existsSync(entry)) {
    console.error(
      `[ssr-smoke] ${template}: MISSING built handler at ${entry}\n` +
        `            Run \`NITRO_PRESET=${preset} pnpm --filter ${template} build\` first.`,
    );
    failed = true;
    continue;
  }

  const outcome = await Promise.race([
    import(pathToFileURL(entry).href).then(
      (mod) => ({ kind: "resolved", mod }),
      (err) => ({ kind: "threw", err }),
    ),
    new Promise((resolve) =>
      setTimeout(() => resolve({ kind: "eval-window-passed" }), EVAL_WINDOW_MS),
    ),
  ]);

  if (outcome.kind === "threw") {
    const err = outcome.err;
    const name = err?.constructor?.name ?? "Error";
    const message = String(err?.message ?? err).split("\n")[0];
    console.error(
      `[ssr-smoke] ${template}: FAILED — server handler threw at module load: ${name}: ${message}`,
    );
    if (err?.stack) {
      console.error(
        err.stack
          .split("\n")
          .slice(0, 6)
          .map((line) => "            " + line)
          .join("\n"),
      );
    }
    failed = true;
  } else if (outcome.kind === "resolved") {
    console.log(
      `[ssr-smoke] ${template}: OK — server handler imported cleanly (no module-load crash)`,
    );
  } else {
    console.log(
      `[ssr-smoke] ${template}: OK — evaluated for ${EVAL_WINDOW_MS / 1000}s with no module-load crash (handler still initializing; that's fine)`,
    );
  }
}

if (failed) {
  console.error(
    "\n[ssr-smoke] An SSR handler crashed at module load — this is the class of\n" +
      "bug that 502s production sites at cold-start. Look for browser-only code\n" +
      "(window/document) reaching the server bundle.",
  );
  // Force-exit non-zero, killing any lingering async runtime init.
  process.exit(1);
}

console.log("[ssr-smoke] All SSR handlers evaluated cleanly.");
// Force-exit so lingering DB connections / background services don't keep the
// process (and the CI step) alive.
process.exit(0);
