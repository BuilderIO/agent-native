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
const DEFAULT_CACHE_SETTINGS = new Set([
  "",
  "on",
  "default",
  "true",
  "1",
  "yes",
]);
const DISABLED_CACHE_SETTINGS = new Set([
  "off",
  "false",
  "0",
  "none",
  "no-store",
  "disabled",
]);
const CACHE_DURATION_RE = /^\d+\s*(s|sec|secs|seconds?|m|min|mins?|h|hours?)?$/;

/**
 * Real pages probed alongside the synthetic miss. The synthetic probe proves an
 * unknown URL is storable; it requests a path no route can match, so it can
 * never see a per-route override on a page that DOES exist. That blind spot is
 * how #4158 shipped www.agent-native.com/apps pinned to max-age=30 +
 * stale-while-revalidate=30 — a 60s cache life, then a ~2.7s cold render for
 * whoever arrived next — while this check stayed green.
 */
const REAL_PATHS_BY_HOST = {
  "www.agent-native.com": ["/", "/apps"],
  "beta.agent-native.com": ["/", "/apps"],
};
const DEFAULT_REAL_PATHS = ["/"];

/**
 * Floor on how long a real page stays answerable from storage. max-age is
 * freshness; stale-while-revalidate is what lets the CDN reply instantly while
 * it refreshes behind the request. A short max-age is fine on its own — it is a
 * short max-age paired with a short stale window that ends with a visitor
 * waiting on a cold origin, because both windows lapse together.
 */
const MIN_EFFECTIVE_LIFETIME_SECONDS = 3600;

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

function directiveSeconds(policy, name) {
  const match = new RegExp(`(?:^|[,;\\s])${name}=(\\d+)`).exec(policy);
  return match ? Number(match[1]) : undefined;
}

function hasDeploymentWideCacheOverride() {
  const value = process.env.AGENT_NATIVE_SSR_CACHE?.trim().toLowerCase();
  return (
    value !== undefined &&
    !DEFAULT_CACHE_SETTINGS.has(value) &&
    (DISABLED_CACHE_SETTINGS.has(value) || CACHE_DURATION_RE.test(value))
  );
}

/**
 * How long a shared cache can keep answering before a request must wait on the
 * origin: the fresh window plus the stale-while-revalidate window.
 */
function effectiveLifetimeSeconds(policy) {
  const normalized = policy.toLowerCase();
  const fresh =
    directiveSeconds(normalized, "s-maxage") ??
    directiveSeconds(normalized, "max-age") ??
    0;
  return fresh + (directiveSeconds(normalized, "stale-while-revalidate") ?? 0);
}

async function probe(host) {
  const paths = REAL_PATHS_BY_HOST[host] ?? DEFAULT_REAL_PATHS;
  return [
    await probeUrl(host, null),
    ...(await Promise.all(paths.map((p) => probeUrl(host, p)))),
  ];
}

/**
 * @param pathname a real path to assert the lifetime floor on, or null for the
 *   synthetic unknown-URL probe (storability only).
 */
