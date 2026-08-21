#!/usr/bin/env node
/**
 * Assert, against the live fleet, that a cache MISS is still cacheable.
 *
 * Every other check in this repo reads source or build output. This one reads
 * production, because the regression it exists for was invisible to both:
 * `isSsrHtmlOrDataResponse` excluded every status >= 400, so not-found shells
 * shipped `cache-control: no-cache` and Netlify stored nothing. The same dead
 * URL cost a full cold render on every request — measured repeatedly at ~5s on
 * www.agent-native.com — and because Netlify runs one request per container,
 * those invocations drew from the account-wide concurrency pool every other
 * site shares. Source looked fine. Builds were green. Only production knew.
 *
 * The assertion is deliberately narrow: an unknown URL must not answer with a
 * cache-control that forbids storage. It does NOT assert a latency number,
 * which would page on cold starts and ordinary network variance, and it does
 * not care what status the app chooses for an unknown path.
 *
 * Usage: node scripts/check-production-cache-contract.mjs [--env production|beta|all]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Directives that stop a shared cache from storing the response at all. */
const UNCACHEABLE = ["no-store", "no-cache", "private"];

const REQUEST_TIMEOUT_MS = 30_000;
const HOST_CONCURRENCY = 8;

function parseEnvArg() {
  const index = process.argv.indexOf("--env");
  const value = index === -1 ? "production" : process.argv[index + 1];
  if (!["production", "beta", "all"].includes(value ?? "")) {
    throw new Error(`--env must be production, beta, or all (got ${value})`);
  }
  return value;
}

/** A single explicit host, so a deploy can check only the site it published. */
function parseHostArg() {
  const index = process.argv.indexOf("--host");
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--host requires a hostname");
  }
  return value.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function hostsFor(environment) {
  const manifest = JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, "scripts/netlify-site-hosts.json"),
      "utf8",
    ),
  );
  if (environment === "all") {
    return [...manifest.production, ...manifest.beta];
  }
  return manifest[environment] ?? [];
}

async function probe(host) {
  // A path no app can have a route for, unique per run so it is a genuine miss.
  const url = `https://${host}/__cache-contract-probe-${Date.now()}-${Math.floor(
    Math.random() * 1e9,
  )}`;
  let response;
  try {
    response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Unreachable is a distinct outcome from misconfigured. Availability is
    // the sibling monitor's job, so this reports and does not fail the run.
    return {
      host,
      outcome: "unreachable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const cacheControl = response.headers.get("cache-control");
  if (!cacheControl) {
    return {
      host,
      outcome: "violation",
      status: response.status,
      detail:
        "no cache-control header (a Netlify function response is uncached by default)",
    };
  }
  const normalized = cacheControl.toLowerCase();
  const offending = UNCACHEABLE.filter((directive) =>
    normalized.includes(directive),
  );
  if (offending.length > 0) {
    return {
      host,
      outcome: "violation",
      status: response.status,
      detail: `cache-control: ${cacheControl}`,
    };
  }
  return { host, outcome: "ok", status: response.status, detail: cacheControl };
}

async function mapWithLimit(items, limit, worker) {
  const results = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

const explicitHost = parseHostArg();
const environment = explicitHost ? undefined : parseEnvArg();
const hosts = explicitHost ? [explicitHost] : hostsFor(environment);
if (hosts.length === 0) {
  console.error(`No hosts found for --env ${environment}.`);
  process.exit(2);
}

const results = await mapWithLimit(hosts, HOST_CONCURRENCY, probe);
const violations = results.filter((r) => r.outcome === "violation");
const unreachable = results.filter((r) => r.outcome === "unreachable");

for (const r of results) {
  const label =
    r.outcome === "ok" ? "ok  " : r.outcome === "violation" ? "FAIL" : "skip";
  console.log(`${label} ${r.host.padEnd(40)} ${r.status ?? "-"} ${r.detail}`);
}

if (unreachable.length > 0) {
  console.log(
    `\n${unreachable.length} host(s) unreachable; reported, not failed (availability is monitor-agent-native-sites.yml's job).`,
  );
}

if (violations.length > 0) {
  console.error(
    `\ncheck-production-cache-contract FAILED for ${violations.length} host(s):`,
  );
  for (const v of violations) console.error(`  - ${v.host}: ${v.detail}`);
  console.error(
    "\nAn unknown URL that cannot be stored re-invokes the render function on\n" +
      "every request, and Netlify runs one request per container — so this\n" +
      "drains the concurrency pool shared by every other site on the account.\n" +
      "See isSsrHtmlOrDataResponse in packages/core/src/server/ssr-handler.ts.",
  );
  process.exit(1);
}

console.log(
  `\ncheck-production-cache-contract: clean (${results.length - unreachable.length} host(s) return a storable response for an unknown URL).`,
);
