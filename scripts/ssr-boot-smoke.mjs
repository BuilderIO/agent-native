#!/usr/bin/env node
/**
 * SSR cold-start smoke test.
 *
 * Imports a template's built Netlify SSR handler (`main.mjs`) and asserts it
 * loads without throwing. This reproduces exactly the serverless cold-start the
 * runtime does — the module graph is evaluated at first invocation — so any code
 * that runs browser-only / SSR-incompatible logic at module scope crashes here
 * instead of in production.
 *
 * Background: agent-native.com (and forms/slides/clips/videos/…) all 502'd in
 * prod because `@excalidraw/excalidraw` (which touches `window` at module load)
 * leaked into the Nitro server bundle and threw
 * `ReferenceError: window is not defined` at cold-start. Nothing in CI caught it
 * because no PR job boots a deploy bundle. This guard closes that gap: build the
 * template with the netlify preset, then import its handler here.
 *
 * Why `main.mjs`: it is the pure function handler and does NOT call `.listen()`,
 * so importing it evaluates the full server module graph without starting (and
 * hanging on) an HTTP server. It needs no DATABASE_URL / env because the crash
 * class happens at module evaluation, before any request is handled.
 *
 * Usage (after `NITRO_PRESET=netlify pnpm --filter <template> build`):
 *   node scripts/ssr-boot-smoke.mjs <template> [<template> ...]
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const templates = process.argv.slice(2);
if (templates.length === 0) {
  console.error(
    "[ssr-smoke] Usage: node scripts/ssr-boot-smoke.mjs <template> [<template> ...]",
  );
  process.exit(2);
}

const HANDLER_REL = ".netlify/functions-internal/server/main.mjs";
let failed = false;

for (const template of templates) {
  const entry = path.resolve("templates", template, HANDLER_REL);

  if (!existsSync(entry)) {
    console.error(
      `[ssr-smoke] ${template}: MISSING built handler at ${entry}\n` +
        `            Run \`NITRO_PRESET=netlify pnpm --filter ${template} build\` first.`,
    );
    failed = true;
    continue;
  }

  // Guard against a handler that hangs at import (e.g. top-level await on a
  // resource that never resolves) — that would otherwise stall CI silently.
  const hangTimer = setTimeout(() => {
    console.error(
      `[ssr-smoke] ${template}: handler still loading after 60s — treating as a hang`,
    );
    process.exit(1);
  }, 60_000);
  hangTimer.unref?.();

  try {
    const mod = await import(pathToFileURL(entry).href);
    clearTimeout(hangTimer);
    if (typeof mod.default !== "function") {
      throw new Error(
        `handler imported but default export is ${typeof mod.default}, expected a function`,
      );
    }
    console.log(
      `[ssr-smoke] ${template}: OK — server handler imported with no module-load crash`,
    );
  } catch (error) {
    clearTimeout(hangTimer);
    const name = error?.constructor?.name ?? "Error";
    const message = String(error?.message ?? error).split("\n")[0];
    console.error(
      `[ssr-smoke] ${template}: FAILED at module load — ${name}: ${message}`,
    );
    if (error?.stack) {
      console.error(
        error.stack
          .split("\n")
          .slice(0, 6)
          .map((line) => "            " + line)
          .join("\n"),
      );
    }
    failed = true;
  }
}

if (failed) {
  console.error(
    "\n[ssr-smoke] One or more SSR handlers failed to boot. This is the class of\n" +
      "bug that 502s production sites at cold-start. Check for browser-only code\n" +
      "(window/document) reaching the server bundle.",
  );
  process.exit(1);
}

console.log("[ssr-smoke] All SSR handlers booted cleanly.");