async function probeUrl(host, pathname) {
  // The synthetic path is impossible to route; real pages use a unique
  // `index` key, which Netlify includes in the durable cache key.
  const cacheBust = `cache-contract-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const url =
    pathname === null
      ? `https://${host}/__cache-contract-probe-${cacheBust}`
      : `https://${host}${pathname}?index=${cacheBust}`;
  const label = pathname === null ? "(unknown URL)" : pathname;
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
      label,
      outcome: "unreachable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  // A throttled or failing origin is a transient state, not a cache-policy
  // regression, and both correctly carry no storable policy. Reporting them as
  // violations would page on rate limits and blips — the noisy-guard failure
  // mode that gets a check muted, which is worse than not having it.
  if (response.status === 429 || response.status >= 500) {
    return {
      host,
      label,
      outcome: "inconclusive",
      status: response.status,
      detail: `origin returned ${response.status}; cache policy not asserted`,
    };
  }
  const cacheControl = response.headers.get("cache-control");
  if (!cacheControl) {
    return {
      host,
      label,
      outcome: "violation",
      status: response.status,
      detail:
        "no cache-control header (a Netlify function response is uncached by default)",
    };
  }
  const cacheHeaders = [
    ["cache-control", cacheControl],
    ["cdn-cache-control", response.headers.get("cdn-cache-control")],
    [
      "netlify-cdn-cache-control",
      response.headers.get("netlify-cdn-cache-control"),
    ],
  ];
  const offending = cacheHeaders.flatMap(([name, value]) => {
    if (!value) return [];
    const normalized = value.toLowerCase();
    return UNCACHEABLE.filter((directive) =>
      normalized.includes(directive),
    ).map((directive) => `${name}=${directive}`);
  });
  if (offending.length > 0) {
    return {
      host,
      label,
      outcome: "violation",
      status: response.status,
      detail: `${offending.join(", ")}; cache-control: ${cacheControl}`,
    };
  }
  // Only real pages, and only 2xx: a redirect or error shell has its own
  // policy, and failing on those would make this the noisy guard nobody trusts.
  if (pathname !== null && response.status < 300) {
    // Netlify consumes netlify-cdn-cache-control before responding, so the
    // shared-cache policy visible from outside is cdn-cache-control.
    const shared = response.headers.get("cdn-cache-control") ?? cacheControl;
    const lifetime = effectiveLifetimeSeconds(shared);
    if (
      lifetime < MIN_EFFECTIVE_LIFETIME_SECONDS &&
      !hasDeploymentWideCacheOverride()
    ) {
      return {
        host,
        label,
        outcome: "violation",
        status: response.status,
        detail: `effective cache lifetime ${lifetime}s is below the ${MIN_EFFECTIVE_LIFETIME_SECONDS}s floor (${shared})`,
      };
    }
  }
  return {
    host,
    label,
    outcome: "ok",
    status: response.status,
    detail: cacheControl,
  };
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

const results = (await mapWithLimit(hosts, HOST_CONCURRENCY, probe)).flat();
const violations = results.filter((r) => r.outcome === "violation");
const skipped = results.filter((r) =>
  ["unreachable", "inconclusive"].includes(r.outcome),
);

for (const r of results) {
  const label =
    r.outcome === "ok" ? "ok  " : r.outcome === "violation" ? "FAIL" : "skip";
  console.log(
    `${label} ${r.host.padEnd(34)} ${(r.label ?? "").padEnd(14)} ${r.status ?? "-"} ${r.detail}`,
  );
}

if (skipped.length > 0) {
  // Named, never silently folded into the pass count: a host this could not
  // assert is not a host that passed.
  console.log(
    `\n${skipped.length} host(s) not asserted (unreachable or throttled): ${skipped
      .map((r) => r.host)
      .join(", ")}. Availability is monitor-agent-native-sites.yml's job.`,
  );
}

if (violations.length > 0) {
  console.error(
    `\ncheck-production-cache-contract FAILED for ${violations.length} host(s):`,
  );
  for (const v of violations)
    console.error(`  - ${v.host}${v.label ? ` ${v.label}` : ""}: ${v.detail}`);
  console.error(
    "\nA response a shared cache cannot store re-invokes the render function on\n" +
      "every request, and Netlify runs one request per container — so this\n" +
      "drains the concurrency pool shared by every other site on the account.\n" +
      "See isSsrHtmlOrDataResponse in packages/core/src/server/ssr-handler.ts.\n" +
      "\nA real page below the lifetime floor is the same cost paid on a timer:\n" +
      "once max-age and stale-while-revalidate both lapse, the next visitor\n" +
      "waits on a cold origin render. Keep a long stale window and shorten\n" +
      "max-age instead — or express the change deployment-wide through\n" +
      "AGENT_NATIVE_SSR_CACHE rather than a per-route override.",
  );
  process.exit(1);
}

console.log(
  `\ncheck-production-cache-contract: clean (${results.length - skipped.length} probe(s): unknown URLs storable, real pages above the ${MIN_EFFECTIVE_LIFETIME_SECONDS}s lifetime floor).`,
);
