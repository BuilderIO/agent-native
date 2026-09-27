import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;
const MAX_ASSET_COUNT = 256;
const ASSET_CONCURRENCY = 8;

type CheckResult = { ok: true } | { ok: false; reason: string };

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = new Headers(init.headers);
    headers.set("user-agent", USER_AGENT);
    headers.set("accept", headers.get("accept") ?? "application/json,*/*");
    return await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(
  url: string,
  shouldRetryResponse: (response: Response) => boolean = (response) =>
    !response.ok,
  init: RequestInit = {},
): Promise<{ response?: Response; error?: unknown }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(url, init);
      if (!shouldRetryResponse(response) || attempt === MAX_ATTEMPTS) {
        return { response };
      }
      lastError = new Error(`HTTP ${response.status}`);
      await response.body?.cancel();
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
  allowPreview: boolean,
  allowMissingHealth: boolean,
): Promise<CheckResult> {
  const { response, error } = await fetchWithRetry(
    `${baseUrl}/_agent-native/health?strict=1&schema=1`,
  );
  if (!response)
    return {
      ok: false,
      reason: `health network error: ${errorMessage(error)}`,
    };

  if (response.status === 404 && allowPreview && allowMissingHealth) {
    const ping = await fetchWithRetry(`${baseUrl}/_agent-native/ping`);
    if (!ping.response) {
      return {
        ok: false,
        reason: `health route is missing and ping failed: ${errorMessage(ping.error)}`,
      };
    }
    const pingText = await ping.response.text();
    let pingBody: any;
    try {
      pingBody = JSON.parse(pingText);
    } catch {
      pingBody = undefined;
    }
    if (
      ping.response.status >= 200 &&
      ping.response.status < 300 &&
      pingBody?.message === "pong"
    ) {
      console.warn(
        "WARN (health): shared health route is unavailable; template ping route passed.",
      );
      return { ok: true };
    }
    return {
      ok: false,
      reason: `health route is missing and ping returned HTTP ${ping.response.status}`,
    };
  }

  const text = await response.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  console.log(body ? JSON.stringify(body, null, 2) : text.slice(0, 2000));

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

  const identity = body.database?.identity;
  const runningApp = body.database?.runningApp;
  if (body.database?.identityMismatch === true) {
    const recordedApp =
      identity?.state === "recorded" ? identity.app : "unknown";
    return {
      ok: false,
      reason: `database identity mismatch: recorded for app "${recordedApp}", but "${runningApp ?? "unknown"}" is running against it`,
    };
  }
  if (identity?.state === "recorded" && runningApp == null) {
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
  if (canonicalHost && body.auth?.hostMismatch === true) {
    if (allowPreview && canonicalHost !== probedHost) {
      console.warn(
        `WARN (health): preview alias host ${probedHost} differs from canonical host ${canonicalHost}.`,
      );
    } else {
      return {
        ok: false,
        reason: `base URL host (${body.auth.baseUrlHost}) does not match canonical host (${canonicalHost})`,
      };
    }
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
  const { response, error } = await fetchWithRetry(`${baseUrl}/`);
  if (!response) {
    return { ok: false, reason: `/ network error: ${errorMessage(error)}` };
  }
  if (response.status < 200 || response.status >= 400) {
    return {
      ok: false,
      reason: `/ returned HTTP ${response.status} after retries`,
    };
  }
  return { ok: true };
}

export function referencedSameOriginAssetUrls(
  html: string,
  baseUrl: string,
): string[] {
  const documentUrl = new URL(baseUrl);
  let resolutionBaseUrl = documentUrl;
  const baseHref = html.match(
    /<base\b[^>]*(?:^|\s)href=["']([^"']+)["'][^>]*>/i,
  )?.[1];
  if (baseHref) {
    try {
      resolutionBaseUrl = new URL(baseHref, documentUrl);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  const assets = new Set<string>();

  for (const match of html.matchAll(/<(link|script)\b[^>]*>/gi)) {
    const tag = match[0];
    const tagName = match[1].toLowerCase();
    const rel = tag.match(/(?:^|\s)rel=["']([^"']+)["']/i)?.[1] ?? "";
    const attribute =
      tagName === "script"
        ? "src"
        : /(?:^|\s)modulepreload(?:\s|$)/i.test(rel) ||
            /(?:^|\s)stylesheet(?:\s|$)/i.test(rel)
          ? "href"
          : undefined;
    if (!attribute) continue;

    const value = tag.match(
      new RegExp(`(?:^|\\s)${attribute}=["']([^"']+)["']`, "i"),
    )?.[1];
    if (!value || value.startsWith("#") || value.startsWith("data:")) {
      continue;
    }

    try {
      const url = new URL(value, resolutionBaseUrl);
      if (
        url.origin === documentUrl.origin &&
        (url.protocol === "http:" || url.protocol === "https:")
      ) {
        assets.add(url.href);
      }
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      // Ignore malformed or non-URL markup; the document probe reports the
      // host itself and the remaining asset references.
    }
  }

  return [...assets];
}

async function checkReferencedAsset(url: string): Promise<string | undefined> {
  const path = new URL(url).pathname;
  const shouldRetryAssetResponse = (response: Response) =>
    response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    response.status === 404 ||
    response.status >= 500;
  let result = await fetchWithRetry(url, shouldRetryAssetResponse, {
    method: "HEAD",
  });
  if (result.response?.status === 405 || result.response?.status === 501) {
    await result.response.body?.cancel();
    result = await fetchWithRetry(url, shouldRetryAssetResponse, {
      method: "GET",
    });
  }

  if (!result.response) {
    return `${path} network error: ${errorMessage(result.error)}`;
  }
  const contentType = result.response.headers.get("content-type") ?? "";
  const expectedContentType = expectedReferencedAssetContentType(path);
  if (
    expectedContentType &&
    !hasExpectedReferencedAssetContentType(contentType, expectedContentType)
  ) {
    await result.response.body?.cancel();
    return `${path} content-type ${contentType || "(missing)"}; expected ${expectedContentType}`;
  }
  await result.response.body?.cancel();
  return result.response.ok
    ? undefined
    : `${path} HTTP ${result.response.status} after retries`;
}

export type ReferencedAssetContentType = "javascript" | "stylesheet";

export function expectedReferencedAssetContentType(
  assetPath: string,
): ReferencedAssetContentType | undefined {
  if (/\.(?:c|m)?js$/i.test(assetPath.split("?", 1)[0] ?? "")) {
    return "javascript";
  }
  if (/\.css$/i.test(assetPath.split("?", 1)[0] ?? "")) {
    return "stylesheet";
  }
  return undefined;
}

export function hasExpectedReferencedAssetContentType(
  contentType: string,
  expected: ReferencedAssetContentType,
): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (expected === "stylesheet") return mediaType === "text/css";
  return [
    "application/ecmascript",
    "application/javascript",
    "application/x-ecmascript",
    "application/x-javascript",
    "text/ecmascript",
    "text/javascript",
    "text/javascript1.0",
    "text/javascript1.1",
    "text/javascript1.2",
    "text/javascript1.3",
    "text/javascript1.4",
    "text/javascript1.5",
    "text/jscript",
    "text/livescript",
    "text/x-ecmascript",
    "text/x-javascript",
  ].includes(mediaType ?? "");
}

async function checkHtmlAssets(
  baseUrl: string,
  path: string,
): Promise<CheckResult> {
  let pageUrl: URL;
  try {
    pageUrl = new URL(path, `${baseUrl}/`);
    if (pageUrl.origin !== new URL(baseUrl).origin) {
      return { ok: false, reason: `${path} is not same-origin` };
    }
  } catch {
    return { ok: false, reason: `${path} is not a valid URL path` };
  }

  const { response, error } = await fetchWithRetry(pageUrl.href);
  if (!response) {
    return {
      ok: false,
      reason: `${path} network error: ${errorMessage(error)}`,
    };
  }
  if (response.status < 200 || response.status >= 400) {
    await response.body?.cancel();
    return {
      ok: false,
      reason: `${path} returned HTTP ${response.status} after retries`,
    };
  }

  const html = await response.text();
  const assets = referencedSameOriginAssetUrls(html, pageUrl.href);
  if (assets.length === 0) {
    return { ok: false, reason: `${path} referenced no same-origin assets` };
  }
  if (assets.length > MAX_ASSET_COUNT) {
    return {
      ok: false,
      reason: `${path} referenced more than ${MAX_ASSET_COUNT} assets`,
    };
  }

  const failures: string[] = [];
  for (let index = 0; index < assets.length; index += ASSET_CONCURRENCY) {
    const batch = await Promise.all(
      assets
        .slice(index, index + ASSET_CONCURRENCY)
        .map((asset) => checkReferencedAsset(asset)),
    );
    failures.push(...batch.filter((failure): failure is string => !!failure));
    if (failures.length >= 5) break;
  }
  if (failures.length > 0) {
    return {
      ok: false,
      reason: `${path} has unavailable assets: ${failures
        .slice(0, 5)
        .join(", ")}`,
    };
  }
  return { ok: true };
}

async function checkAuthRoutes(baseUrl: string): Promise<CheckResult> {
  const { response, error } = await fetchWithRetry(
    `${baseUrl}/_agent-native/auth/ba/jwks`,
    (result) => result.status !== 404 && !result.ok,
  );
  if (!response) {
    return { ok: false, reason: `jwks network error: ${errorMessage(error)}` };
  }
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
      "Usage: smoke-check-health.ts --url <site url> [--canonical-host <host>] [--auth-routes] [--preview] [--allow-missing-health] [--check-assets] [--asset-path <path>]",
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
  const preview = process.argv.includes("--preview");
  const allowMissingHealth = process.argv.includes("--allow-missing-health");
  const checkAssets = process.argv.includes("--check-assets");
  const assetPath = argumentValue("--asset-path");

  const checks: Array<[string, () => Promise<CheckResult>]> = [
    [
      checkAssets ? "/ and referenced assets" : "/",
      () => (checkAssets ? checkHtmlAssets(baseUrl, "/") : checkRoot(baseUrl)),
    ],
    [
      "health",
      () =>
        checkHealth(
          baseUrl,
          canonicalHost,
          probedHost,
          preview,
          allowMissingHealth,
        ),
    ],
  ];
  if (assetPath && assetPath !== "/") {
    checks.push([
      `assets (${assetPath})`,
      () => checkHtmlAssets(baseUrl, assetPath),
    ]);
  }
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
