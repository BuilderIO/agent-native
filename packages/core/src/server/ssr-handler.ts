import { defineEventHandler } from "h3";
import { createRequestHandler } from "react-router";

import { getAppConfig, resolveAppHomePath } from "../app-config/index.js";
import { isMcpPublicPath } from "../mcp/route-paths.js";
import {
  DEFAULT_SPECULATION_RULES_PATH,
  DISABLED_SSR_CACHE_HEADERS as NO_STORE_SSR_CACHE_HEADERS,
  resolveSsrCacheHeaders,
  resolveSsrCacheKeyHeaders,
  SSR_QUERY_CACHE_KEY_HEADER,
} from "../shared/cache-control.js";
import { CHUNK_RECOVERY_PATH_SUFFIX } from "../shared/route-chunk-recovery-bootstrap.js";
import {
  AGENT_NATIVE_SOCIAL_IMAGE_ALT,
  AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT,
  AGENT_NATIVE_SOCIAL_IMAGE_PATH,
  AGENT_NATIVE_SOCIAL_IMAGE_TYPE,
  AGENT_NATIVE_SOCIAL_IMAGE_WIDTH,
  withAgentNativeSocialImageCacheBuster,
} from "../shared/social-meta.js";
import { getSsrAuthRedirectScript } from "../shared/ssr-auth-redirect.js";
import {
  getAppBasePathFromViteEnv,
  stripAppBasePath as canonicalStripAppBasePath,
} from "./app-base-path.js";
import { getAppOriginClientConfigScript } from "./app-origin-config.js";
import { captureError } from "./capture-error.js";
import {
  frameworkSessionHintCookieName,
  resolveAuthCookieNamespace,
} from "./cookie-namespace.js";
import { getFrameworkRoutePrefix } from "./framework-route-prefix.js";
import { getPostHogClientConfigScript } from "./posthog-config.js";
import { runWithRequestContext } from "./request-context.js";
import {
  getRealtimeClientConfigScript,
  getSentryClientConfigScript,
} from "./sentry-config.js";

export {
  DEFAULT_SSR_CACHE_HEADERS,
  DEFAULT_SPECULATION_RULES_HEADER,
  DEFAULT_SSR_CACHE_CONTROL,
  DISABLED_SSR_CACHE_HEADERS,
  isSsrCacheEnabled,
  resolveSsrCacheHeaders,
  resolveSsrCacheKeyHeaders,
  resolveSsrNetlifyQueryVary,
  SSR_CACHE_ENV_VAR,
} from "../shared/cache-control.js";

function getAppBasePath(): string {
  return getAppBasePathFromViteEnv();
}

function stripAppBasePath(pathname: string): string {
  return canonicalStripAppBasePath(pathname, getAppBasePath());
}

function stripChunkRecoveryPathSuffix(pathname: string): string {
  const suffixWithTrailingSlash = `${CHUNK_RECOVERY_PATH_SUFFIX}/`;
  if (pathname.endsWith(suffixWithTrailingSlash)) {
    const routePath = pathname.slice(0, -suffixWithTrailingSlash.length);
    return routePath ? `${routePath}/` : "/";
  }
  if (!pathname.endsWith(CHUNK_RECOVERY_PATH_SUFFIX)) return pathname;
  const routePath = pathname.slice(0, -CHUNK_RECOVERY_PATH_SUFFIX.length);
  return routePath || "/";
}

function isChunkRecoveryPath(pathname: string): boolean {
  return (
    pathname.endsWith(CHUNK_RECOVERY_PATH_SUFFIX) ||
    pathname.endsWith(`${CHUNK_RECOVERY_PATH_SUFFIX}/`)
  );
}

function stripBasePath(pathname: string, basePath: string): string {
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

function requestWithPathname(
  request: Request,
  pathname: string,
  basePath: string,
): Request {
  const url = new URL(request.url);
  let changed = false;
  if (basePath && pathname === "/__manifest") {
    const paths = url.searchParams.get("paths");
    if (paths) {
      const strippedPaths = paths
        .split(",")
        .map((path) => stripBasePath(path, basePath))
        .join(",");
      if (strippedPaths !== paths) {
        url.searchParams.set("paths", strippedPaths);
        changed = true;
      }
    }
  }
  if (url.pathname !== pathname) {
    url.pathname = pathname;
    changed = true;
  }
  if (!changed) return request;
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: request.headers,
    signal: request.signal,
  };
  if (request.body && !["GET", "HEAD"].includes(request.method.toUpperCase())) {
    init.body = request.body;
    init.duplex = "half";
  }
  return new Request(url, init);
}

