import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Smoke-checks a deployed site against `/_agent-native/health`: strict
 * readiness, database dialect, and schema (including Better Auth's tables).
 * A green Netlify deploy has shipped before while the app quietly ran on
 * local SQLite or 500'd on Better Auth's jwks route — a status-only
 * `curl --fail` never saw either.
 *
 * Usage: smoke-check-health.ts --url <site url> [--canonical-host <host>] [--auth-routes]
 * Exit: 0 all checks passed, 1 a check failed (reason printed), 2 bad args.
 */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;

type CheckResult = { ok: true } | { ok: false; reason: string };

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json,*/*" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retries network errors and every non-2xx until the last attempt: a deploy
 * URL probed seconds after upload can answer 404 while Netlify is still
 * propagating it (the analytics beta run 33784386290 failed exactly that
 * way), and a cold function answers 5xx. The final attempt's response is
 * returned as-is so the caller classifies the real status.
 */
async function fetchWithRetry(
  url: string,
): Promise<{ response?: Response; error?: unknown }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(url);
      if (response.ok || attempt === MAX_ATTEMPTS) return { response };
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(2_000 * attempt);
  }
  return { error: lastError };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function checkHealth(
  baseUrl: string,
  canonicalHost: string | undefined,
  probedHost: string,
): Promise<CheckResult> {
  const { response, error } = await fetchWithRetry(
    `${baseUrl}/_agent-native/health?strict=1&schema=1`,
  );
  if (!response)
    return {
      ok: false,
      reason: `health network error: ${errorMessage(error)}`,
    };

  const text = await response.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  console.log(body ? JSON.stringify(body, null, 2) : text.slice(0, 2000));

  // Prefer the most specific reason a parsed body can give — strict mode
  // already turns "not ready" into a 503, so checking the status first would
  // hide exactly the ready/db/dialect/schema detail this script exists to
  // surface. Fall back to the raw status only when there is no body to read.
  if (!body) {
    if (response.status < 200 || response.status >= 300) {
      return {
        ok: false,
        reason: `health returned HTTP ${response.status} after retries`,
      };
    }
    return { ok: false, reason: "health returned a non-JSON body" };
  }
  if (body.ready !== true)
    return { ok: false, reason: `health reports ready=${body.ready}` };
  if (body.db !== true)
    return { ok: false, reason: `health reports db=${body.db}` };

  const dialect = body.database?.dialect;
  if (dialect === "sqlite" || dialect === "pglite") {
    return {
      ok: false,
      reason: `hosted deploy is running a local database (dialect=${dialect})`,
    };
  }
  // `identityMismatch` is only ever true when the database was recorded for
  // one app and a different one is now running against it — the exact
  // wrong-database incident this check exists to catch. The other identity
  // states (unrecorded/timeout/unreadable) mean the check could not confirm
  // ownership either way, not that it confirmed there was none, so they warn
  // instead of failing the deploy.
  const identity = body.database?.identity;
  const runningApp = body.database?.runningApp;
  if (body.database?.identityMismatch === true) {
    const recordedApp =
      identity?.state === "recorded" ? identity.app : "unknown";
    // Warn, do not fail, until the fleet has shown that the identity a hosted
    // bundle derives for itself matches what its release migration recorded.
    // The first crm promotion failed on a null runtime identity; promote this
    // to a hard failure once every host reports a non-null, matching
    // `runningApp`.
    console.warn(
      `WARN (health): database identity mismatch — recorded for app "${recordedApp}", but "${runningApp ?? "unknown"}" is running against it.`,
    );
  } else if (identity?.state === "recorded" && runningApp == null) {
    console.warn(
      `WARN (health): database identity recorded for "${identity.app}" but this runtime could not derive its own app identity (runningApp=null).`,
    );
  }
  if (identity && identity.state !== "recorded") {
    const detail =
      identity.state === "unreadable" ? ` (${identity.error})` : "";
    console.warn(
      `WARN (health): database identity ${identity.state}${detail} — cannot yet confirm which app owns this database.`,
    );
  }
  if (body.schema && body.schema.ok === false) {
    const missing =
      (body.schema.missingTables ?? []).join(", ") || "(see body above)";
    return {
      ok: false,
      reason: `schema check failed, missing tables: ${missing}`,
    };
  }
  if (
    canonicalHost &&
    canonicalHost === probedHost &&
    body.auth?.hostMismatch === true
  ) {
    return {
      ok: false,
      reason: `base URL host (${body.auth.baseUrlHost}) does not match canonical host (${canonicalHost})`,
    };
  }
  if (response.status < 200 || response.status >= 300) {
    return {
      ok: false,
      reason: `health returned HTTP ${response.status} after retries`,
    };
  }
  return { ok: true };
}

async function checkRoot(baseUrl: string): Promise<CheckResult> {
  try {
    const response = await fetchWithTimeout(`${baseUrl}/`);
    if (response.status < 200 || response.status >= 400) {
      return { ok: false, reason: `/ returned HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `/ network error: ${errorMessage(err)}` };
  }
}

async function checkAuthRoutes(baseUrl: string): Promise<CheckResult> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${baseUrl}/_agent-native/auth/ba/jwks`);
  } catch (err) {
    return { ok: false, reason: `jwks network error: ${errorMessage(err)}` };
  }
  // Not every template mounts Better Auth; 404 means it wasn't, not that it broke.
  if (response.status === 404) return { ok: true };
  if (response.status !== 200) {
    return { ok: false, reason: `jwks returned HTTP ${response.status}` };
  }
  let body: any;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "jwks returned a non-JSON body" };
  }
  if (!Array.isArray(body?.keys) || body.keys.length === 0) {
    return { ok: false, reason: "jwks returned no keys" };
  }
  return { ok: true };
}

async function main(): Promise<number> {
  const rawUrl = argumentValue("--url");
  if (!rawUrl) {
    console.error(
      "Usage: smoke-check-health.ts --url <site url> [--canonical-host <host>] [--auth-routes]",
    );
    return 2;
  }

  let baseUrl: string;
  let probedHost: string;
  try {
    probedHost = new URL(rawUrl).hostname.toLowerCase();
    baseUrl = rawUrl.replace(/\/+$/, "");
  } catch {
    console.error(`Usage error: --url is not a valid URL: ${rawUrl}`);
    return 2;
  }
  const canonicalHost = argumentValue("--canonical-host")?.toLowerCase();
  const authRoutes = process.argv.includes("--auth-routes");

  const checks: Array<[string, () => Promise<CheckResult>]> = [
    ["/", () => checkRoot(baseUrl)],
    ["health", () => checkHealth(baseUrl, canonicalHost, probedHost)],
  ];
  if (authRoutes) checks.push(["jwks", () => checkAuthRoutes(baseUrl)]);

  let failed = false;
  for (const [label, check] of checks) {
    const result = await check();
    if (!result.ok) {
      console.error(`FAIL (${label}): ${result.reason}`);
      failed = true;
    } else {
      console.log(`OK (${label})`);
    }
  }
  return failed ? 1 : 0;
}

const isMainModule =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(errorMessage(err));
      process.exitCode = 2;
    },
  );
}
