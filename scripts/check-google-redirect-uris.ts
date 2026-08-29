#!/usr/bin/env tsx
/**
 * Check the callback paths that Google's authorize endpoint accepts for the
 * active Google client each deployed host advertises. This public probe sees
 * redirect_uri_mismatch without reading or sending a client secret.
 *
 * The target is the deployment-level managed OAuth client from
 * health/google?client=managed. The endpoint fails closed when that client is
 * unavailable; provider-scoped credentials are never inferred from sign-in.
 */
import { createHash } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REQUEST_TIMEOUT_MS = 20_000;
const HOST_TIMEOUT_MS = 90_000;
const DEFAULT_RUN_TIMEOUT_MS = 15 * 60_000;
const HOST_CONCURRENCY = 12;
const MAX_HEALTH_BYTES = 64 * 1024;
const CALLBACK_PATHS = {
  root: "/_agent-native/google/callback",
  // This callback is owned by the Slides template, not the framework fleet.
  google_docs: "/_agent-native/google-docs/callback",
} as const;
const OPTIONAL_CALLBACK_PATHS = {
  // Kept as an explicit audit target for deployments that still expose the
  // legacy provider path; current Google workspace flows use the root relay.
  google_drive: "/_agent-native/connections/oauth/google_drive/callback",
} as const;
const ALL_CALLBACK_PATHS = { ...CALLBACK_PATHS, ...OPTIONAL_CALLBACK_PATHS };
const HEALTH_STATUSES = [
  "valid",
  "invalid",
  "unconfigured",
  "unknown",
] as const;
const SAFE_HEALTH_REASONS = new Set(["invalid_client", "invalid_grant"]);
const SAFE_CREDENTIAL_SOURCES = new Set([
  "active",
  "preferred",
  "managed",
  "user",
]);
const SAFE_CREDENTIAL_MODES = new Set(["managed", "user"]);

setDefaultResultOrder("ipv4first");

export type GoogleRedirectProbeState =
  | "registered"
  | "unregistered"
  | "unknown";

export type GoogleRedirectProbeResult = {
  state: GoogleRedirectProbeState;
  detail?: string;
};

export type GoogleHealthStatus =
  | "valid"
  | "invalid"
  | "unconfigured"
  | "unknown"
  | "absent"
  | "not_applicable";

export type GoogleHealthResult = {
  status: GoogleHealthStatus;
  reason: string | null;
  clientId: string | null;
  clientFingerprint: string | null;
  mismatchedPairs: boolean | null;
  credentialSource: string | null;
  credentialMode: "managed" | "user" | null;
  callbackPaths: string[] | null;
};

export function googleRedirectProbeExitCode(input: {
  expected: number;
  unregistered: number;
  unknown: number;
  unprobeable: number;
  invalidCredentials: number;
  skippedRequired: number;
  allowNoCoverage?: boolean;
}): number {
  if (input.unregistered > 0) return 1;
  if (input.expected === 0) return input.allowNoCoverage ? 0 : 2;
  if (
    input.unknown > 0 ||
    input.unprobeable > 0 ||
    input.invalidCredentials > 0 ||
    input.skippedRequired > 0
  ) {
    return 2;
  }
  return 0;
}

type Manifest = Record<string, string[]>;

type Options = {
  env?: string;
  host?: string;
  paths: string[] | null;
  skip: Set<string>;
  budgetMs: number;
  allowLegacyHealth: boolean;
};

type Target = { lane: string; host: string };

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readManifest(): Manifest {
  return readJsonFile<Manifest>(
    path.join(repoRoot, "scripts/netlify-site-hosts.json"),
  );
}

function readNotApplicableHosts(): Set<string> {
  const capabilities = readJsonFile<{ notApplicable?: unknown }>(
    path.join(repoRoot, "scripts/google-oauth-site-capabilities.json"),
  );
  if (
    capabilities.notApplicable !== undefined &&
    !Array.isArray(capabilities.notApplicable)
  ) {
    throw new Error("google-oauth-site-capabilities.json has an invalid shape");
  }
  return new Set(
    (capabilities.notApplicable ?? [])
      .filter((host): host is string => typeof host === "string")
      .map((host) => host.toLowerCase()),
  );
}

