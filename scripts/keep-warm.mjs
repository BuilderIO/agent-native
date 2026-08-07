#!/usr/bin/env node
// Audits every first-party app's /_agent-native/health endpoint. Production
// warming happens inside each site's Netlify Scheduled Function because GitHub
// Actions cron runs can be delayed longer than a scale-to-zero database's
// autosuspend window.
//
// /_agent-native/health only proves the database is reachable — it stays
// green through the single most-repeated production report (15+ times, 9+
// people, 3 months): the app loads but the agent stalls and nothing renders
// right. --strict runs also GET the public SSR shell at prodUrl and assert
// it actually rendered (2xx after redirects, body has `<html`, no known
// error-page markers), so that outage shows up here instead of only in Slack.
//
// Driven off packages/shared-app-config/templates.ts (the single source of
// truth for prodUrls) so new apps are covered automatically. Pure Node, no
// dependencies or install step — safe to run on a bare `actions/setup-node`
// runner or locally:
//
//   node scripts/keep-warm.mjs            # audit every app's prod health route
//   node scripts/keep-warm.mjs plan mail  # audit only the named apps
//   node scripts/keep-warm.mjs --strict   # also fail on an unhealthy or unrendered app
//
// Ordinary runs preserve the old best-effort behavior (health only, no shell
// fetch). Use --strict for monitoring so a partial outage cannot be reported
// as healthy.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = resolve(HERE, "../packages/shared-app-config/templates.ts");
const HEALTH_PATH = "/_agent-native/health";
const PER_REQUEST_TIMEOUT_MS = 25_000; // Neon pooler cold-start can take ~10s.
const ATTEMPTS = 2;
/**
 * A health route that answers, but slowly, is a warning — not a pass.
 * Every check we owned reported UP while the docs site degraded from ~60ms to
 * 10s, because up/down was the only thing measured. Healthy apps answer in
 * a few hundred ms; this fires well above that so it means "something is
 * wrong", not "traffic is busy".
 */
const SLOW_HEALTH_MS = 3_000;

/** Extract visible hosted { name, prodUrl } pairs without importing TS. */
async function readApps() {
  const src = await readFile(REGISTRY, "utf8");
  const apps = [];
  // Each template literal block has a `name: "x"` and may have `prodUrl: "https://..."`.
  const blockRe = /\{\s*name:\s*"([^"]+)"[\s\S]*?\}/g;
  for (const block of src.matchAll(blockRe)) {
    const name = block[1];
    const prodUrl = /prodUrl:\s*"([^"]+)"/.exec(block[0])?.[1];
    const hidden = /\bhidden:\s*true\b/.test(block[0]);
    if (prodUrl && !hidden) apps.push({ name, prodUrl });
  }
  // The public marketing/docs site is not a template, so it appeared in no
  // registry and therefore in no monitor. It went permanently cold behind a
  // hanging health route — cache misses cost ~10x — and every check we owned
  // stayed green because nothing was checking it at all.
  apps.push({ name: "docs", prodUrl: "https://www.agent-native.com" });
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
  let ready;
  try {
    const body = await res.json();
    db = body?.db;
    ready = body?.ready;
  } catch {
    // Non-JSON body (e.g. an error page) — still counts as the function awake.
  }
  return { status: res.status, ok: res.ok, db, ready, ms };
}

async function pingApp({ name, prodUrl }, strict) {
  const healthPath = strict ? `${HEALTH_PATH}?strict=1` : HEALTH_PATH;
  const url = `${prodUrl.replace(/\/$/, "")}${healthPath}`;
  let lastErr;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const r = await pingOnce(url);
      if (r.ok && (!strict || (r.db === true && r.ready === true))) {
        return { name, ok: true, ...r };
      }
      lastErr = r.ok
        ? r.db !== true
          ? "db unavailable"
          : "not ready"
        : `HTTP ${r.status}`;
    } catch (err) {
      lastErr =
        err?.name === "TimeoutError" ? "timeout" : String(err?.message ?? err);
    }
  }
  return { name, ok: false, error: lastErr };
}

const SHELL_FAILURE_MARKERS = [
  "Application error",
  "Internal Server Error",
  "502 Bad Gateway",
  "Service Unavailable",
  "Deploy failed",
];

async function fetchShellOnce(prodUrl) {
  const startedAt = Date.now();
  const res = await fetch(prodUrl, {
    method: "GET",
    headers: { "user-agent": "agent-native-keep-warm" },
    signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
  });
  const ms = Date.now() - startedAt;
  const body = await res.text();
  if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}` };
  if (!body.toLowerCase().includes("<html")) {
    return { ok: false, ms, error: "response missing <html shell" };
  }
  const marker = SHELL_FAILURE_MARKERS.find((m) => body.includes(m));
  if (marker) return { ok: false, ms, error: `body contains "${marker}"` };
  return { ok: true, ms };
}

async function checkShell({ name, prodUrl }) {
  let lastErr;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const r = await fetchShellOnce(prodUrl);
      if (r.ok) return { name, ok: true, ms: r.ms };
      lastErr = r.error;
    } catch (err) {
      lastErr =
        err?.name === "TimeoutError" ? "timeout" : String(err?.message ?? err);
    }
  }
  return { name, ok: false, error: lastErr };
}

async function main() {
  const strict = process.argv.includes("--strict");
  const filter = process.argv.slice(2).filter((arg) => arg !== "--strict");
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

  const results = await Promise.all(apps.map((app) => pingApp(app, strict)));
  results.sort((a, b) => a.name.localeCompare(b.name));

  // Shell-render check only runs in --strict mode: ordinary runs exist to
  // warm the function, not to monitor, and shouldn't pay for the extra
  // request.
  const shellResults = strict
    ? await Promise.all(apps.map((app) => checkShell(app)))
    : [];
  const shellByName = new Map(shellResults.map((r) => [r.name, r]));

  let warmed = 0;
  const slowApps = [];
  for (const r of results) {
    const shell = shellByName.get(r.name);
    const ok = r.ok && (!shell || shell.ok);
    if (ok) {
      warmed++;
      const dbState =
        r.db === true ? "db:warm" : r.db === false ? "db:none" : "db:?";
      const shellState = shell ? ` shell:${shell.ms}ms` : "";
      const slow =
        r.ms > SLOW_HEALTH_MS || (shell && shell.ms > SLOW_HEALTH_MS);
      console.log(
        `  ${slow ? "!" : "✓"} ${r.name.padEnd(12)} ${String(r.ms).padStart(5)}ms  ${dbState}${shellState}${
          slow ? `  SLOW (>${SLOW_HEALTH_MS}ms — cold or degrading)` : ""
        }`,
      );
      if (slow) slowApps.push(r.name);
    } else {
      const reason = !r.ok ? r.error : `shell: ${shell.error}`;
      console.log(`  ✗ ${r.name.padEnd(12)} ${reason}`);
    }
  }
  console.log(`\nWarmed ${warmed}/${results.length} apps.`);

  if (slowApps.length > 0) {
    console.log(
      `  slow: ${slowApps.join(", ")} — answered, but far above a healthy app's few hundred ms.`,
    );
  }

  // Slow counts as a failure under --strict. "It responded" is the check that
  // let a 10-second page look healthy for weeks.
  if (strict && slowApps.length > 0) process.exit(1);
  if (strict ? warmed !== results.length : warmed === 0) process.exit(1);
}

main().catch((err) => {
  console.error("keep-warm failed:", err);
  process.exit(1);
});