function requestForAnonymousSsr(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.delete("authorization");
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    signal: request.signal,
  };
  if (request.body && !["GET", "HEAD"].includes(request.method.toUpperCase())) {
    init.body = request.body;
    init.duplex = "half";
  }
  return new Request(request.url, init);
}

function prefixMountedPath(path: string, basePath: string): string {
  if (!basePath || !path.startsWith("/") || path.startsWith("//")) return path;
  const pathname = path.split(/[?#]/, 1)[0] ?? path;
  if (
    pathname === basePath ||
    pathname === `${basePath}.data` ||
    pathname.startsWith(`${basePath}/`)
  )
    return path;
  return `${basePath}${path}`;
}

function prefixMountedHtml(html: string, basePath: string): string {
  if (!basePath) return html;
  const prefixedHtml = html
    .replace(
      /\b(href|src|action|formaction|poster)=(["'])(\/(?!\/)[^"']*)\2/g,
      (_match, attr: string, quote: string, path: string) =>
        `${attr}=${quote}${prefixMountedPath(path, basePath)}${quote}`,
    )
    .replace(/url\((["']?)(\/(?!\/)[^)'" ]+)\1\)/g, (_match, quote, path) => {
      const q = quote || "";
      return `url(${q}${prefixMountedPath(path, basePath)}${q})`;
    });

  return prefixedHtml.replace(
    /(window\.__reactRouterContext\s*=\s*\{\s*"basename"\s*:\s*)"(?:\\.|[^"\\])*"/,
    `$1${JSON.stringify(basePath)}`,
  );
}

function injectHeadScript(html: string, script: string | null): string {
  if (!script) return html;
  const headCloseIdx = html.indexOf("</head>");
  if (headCloseIdx === -1) return html;
  return html.slice(0, headCloseIdx) + script + html.slice(headCloseIdx);
}

const OG_IMAGE_META_RE = /<meta\b(?=[^>]*\bproperty=(["'])og:image\1)[^>]*>/i;
const TWITTER_CARD_META_RE =
  /<meta\b(?=[^>]*\bname=(["'])twitter:card\1)[^>]*>/i;
const TWITTER_IMAGE_META_RE =
  /<meta\b(?=[^>]*\bname=(["'])twitter:image\1)[^>]*>/i;

function defaultSocialImageUrl(requestUrl: string, basePath: string): string {
  return withAgentNativeSocialImageCacheBuster(
    new URL(
      prefixMountedPath(AGENT_NATIVE_SOCIAL_IMAGE_PATH, basePath),
      requestUrl,
    ).toString(),
  );
}

function injectDefaultSocialImageMeta(html: string, imageUrl: string): string {
  const headCloseIdx = html.indexOf("</head>");
  if (headCloseIdx === -1) return html;

  const hasAnySocialImage =
    OG_IMAGE_META_RE.test(html) || TWITTER_IMAGE_META_RE.test(html);
  const tags: string[] = [];

  if (!hasAnySocialImage) {
    tags.push(`<meta property="og:image" content="${imageUrl}">`);
    tags.push(`<meta property="og:image:secure_url" content="${imageUrl}">`);
    tags.push(
      `<meta property="og:image:type" content="${AGENT_NATIVE_SOCIAL_IMAGE_TYPE}">`,
    );
    tags.push(
      `<meta property="og:image:width" content="${AGENT_NATIVE_SOCIAL_IMAGE_WIDTH}">`,
    );
    tags.push(
      `<meta property="og:image:height" content="${AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT}">`,
    );
    tags.push(
      `<meta property="og:image:alt" content="${AGENT_NATIVE_SOCIAL_IMAGE_ALT}">`,
    );
  }
  if (!TWITTER_CARD_META_RE.test(html)) {
    tags.push(`<meta name="twitter:card" content="summary_large_image">`);
  }
  if (!hasAnySocialImage) {
    tags.push(`<meta name="twitter:image" content="${imageUrl}">`);
    tags.push(
      `<meta name="twitter:image:alt" content="${AGENT_NATIVE_SOCIAL_IMAGE_ALT}">`,
    );
  }

  if (tags.length === 0) return html;
  return html.slice(0, headCloseIdx) + tags.join("") + html.slice(headCloseIdx);
}

const CACHEABLE_ERROR_STATUSES = new Set([404, 410]);

function isSsrHtmlOrDataResponse(
  headers: Headers,
  status: number,
  pathname: string,
): boolean {
  if (status < 200) return false;
  if (status >= 400 && !CACHEABLE_ERROR_STATUSES.has(status)) return false;
  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html")) return true;
  return pathname.endsWith(".data") && contentType.includes("text/x-script");
}

/**
 * Apply the SSR cache policy to the response headers.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ SSR IS A PUBLIC, HARD-CDN-CACHED SHELL — SERVED IDENTICALLY TO EVERYONE.   │
 * │                                                                            │
 * │ Normal SSR HTML / React Router `.data` responses get the same public       │
 * │ stale-while-revalidate policy for ALL visitors, authenticated or not, so   │
 * │ the edge serves one shared copy and never stampedes origin. The one fixed  │
 * │ recovery alias is no-store at every cache layer, so stale shells cannot    │
 * │ trap a failed chunk recovery in either the browser or the CDN.             │
 * │                                                                            │
 * │ DO NOT reintroduce per-user / cookie-based cache variation here (no        │
 * │ `private`, no `Vary: Cookie`, no "authenticated → don't                    │
 * │ cache" branch). That makes pages uncacheable for every logged-in visitor,  │
 * │ which is slow and expensive — exactly the regression this guardrail        │
 * │ prevents. The reason it is SAFE to hard-cache is that the SSR response is  │
 * │ impersonal: `createH3SSRHandler` renders without reading the request's     │
 * │ session/cookies, so there is no per-user data baked into the HTML. ALL     │
 * │ per-user state (who's logged in, private records, access checks) is        │
 * │ resolved CLIENT-SIDE after load. Keep it that way: if you need the SSR     │
 * │ output to differ per user, the fix is to move that work client-side, not   │
 * │ to disable caching here.                                                   │
 * │                                                                            │
 * │ HOW LONG the shell is cached is deployment-wide and configurable through   │
 * │ AGENT_NATIVE_SSR_CACHE (see `resolveSsrCacheHeaders`), for hosts that do   │
 * │ not purge their CDN on deploy. What remains forbidden is PER-REQUEST /     │
 * │ PER-USER response variation — no `private`, no `Vary: Cookie`, and no     │
 * │ request-specific content. The reserved recovery suffix selects the same   │
 * │ shell without varying on a nonce or arbitrary query value.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The same sharing rule governs any DIAGNOSTIC header on this response. A
 * per-request timing written here is stored once by the origin render and
 * replayed unchanged to every later visitor, so it must not wear a live-looking
 * phase name. `installHttpResponseTelemetryHooks` detects the shared-cacheable
 * policy stamped below and collapses `server-timing` to one `origin` entry
 * carrying the render's wall-clock time; do not add a per-request header here
 * that contradicts that.
 */
function applyDefaultSsrCacheHeader(
  headers: Headers,
  status: number,
  pathname: string,
  isRecoveryAlias = false,
) {
  const responseRequestsQueryVary =
    headers.get(SSR_QUERY_CACHE_KEY_HEADER)?.trim().toLowerCase() === "query";
  headers.delete(SSR_QUERY_CACHE_KEY_HEADER);
  if (!isSsrHtmlOrDataResponse(headers, status, pathname)) {
    if (isRecoveryAlias) {
      for (const [name, value] of Object.entries(NO_STORE_SSR_CACHE_HEADERS)) {
        headers.set(name, value);
      }
      headers.delete("netlify-vary");
    }
    return;
  }

  // Recovery uses one fixed path alias, not caller-controlled query values.
  // Keep Netlify's default cache ID: deploy-context invalidation refreshes this
  // alias, while a custom cache ID opts out and can preserve a stale shell.
  const varyByQuery = responseRequestsQueryVary;

  // A public shell must never set a viewer cookie or vary by credentials.
  // Preserve harmless content-negotiation dimensions such as Accept-Encoding.
  headers.delete("set-cookie");
  const vary = headers.get("vary");
  if (vary) {
    const publicVary = vary
      .split(",")
      .map((value) => value.trim())
      .filter((value) => {
        const normalized = value.toLowerCase();
        return (
          normalized &&
          normalized !== "*" &&
          normalized !== "cookie" &&
          normalized !== "authorization"
        );
      });
    if (publicVary.length > 0) headers.set("vary", publicVary.join(", "));
    else headers.delete("vary");
  }

  const cacheHeaders = isRecoveryAlias
    ? NO_STORE_SSR_CACHE_HEADERS
    : resolveSsrCacheHeaders();
  for (const [name, value] of Object.entries(cacheHeaders)) {
    headers.set(name, value);
  }
  if (isRecoveryAlias) {
    headers.delete("netlify-vary");
  } else {
    const cacheKeyHeaders = resolveSsrCacheKeyHeaders(undefined, {
      varyByQuery,
    });
    const netlifyVary = cacheKeyHeaders["netlify-vary"];
    if (netlifyVary) headers.set("netlify-vary", netlifyVary);
    else headers.delete("netlify-vary");
  }
}

function applyDefaultSpeculationRulesHeader(
  headers: Headers,
  status: number,
  basePath: string,
) {
  if (status < 200 || status >= 400) return;
  if (headers.has("speculation-rules")) return;

  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html")) return;

  const rulesPath = prefixMountedPath(DEFAULT_SPECULATION_RULES_PATH, basePath);
  headers.set("speculation-rules", `"${rulesPath}"`);
}

function removeDocumentCsp(headers: Headers): void {
  headers.delete("content-security-policy");
  headers.delete("content-security-policy-report-only");
}

function textSafeErrorMessage(err: unknown): string {
  const message = String((err as { message?: unknown })?.message ?? err);
  return message.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,
    (char) => {
      const code = char.codePointAt(0) ?? 0;
      return code === 0 ? "\\0" : `\\x${code.toString(16).padStart(2, "0")}`;
    },
  );
}

function isFrameworkOrAssetPath(pathname: string): boolean {
  return (
    isMcpPublicPath(pathname) ||
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/_agent_native/") ||
    pathname.startsWith("/_agent-native/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/@vite/") ||
    pathname.startsWith("/@id/") ||
    pathname.startsWith("/@fs/") ||
    pathname === "/@react-refresh" ||
    pathname === "/__vite_ping" ||
    pathname === "/__open-in-editor" ||
    pathname === "/favicon.ico" ||
    pathname === "/favicon.png" ||
    (/\.\w+$/.test(pathname) && !pathname.endsWith(".data"))
  );
}

async function rewriteMountedResponse(
  response: Response,
  basePath: string,
  pathname: string,
  requestUrl: string,
  isRecoveryAlias = false,
): Promise<Response> {
  const clientConfigScript =
    [
      getSentryClientConfigScript(),
      getPostHogClientConfigScript(),
      getRealtimeClientConfigScript(),
      getAppOriginClientConfigScript(),
      pathname === "/"
        ? getSsrAuthRedirectScript(
            frameworkSessionHintCookieName(
              resolveAuthCookieNamespace().frameworkCookieName,
            ),
            resolveAppHomePath(getAppConfig().app, getAppConfig().workspace),
            getFrameworkRoutePrefix(),
          )
        : null,
    ]
      .filter(Boolean)
      .join("") || null;
  const headers = new Headers(response.headers);
  applyDefaultSsrCacheHeader(
    headers,
    response.status,
    pathname,
    isRecoveryAlias,
  );
  applyDefaultSpeculationRulesHeader(headers, response.status, basePath);

  const location = headers.get("location");
  if (location?.startsWith("/") && !location.startsWith("//")) {
    headers.set("location", prefixMountedPath(location, basePath));
  }

  const contentType = headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  removeDocumentCsp(headers);
  if (!response.body) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const html = await response.text();
  headers.delete("content-length");
  return new Response(
    injectHeadScript(
      injectDefaultSocialImageMeta(
        prefixMountedHtml(html, basePath),
        defaultSocialImageUrl(requestUrl, basePath),
      ),
      clientConfigScript,
    ),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
}

export function createH3SSRHandler(getBuild: () => unknown) {
  const handler = createRequestHandler(getBuild as any);
  return defineEventHandler(async (event) => {
    const basePath = getAppBasePath();
    const appPath = stripAppBasePath(event.url.pathname);
    const isRecoveryAlias = isChunkRecoveryPath(appPath);
    const p = stripChunkRecoveryPathSuffix(appPath);
    if (isFrameworkOrAssetPath(p)) {
      return new Response(null, { status: 404 });
    }
    try {
      const request = requestForAnonymousSsr(
        requestWithPathname(event.req as Request, p, basePath),
      );
      const ctx = { userEmail: undefined, orgId: undefined };
      if (request.method === "HEAD") {
        const getRequest = new Request(request.url, {
          method: "GET",
          headers: request.headers,
          signal: request.signal,
        });
        const response = await runWithRequestContext(ctx, () =>
          handler(getRequest),
        );
        return await rewriteMountedResponse(
          new Response(null, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          }),
          basePath,
          p,
          request.url,
          isRecoveryAlias,
        );
      }
      return await rewriteMountedResponse(
        await runWithRequestContext(ctx, () => handler(request)),
        basePath,
        p,
        request.url,
        isRecoveryAlias,
      );
    } catch (err) {
      console.error("[ssr-handler] SSR error:", err);
      captureError(err, {
        route: p,
        method: event.req.method,
        userAgent: event.req.headers.get("user-agent") ?? undefined,
        tags: { renderMode: "anonymous-public", surface: "ssr" },
      });
      const isProd = process.env.NODE_ENV === "production";
      const body = isProd
        ? "Internal Server Error"
        : `Internal Server Error: ${textSafeErrorMessage(err)}`;
      return new Response(body, {
        status: 500,
        headers: { "content-type": "text/plain" },
      });
    }
  });
}
