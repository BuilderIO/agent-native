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
 * The synthetic assertion is deliberately narrow: an unknown URL must not
 * answer with a cache-control that forbids storage. Selected real docs routes
 * additionally prove their status/content type and exact-URL cache reuse. The
 * check does NOT assert a latency number, which would page on cold starts and
 * ordinary network variance.
 *
 * Usage: node scripts/check-production-cache-contract.mjs [--env production|beta|all]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const REAL_PROBES_BY_HOST = {
  "www.agent-native.com": [
    { pathname: "/", contentType: "text/html" },
    { pathname: "/apps", contentType: "text/html", requireRepeatHit: true },
    {
      pathname: "/apps/_.data",
      // Netlify serves prerendered React Router data as text/plain; SSR
      // single-fetch responses use text/x-script.
      contentType: ["text/x-script", "text/plain"],
      requireRepeatHit: true,
    },
    { pathname: "/docs/agent-resources/", contentType: "text/html" },
  ],
  "beta.agent-native.com": [
    { pathname: "/", contentType: "text/html" },
    { pathname: "/apps", contentType: "text/html", requireRepeatHit: true },
    {
      pathname: "/apps/_.data",
      contentType: ["text/x-script", "text/plain"],
      requireRepeatHit: true,
    },
    { pathname: "/docs/agent-resources/", contentType: "text/html" },
  ],
};
const DEFAULT_REAL_PROBES = [{ pathname: "/", contentType: "text/html" }];

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
const MAX_REDIRECTS = 3;
const REPEAT_HIT_ATTEMPTS = 3;
const REPEAT_HIT_RETRY_MS = 500;

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

async function probe(host, fetchImpl = fetch) {
  const probes = REAL_PROBES_BY_HOST[host] ?? DEFAULT_REAL_PROBES;
  return [
    await probeUrl(host, null, fetchImpl),
    ...(await Promise.all(
      probes.map((probe) => probeUrl(host, probe, fetchImpl)),
    )),
  ];
}

export function cacheStatusHasHit(value) {
  return /(?:^|[;,]\s*)(?:hit|fwd=stale)(?:\s*[,;]|\s*$)/i.test(value ?? "");
}

export function contentTypeMatches(value, expected) {
  const actual = (value ?? "").split(";", 1)[0].trim().toLowerCase();
  const expectedTypes = Array.isArray(expected) ? expected : [expected];
  return expectedTypes.some(
    (expectedType) => actual === expectedType.toLowerCase(),
  );
}

export function isSameOriginUrl(value, host) {
  try {
    const url = new URL(value);
    const expectedOrigin = new URL(`https://${host}`).origin;
    return url.origin === expectedOrigin && !url.username && !url.password;
  } catch {
    return false;
  }
}

function probeResult(host, label, outcome, observation, detail) {
  return {
    host,
    label,
    outcome,
    status: observation?.response.status,
    detail,
  };
}

function detailForObservation(observation) {
  const contentType = observation.response.headers.get("content-type") ?? "-";
  const cacheStatus = observation.response.headers.get("cache-status") ?? "-";
  const cacheControl = observation.response.headers.get("cache-control") ?? "-";
  const cdnCacheControl =
    observation.response.headers.get("cdn-cache-control") ?? "-";
  const netlifyCdnCacheControl =
    observation.response.headers.get("netlify-cdn-cache-control") ?? "-";
  const serverTiming = observation.response.headers.get("server-timing") ?? "-";
  return [
    `status=${observation.response.status}`,
    `content-type=${contentType}`,
    `cache-control=${cacheControl}`,
    `cdn-cache-control=${cdnCacheControl}`,
    `netlify-cdn-cache-control=${netlifyCdnCacheControl}`,
    `cache-status=${cacheStatus}`,
    `server-timing=${serverTiming}`,
    `ttfb=${observation.ttfbMs}ms`,
    `total=${observation.totalMs}ms`,
    `body-bytes=${observation.bodyBytes}`,
    observation.redirects > 0 ? `redirects=${observation.redirects}` : null,
  ]
    .filter(Boolean)
    .join("; ");
}

