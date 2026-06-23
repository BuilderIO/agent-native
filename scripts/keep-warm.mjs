#!/usr/bin/env node
// Pings every first-party app's /_agent-native/health endpoint so the
// scale-to-zero serverless databases behind them (Neon, Supabase) stay warm
// and the next real user request doesn't pay a multi-second cold-start.
//
// Driven off packages/shared-app-config/templates.ts (the single source of
// truth for prodUrls) so new apps are covered automatically. Pure Node, no
// dependencies or install step — safe to run on a bare `actions/setup-node`
// runner or locally:
//
//   node scripts/keep-warm.mjs            # ping every app's prod health route
//   node scripts/keep-warm.mjs plan mail  # ping only the named apps
//
// Exits 0 when at least one app responded (single hiccups are logged, not
// fatal); exits 1 only if EVERY app failed, which signals the pinger or
// network — not one app — is broken.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = resolve(HERE, "../packages/shared-app-config/templates.ts");
const HEALTH_PATH = "/_agent-native/health";
const PER_REQUEST_TIMEOUT_MS = 25_000; // Neon pooler cold-start can take ~10s.
const ATTEMPTS = 2;

/** Extract { name, prodUrl } pairs from the registry source without importing TS. */
async function readApps() {
  const src = await readFile(REGISTRY, "utf8");
  const apps = [];
  // Each template literal block has a `name: "x"` and may have `prodUrl: "https://..."`.
  const blockRe = /\{\s*name:\s*"([^"]+)"[\s\S]*?\}/g;
  for (const block of src.matchAll(blockRe)) {
    const name = block[1];
    const prodUrl = /prodUrl:\s*"([^"]+)"/.exec(block[0])?.[1];
    if (prodUrl) apps.push({ name, prodUrl });
  }
  return apps;
}

async function pingOnce(url) {
  const startedAt = Date.now();
  const res = await fetch(url, {
    method: "GET",
    headers: { "user-agent": "agent-native-keep-warm" },
    signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
  });
  const ms = Date.now() - startedAt;
  let db;
  try {
    db = (await res.json())?.db;
  } catch {
    // Non-JSON body (e.g. an error page) — still counts as the function awake.
  }
  return { status: res.status, ok: res.ok, db, ms };
}

async function pingApp({ name, prodUrl }) {
  const url = `${prodUrl.replace(/\/$/, "")}${HEALTH_PATH}`;
  let lastErr;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const r = await pingOnce(url);
      if (r.ok) return { name, ok: true, ...r };
      lastErr = `HTTP ${r.status}`;
    } catch (err) {
      lastErr =
        err?.name === "TimeoutError" ? "timeout" : String(err?.message ?? err);
    }
  }
  return { name, ok: false, error: lastErr };
}

async function main() {
  const filter = process.argv.slice(2);
  let apps = await readApps();
  if (filter.length) apps = apps.filter((a) => filter.includes(a.name));
  if (!apps.length) {
    console.error(
      filter.length
        ? `No matching apps for: ${filter.join(", ")}`
        : "No apps with a prodUrl found in the registry.",
    );
    process.exit(1);
  }

  const results = await Promise.all(apps.map(pingApp));
  results.sort((a, b) => a.name.localeCompare(b.name));

  let warmed = 0;
  for (const r of results) {
    if (r.ok) {
      warmed++;
      const dbState =
        r.db === true ? "db:warm" : r.db === false ? "db:none" : "db:?";
      console.log(
        `  ✓ ${r.name.padEnd(12)} ${String(r.ms).padStart(5)}ms  ${dbState}`,
      );
    } else {
      console.log(`  ✗ ${r.name.padEnd(12)} ${r.error}`);
    }
  }
  console.log(`\nWarmed ${warmed}/${results.length} apps.`);

  // Only fail the run if nothing responded — that points at the pinger/network,
  // not at one app having a transient cold start.
  if (warmed === 0) process.exit(1);
}

main().catch((err) => {
  console.error("keep-warm failed:", err);
  process.exit(1);
});