function emptyHealth(
  status: GoogleHealthStatus,
  reason: string | null,
): GoogleHealthResult {
  return {
    status,
    reason,
    clientId: null,
    clientFingerprint: null,
    mismatchedPairs: null,
    credentialSource: null,
    credentialMode: null,
    callbackPaths: null,
  };
}

function fingerprintClientId(clientId: string | null): string | null {
  return clientId
    ? `sha256:${createHash("sha256").update(clientId).digest("hex").slice(0, 12)}`
    : null;
}

function parseHost(value: string): string {
  const host = value
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .trim();
  if (
    !host ||
    host.includes(":") ||
    !/^(?:[a-z0-9-]+\.)+(?:agent-native\.com|builder\.io)$/i.test(host)
  ) {
    throw new Error(`--host must be an Agent-Native hostname (got ${value})`);
  }
  return host.toLowerCase();
}

function parsePaths(value: string): string[] | null {
  if (value.trim().toLowerCase() === "auto") return null;
  const paths = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const callbackPath =
        ALL_CALLBACK_PATHS[entry as keyof typeof ALL_CALLBACK_PATHS];
      if (callbackPath) return callbackPath;
      if (entry.startsWith("/_agent-native/") && entry.endsWith("/callback")) {
        return entry;
      }
      throw new Error(
        `Unknown callback path ${entry}. Use ${Object.keys(ALL_CALLBACK_PATHS).join(",")} or an /_agent-native/*/callback path.`,
      );
    });
  if (paths.length === 0) throw new Error("--paths requires at least one path");
  return [...new Set(paths)];
}

function parseOptions(argv: string[]): Options | null {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "Usage: pnpm check:google-redirect-uris -- [--env production|beta|workspace|all] [--host HOST] [--paths auto|root,google_docs] [--skip HOST,...] [--budget-seconds N] [--allow-legacy-health]",
    );
    return null;
  }

  const valueAfter = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };
  const inlineValue = (flag: string): string | undefined =>
    argv.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1);
  const getValue = (flag: string): string | undefined =>
    inlineValue(flag) ?? valueAfter(flag);

  const hostValue = getValue("--host");
  const env = getValue("--env") ?? (hostValue ? undefined : "all");
  if (env && !["production", "beta", "workspace", "all"].includes(env)) {
    throw new Error(
      `--env must be production, beta, workspace, or all (got ${env})`,
    );
  }
  const skip = new Set(
    (getValue("--skip") ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean)
      .map(parseHost),
  );
  const budgetSeconds = Number(getValue("--budget-seconds") ?? "900");
  if (!Number.isInteger(budgetSeconds) || budgetSeconds <= 0) {
    throw new Error("--budget-seconds must be a positive integer");
  }
  return {
    env,
    host: hostValue ? parseHost(hostValue) : undefined,
    paths: parsePaths(getValue("--paths") ?? "auto"),
    skip,
    budgetMs: budgetSeconds * 1_000,
    allowLegacyHealth: argv.includes("--allow-legacy-health"),
  };
}

function decodeGoogleAuthError(value: string): string {
  if (!value) return "";
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    // coercion-ok: malformed provider error text is unclassifiable and remains unknown.
    return "";
  }
}