async function requestWithRedirects(url, host, fetchImpl = fetch) {
  let currentUrl = url;
  let totalMs = 0;
  let ttfbMs;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const startedAt = performance.now();
    const response = await fetchImpl(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const hopTtfbMs = Math.round(performance.now() - startedAt);
    const body = await response.arrayBuffer();
    const hopTotalMs = Math.round(performance.now() - startedAt);
    totalMs += hopTotalMs;
    ttfbMs ??= hopTtfbMs;
    const observation = {
      response,
      url: currentUrl,
      bodyBytes: body.byteLength,
      ttfbMs,
      totalMs,
      redirects,
    };
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (response.status >= 300 && response.status < 400) {
        observation.redirectError = `unsupported redirect status ${response.status}`;
      }
      return observation;
    }
    if (redirects === MAX_REDIRECTS) {
      observation.redirectError = `more than ${MAX_REDIRECTS} redirects`;
      return observation;
    }

    const location = response.headers.get("location");
    if (!location) {
      observation.redirectError = "redirect response has no Location header";
      return observation;
    }
    const target = new URL(location, currentUrl).href;
    if (!isSameOriginUrl(target, host)) {
      observation.redirectError = `redirect leaves expected origin: ${target}`;
      return observation;
    }
    currentUrl = target;
  }
  throw new Error(`more than ${MAX_REDIRECTS} same-origin redirects`);
}

function cacheHeadersFor(response) {
  return [
    ["cache-control", response.headers.get("cache-control")],
    ["cdn-cache-control", response.headers.get("cdn-cache-control")],
    [
      "netlify-cdn-cache-control",
      response.headers.get("netlify-cdn-cache-control"),
    ],
  ];
}

function cachePolicyViolation(response) {
  const cacheControl = response.headers.get("cache-control");
  if (!cacheControl)
    return "no cache-control header (a Netlify function response is uncached by default)";
  const offending = cacheHeadersFor(response).flatMap(([name, value]) => {
    if (!value) return [];
    const normalized = value.toLowerCase();
    return UNCACHEABLE.filter((directive) =>
      normalized.includes(directive),
    ).map((directive) => `${name}=${directive}`);
  });
  return offending.length > 0
    ? `${offending.join(", ")}; cache-control: ${cacheControl}`
    : null;
}

function originFailure(observation) {
  return (
    observation.response.status === 429 || observation.response.status >= 500
  );
}

async function repeatUntilHit(observation, host, fetchImpl = fetch) {
  let last;
  for (let attempt = 1; attempt <= REPEAT_HIT_ATTEMPTS; attempt += 1) {
    const repeat = await requestWithRedirects(observation.url, host, fetchImpl);
    last = repeat;
    if (repeat.redirectError || originFailure(repeat)) {
      return { kind: "inconclusive", observation: repeat };
    }
    if (cacheStatusHasHit(repeat.response.headers.get("cache-status"))) {
      return { kind: "hit", observation: repeat };
    }
    if (attempt < REPEAT_HIT_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, REPEAT_HIT_RETRY_MS));
    }
  }
  return { kind: "miss", observation: last };
}

/**
 * @param probe a real path probe, or null for the synthetic unknown-URL probe
 *   (storability only).
 */