/** Classify Google's redirect without following the provider redirect. */
export function classifyGoogleAuthorizeResponse(
  response: Response,
  redirectUri: string,
  requestUrl = GOOGLE_AUTHORIZE_URL,
): GoogleRedirectProbeResult {
  if (response.status < 300 || response.status >= 400) {
    return {
      state: "unknown",
      detail: `Google returned status ${response.status} instead of a redirect`,
    };
  }
  const location = response.headers.get("location");
  if (!location) {
    return { state: "unknown", detail: "Google returned no redirect location" };
  }

  let target: URL;
  try {
    target = new URL(location, requestUrl);
  } catch {
    return { state: "unknown", detail: "Google returned an invalid redirect" };
  }
  if (target.origin !== "https://accounts.google.com") {
    return {
      state: "unknown",
      detail: "Google redirected to an unexpected origin",
    };
  }

  if (target.pathname === "/signin/oauth/error") {
    const error = decodeGoogleAuthError(
      target.searchParams.get("authError") ?? "",
    );
    if (/redirect_uri_mismatch/i.test(error)) {
      return { state: "unregistered" };
    }
    return {
      state: "unknown",
      detail:
        "Google returned an OAuth error without a redirect mismatch marker",
    };
  }

  if (
    target.pathname === "/v3/signin/identifier" ||
    target.pathname === "/signin/identifier"
  ) {
    return { state: "registered" };
  }
  return { state: "unknown", detail: "Google returned an unexpected redirect" };
}

function safeTransportReason(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "request timed out";
  }
  return "request failed";
}

function requestSignal(deadline: number): AbortSignal {
  return AbortSignal.timeout(
    Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now())),
  );
}

async function probeRedirect(
  clientId: string,
  redirectUri: string,
  deadline: number,
): Promise<GoogleRedirectProbeResult> {
  if (Date.now() >= deadline) {
    return { state: "unknown", detail: "host probe budget exhausted" };
  }
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid");
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: requestSignal(deadline),
    });
    try {
      return classifyGoogleAuthorizeResponse(response, redirectUri, url.href);
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
  } catch (error) {
    return { state: "unknown", detail: safeTransportReason(error) };
  }
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
}

function safeHealthReason(
  value: unknown,
  status: GoogleHealthStatus,
): string | null {
  if (typeof value === "string" && SAFE_HEALTH_REASONS.has(value)) return value;
  if (status === "invalid") return "credential rejected";
  if (status === "unknown") return "credential check inconclusive";
  return null;
}

function advertisedCallbackPaths(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const paths = value.filter(
    (path): path is string =>
      typeof path === "string" &&
      path.startsWith("/_agent-native/") &&
      path.endsWith("/callback"),
  );
  return paths.length === value.length ? [...new Set(paths)] : null;
}

/** Parse the public health contract without trusting arbitrary response text. */
export function classifyGoogleHealthResponse(
  response: Response,
  bodyText: string,
): GoogleHealthResult {
  if (response.status === 404)
    return emptyHealth("absent", "health endpoint absent");
  if (response.status >= 300 && response.status < 400) {
    return emptyHealth("unknown", "health endpoint redirected");
  }
  if (
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json")
  ) {
    return emptyHealth("unknown", "health endpoint did not return JSON");
  }
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(bodyText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return emptyHealth("unknown", "health response had an invalid shape");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return emptyHealth("unknown", "health response was not valid JSON");
  }
  const rawStatus = body.status;
  if (
    typeof rawStatus !== "string" ||
    !HEALTH_STATUSES.includes(rawStatus as (typeof HEALTH_STATUSES)[number])
  ) {
    return emptyHealth("unknown", "health response had an unknown status");
  }
  if (
    !(response.status >= 200 && response.status < 300) &&
    !(response.status === 503 && rawStatus === "invalid")
  ) {
    return emptyHealth(
      "unknown",
      `health endpoint returned HTTP ${response.status}`,
    );
  }
  const clientId =
    typeof body.clientId === "string" && body.clientId.trim()
      ? body.clientId
      : null;
  if (rawStatus === "valid" && !clientId) {
    return emptyHealth(
      "unknown",
      "valid health response omitted its client id",
    );
  }
  const status = rawStatus as (typeof HEALTH_STATUSES)[number];
  return {
    status,
    reason: safeHealthReason(body.reason, status),
    clientId,
    clientFingerprint: fingerprintClientId(clientId),
    mismatchedPairs:
      typeof body.mismatchedPairs === "boolean" ? body.mismatchedPairs : null,
    credentialSource:
      typeof body.credentialSource === "string" &&
      SAFE_CREDENTIAL_SOURCES.has(body.credentialSource)
        ? body.credentialSource
        : null,
    credentialMode:
      typeof body.credentialMode === "string" &&
      SAFE_CREDENTIAL_MODES.has(body.credentialMode)
        ? (body.credentialMode as "managed" | "user")
        : null,
    callbackPaths: advertisedCallbackPaths(body.callbackPaths),
  };
}

async function healthOf(
  host: string,
  deadline: number,
  allowLegacyHealth: boolean,
): Promise<GoogleHealthResult> {
  if (Date.now() >= deadline) {
    return emptyHealth("unknown", "host probe budget exhausted");
  }
  try {
    const response = await fetch(
      `https://${host}/_agent-native/health/google?client=managed`,
      { redirect: "manual", signal: requestSignal(deadline) },
    );
    const bodyText = await readBoundedText(response, MAX_HEALTH_BYTES);
    if (bodyText === null) {
      return emptyHealth("unknown", "health response exceeded 64 KiB");
    }
    const health = classifyGoogleHealthResponse(response, bodyText);
    if (health.credentialMode === "user") {
      return emptyHealth(
        "not_applicable",
        "OAuth credentials are user-scoped and checked after authentication",
      );
    }
    if (health.credentialSource === "managed") {
      return health.credentialMode === "managed"
        ? health
        : emptyHealth(
            "unknown",
            "managed health response omitted its credential mode",
          );
    }
    return allowLegacyHealth &&
      (health.credentialSource === "active" ||
        health.credentialSource === "preferred")
      ? health
      : emptyHealth(
          "unknown",
          "health endpoint did not advertise managed OAuth",
        );
  } catch (error) {
    return emptyHealth("unknown", safeTransportReason(error));
  }
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

function allManifestHosts(manifest: Manifest): Set<string> {
  return new Set(Object.values(manifest).flat());
}

function selectedTargets(manifest: Manifest, options: Options): Target[] {
  if (options.host) return [{ lane: "explicit", host: options.host }];
  return Object.entries(manifest).flatMap(([lane, hosts]) =>
    options.env === "all" || options.env === lane
      ? hosts.map((host) => ({ lane, host }))
      : [],
  );
}

async function run(argv: string[]): Promise<number> {
  const options = parseOptions(argv);
  if (!options) return 0;
  const manifest = readManifest();
  const notApplicable = readNotApplicableHosts();
  const knownHosts = allManifestHosts(manifest);
  for (const host of notApplicable) {
    if (!knownHosts.has(host)) {
      throw new Error(
        `google-oauth-site-capabilities.json names a host not in the manifest: ${host}`,
      );
    }
  }
  for (const skippedHost of options.skip) {
    if (!knownHosts.has(skippedHost) && !notApplicable.has(skippedHost)) {
      throw new Error(
        `--skip names a host that is not in the manifest: ${skippedHost}`,
      );
    }
  }

  const targets = selectedTargets(manifest, options);
  if (targets.length === 0) {
    console.error("No hosts selected for the Google redirect probe.");
    return 2;
  }
  const skippedTargets = targets.filter(({ host }) => options.skip.has(host));
  const selected = targets.filter(({ host }) => !options.skip.has(host));
  if (selected.length === 0) {
    console.error("No hosts remain after --skip; no coverage was verified.");
    return 2;
  }
  const skippedRequired = skippedTargets.filter(
    ({ host }) => !notApplicable.has(host),
  );
  for (const target of skippedTargets) {
    console.log(
      `SKIPPED\t${target.lane}\t${target.host}\t${notApplicable.has(target.host) ? "not applicable" : "required coverage"}`,
    );
  }

  const runDeadline = Date.now() + options.budgetMs;
  const rows = await mapWithLimit(
    selected,
    HOST_CONCURRENCY,
    async (target) => {
      if (notApplicable.has(target.host)) {
        return {
          ...target,
          health: emptyHealth(
            "not_applicable",
            "site is not a Google-enabled app",
          ),
          results: [],
        };
      }
      const hostDeadline = Math.min(runDeadline, Date.now() + HOST_TIMEOUT_MS);
      const health = await healthOf(
        target.host,
        hostDeadline,
        options.allowLegacyHealth,
      );
      const callbackPaths =
        health.callbackPaths && options.paths
          ? health.callbackPaths.filter((callbackPath) =>
              options.paths?.includes(callbackPath),
            )
          : (health.callbackPaths ?? []);
      const results = health.clientId
        ? await mapWithLimit(callbackPaths, 3, async (callbackPath) => {
            const redirectUri = `https://${target.host}${callbackPath}`;
            return {
              callbackPath,
              redirectUri,
              ...(await probeRedirect(
                health.clientId as string,
                redirectUri,
                hostDeadline,
              )),
            };
          })
        : [];
      return { ...target, health, results };
    },
  );

  let unregistered = 0;
  let unknown = 0;
  let unprobeable = 0;
  let invalidCredentials = 0;
  let verified = 0;
  let expected = 0;
  let managedHosts = 0;
  for (const row of rows) {
    const healthLabel = [
      row.health.status,
      row.health.reason ? `reason=${row.health.reason}` : "",
      row.health.mismatchedPairs ? "mismatched-pairs" : "",
      row.health.credentialSource
        ? `source=${row.health.credentialSource}`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      `HOST\t${row.lane}\t${row.host}\tclient=${row.health.clientFingerprint ?? "none"}\t${healthLabel}`,
    );
    if (row.health.status === "not_applicable") continue;
    if (row.health.credentialSource === "managed") managedHosts += 1;
    if (
      options.allowLegacyHealth &&
      row.health.credentialSource !== "managed"
    ) {
      console.log(
        `NOT VERIFIED\t${row.host}\tmanaged OAuth health contract is not deployed`,
      );
      continue;
    }
    if (
      row.health.credentialSource === "managed" &&
      row.health.callbackPaths === null
    ) {
      unknown += 1;
      console.log(
        `UNKNOWN\t${row.host}\thealth\thealth response omitted callback paths`,
      );
      continue;
    }
    if (row.health.status === "invalid") invalidCredentials += 1;
    if (row.health.status === "invalid") {
      console.log(
        `FAIL\t${row.host}\thealth\t${row.health.reason ?? "invalid"}`,
      );
    } else if (row.health.status !== "valid") {
      console.log(
        `UNKNOWN\t${row.host}\thealth\t${row.health.reason ?? row.health.status}`,
      );
    }
    if (!row.health.clientId) {
      unprobeable += 1;
      console.log(`UNPROBEABLE\t${row.host}\t(no active client id advertised)`);
      continue;
    }
    expected += row.results.length;
    for (const result of row.results) {
      const label =
        result.state === "registered"
          ? "OK"
          : result.state === "unregistered"
            ? "FAIL"
            : "UNKNOWN";
      if (result.state === "registered") verified += 1;
      if (result.state === "unregistered") unregistered += 1;
      if (result.state === "unknown") unknown += 1;
      console.log(
        `${label}\t${row.host}\t${result.callbackPath}\t${result.redirectUri}${result.detail ? `\t${result.detail}` : ""}`,
      );
    }
    if (row.health.status === "unknown" || row.health.status === "absent") {
      unknown += 1;
    }
  }

  console.log(
    `\nSummary: hosts=${rows.length} paths=${options.paths?.length ?? "auto"} managed_hosts=${managedHosts} expected=${expected} verified=${verified} unregistered=${unregistered} unknown=${unknown} unprobeable=${unprobeable} invalid_credentials=${invalidCredentials} skipped_required=${skippedRequired.length}`,
  );
  return googleRedirectProbeExitCode({
    expected,
    unregistered,
    unknown,
    unprobeable,
    invalidCredentials,
    skippedRequired: skippedRequired.length,
    allowNoCoverage:
      managedHosts === 0 &&
      (options.allowLegacyHealth ||
        rows.every((row) => row.health.status === "not_applicable")),
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