export async function probeUrl(host, probe, fetchImpl = fetch) {
  // The synthetic path is impossible to route; dynamic real pages use a unique
  // `index` key, which Netlify includes in the durable cache key. Static docs
  // use an ordinary query because their published file does not need a durable
  // key assertion.
  const cacheBust = `cache-contract-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const pathname = probe?.pathname;
  const url =
    probe === null
      ? `https://${host}/__cache-contract-probe-${cacheBust}`
      : `https://${host}${pathname}?${probe.requireRepeatHit ? "index" : "cache-contract"}=${cacheBust}`;
  const label = probe === null ? "(unknown URL)" : pathname;
  try {
    const observation = await requestWithRedirects(url, host, fetchImpl);
    const { response } = observation;
    const detail = detailForObservation(observation);
    if (observation.redirectError) {
      return probeResult(
        host,
        label,
        "violation",
        observation,
        `${detail}; ${observation.redirectError}`,
      );
    }
    if (originFailure(observation)) {
      return probeResult(
        host,
        label,
        "inconclusive",
        observation,
        `${detail}; origin returned ${response.status}; cache policy not asserted`,
      );
    }
    const cacheViolation = cachePolicyViolation(response);
    if (cacheViolation) {
      return probeResult(
        host,
        label,
        "violation",
        observation,
        `${detail}; ${cacheViolation}`,
      );
    }
    if (probe !== null) {
      if (response.status !== 200) {
        return probeResult(
          host,
          label,
          "violation",
          observation,
          `${detail}; expected HTTP 200`,
        );
      }
      const expectedContentType = probe.contentType;
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentTypeMatches(contentType, expectedContentType)) {
        return probeResult(
          host,
          label,
          "violation",
          observation,
          `${detail}; expected content-type ${expectedContentType}`,
        );
      }
      if (observation.bodyBytes === 0) {
        return probeResult(
          host,
          label,
          "violation",
          observation,
          `${detail}; response body is empty`,
        );
      }
      const shared =
        response.headers.get("netlify-cdn-cache-control") ??
        response.headers.get("cdn-cache-control") ??
        response.headers.get("cache-control") ??
        "";
      const lifetime = effectiveLifetimeSeconds(shared);
      if (
        lifetime < MIN_EFFECTIVE_LIFETIME_SECONDS &&
        !hasDeploymentWideCacheOverride()
      ) {
        return probeResult(
          host,
          label,
          "violation",
          observation,
          `${detail}; effective cache lifetime ${lifetime}s is below the ${MIN_EFFECTIVE_LIFETIME_SECONDS}s floor (${shared})`,
        );
      }
      if (probe.requireRepeatHit) {
        const repeatResult = await repeatUntilHit(observation, host, fetchImpl);
        const repeat = repeatResult.observation;
        if (repeatResult.kind === "inconclusive") {
          return probeResult(
            host,
            label,
            "inconclusive",
            repeat,
            `${detail}; repeat ${detailForObservation(repeat)}; repeat origin/redirect failure`,
          );
        }
        if (repeatResult.kind === "miss") {
          return probeResult(
            host,
            label,
            "violation",
            repeat,
            `${detail}; exact-URL repeat did not report a cache hit after ${REPEAT_HIT_ATTEMPTS} attempts; repeat ${detailForObservation(repeat)}`,
          );
        }
        const repeatContentType =
          repeat.response.headers.get("content-type") ?? "";
        if (
          repeat.response.status !== 200 ||
          !contentTypeMatches(repeatContentType, expectedContentType) ||
          repeat.bodyBytes === 0 ||
          cachePolicyViolation(repeat.response)
        ) {
          return probeResult(
            host,
            label,
            "violation",
            repeat,
            `${detail}; repeat ${detailForObservation(repeat)}; repeat response contract failed`,
          );
        }
        return probeResult(
          host,
          label,
          "ok",
          observation,
          `${detail}; repeat ${detailForObservation(repeat)}`,
        );
      }
    }
    return probeResult(host, label, "ok", observation, detail);
  } catch (error) {
    // Unreachable is a distinct outcome from misconfigured. Availability is
    // the sibling monitor's job; an explicit deployment check still fails closed.
    return {
      ...probeResult(host, label, "unreachable", undefined),
      detail: error instanceof Error ? error.message : String(error),
    };
  }
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

async function main() {
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
      `${label} ${r.host.padEnd(34)} ${(r.label ?? "").padEnd(24)} ${r.status ?? "-"} ${r.detail}`,
    );
  }

  if (skipped.length > 0) {
    // Named, never silently folded into the pass count: a host this could not
    // assert is not a host that passed.
    console.log(
      `\n${skipped.length} probe(s) not asserted (unreachable or throttled): ${skipped
        .map((r) => `${r.host}${r.label ? ` ${r.label}` : ""}`)
        .join(", ")}. Availability is monitor-agent-native-sites.yml's job.`,
    );
  }

  if (violations.length > 0) {
    console.error(
      `\ncheck-production-cache-contract FAILED for ${violations.length} host(s):`,
    );
    for (const v of violations)
      console.error(
        `  - ${v.host}${v.label ? ` ${v.label}` : ""}: ${v.detail}`,
      );
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

  if (skipped.length > 0) {
    console.error(
      explicitHost || skipped.length === results.length
        ? "\ncheck-production-cache-contract INCONCLUSIVE: no clean result can be reported."
        : "\ncheck-production-cache-contract incomplete: skipped probes prevent a clean result.",
    );
    if (explicitHost || skipped.length === results.length) process.exitCode = 2;
    return;
  }

  console.log(
    `\ncheck-production-cache-contract: clean (${results.length - skipped.length} probe(s): unknown URLs storable, real pages above the ${MIN_EFFECTIVE_LIFETIME_SECONDS}s lifetime floor).`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
