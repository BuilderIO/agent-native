/**
 * Shared SSR catch-all handler for React Router framework mode.
 *
 * Templates wire this up via:
 *
 *   // server/routes/[...page].get.ts
 *   import { createH3SSRHandler } from "@agent-native/core/server/ssr-handler";
 *   export default createH3SSRHandler(
 *     () => import("virtual:react-router/server-build"),
 *   );
 *
 * The `getBuild` callback MUST live in the template's own source so Vite's
 * @react-router/dev plugin can resolve the `virtual:` module. Pulling the
 * import into core (e.g. via a re-export) puts it in node_modules where
 * Vite's SSR externalizer leaves it untouched and Node's ESM loader rejects
 * the unknown scheme — silently 302'ing every request to "/".
 */
import { createRequestHandler } from "react-router";
import { defineEventHandler, type H3Event } from "h3";
import { getSentryClientConfigScript } from "./sentry-config.js";
import { computeInlineScriptHash } from "./security-headers.js";
import {
  getAppBasePathFromViteEnv,
  stripAppBasePath as canonicalStripAppBasePath,
} from "./app-base-path.js";
import { BETTER_AUTH_COOKIE_PREFIX, COOKIE_NAME, getSession } from "./auth.js";
import { runWithRequestContext } from "./request-context.js";
import { requestHasEmbedAuthMarker } from "./embed-session.js";
import {
  EMBED_SESSION_COOKIE,
  EMBED_TOKEN_QUERY_PARAM,
} from "../shared/embed-auth.js";
import {
  AGENT_NATIVE_SOCIAL_IMAGE_ALT,
  AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT,
  AGENT_NATIVE_SOCIAL_IMAGE_PATH,
  AGENT_NATIVE_SOCIAL_IMAGE_TYPE,
  AGENT_NATIVE_SOCIAL_IMAGE_WIDTH,
} from "../shared/social-meta.js";
import {
  DEFAULT_SSR_CACHE_HEADERS,
  DEFAULT_SPECULATION_RULES_PATH,
} from "../shared/cache-control.js";

export {
  DEFAULT_SSR_CACHE_HEADERS,
  DEFAULT_SPECULATION_RULES_HEADER,
  DEFAULT_SSR_CACHE_CONTROL,
} from "../shared/cache-control.js";
const ANONYMOUS_SESSION_COOKIE_NAMES = new Set(["an_docs_session"]);
const BETTER_AUTH_SESSION_COOKIE_RE = /\.session_(?:token|data)$/;

/**
 * Read the active org for a request without forcing every template to bundle
 * the org module. Mirrors what `core-routes-plugin` does for action handlers.
 *
 * Fast path: when the session already carries a valid orgId (backfilled by
 * backfillSessionOrg during getSession), return it directly — no additional
 * org_members round trip. Only when the session has no orgId do we fall
 * through to getOrgContext for the full membership lookup.
 */
async function readOrgIdForEvent(
  event: H3Event,
  session: Awaited<ReturnType<typeof getSession>>,
): Promise<string | undefined> {
  // Reuse orgId already resolved by backfillSessionOrg inside getSession.
  const sessionOrgId =
    typeof session?.orgId === "string" && session.orgId.trim()
      ? session.orgId.trim()
      : undefined;
  if (sessionOrgId) return sessionOrgId;

  // No orgId on the session — full org_members lookup needed.
  // getOrgContext is per-event memoized, so this is at most one DB read
  // even if other request code calls getOrgContext independently.
  try {
    const { getOrgContext } = await import("../org/context.js");
    const ctx = await getOrgContext(event);
    return ctx?.orgId ?? undefined;
  } catch {
    return undefined;
  }
}

function getAppBasePath(): string {
  return getAppBasePathFromViteEnv();
}

function stripAppBasePath(pathname: string): string {
  return canonicalStripAppBasePath(pathname, getAppBasePath());
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

function prefixMountedPath(path: string, basePath: string): string {
  if (!basePath || !path.startsWith("/") || path.startsWith("//")) return path;
  if (path === basePath || path.startsWith(`${basePath}/`)) return path;
  return `${basePath}${path}`;
}

function prefixMountedHtml(html: string, basePath: string): string {
  if (!basePath) return html;
  return html
    .replace(
      /\b(href|src|action|formaction|poster)=(["'])(\/(?!\/)[^"']*)\2/g,
      (_match, attr: string, quote: string, path: string) =>
        `${attr}=${quote}${prefixMountedPath(path, basePath)}${quote}`,
    )
    .replace(/url\((["']?)(\/(?!\/)[^)'" ]+)\1\)/g, (_match, quote, path) => {
      const q = quote || "";
      return `url(${q}${prefixMountedPath(path, basePath)}${q})`;
    });
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
  return new URL(
    prefixMountedPath(AGENT_NATIVE_SOCIAL_IMAGE_PATH, basePath),
    requestUrl,
  ).toString();
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

function requestHasAuthSignal(event: H3Event): boolean {
  const headers = event.req.headers;
  return Boolean(
    headers.get("authorization") ||
    requestHasAuthenticatedCookie(headers.get("cookie")) ||
    event.url.searchParams.has(EMBED_TOKEN_QUERY_PARAM) ||
    event.url.searchParams.has("_session") ||
    requestHasEmbedAuthMarker(event),
  );
}

function requestHasAuthenticatedCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim().split("=", 1)[0]?.trim())
    .filter((name): name is string => Boolean(name))
    .some(isAuthenticatedCookieName);
}

function isAuthenticatedCookieName(name: string): boolean {
  if (ANONYMOUS_SESSION_COOKIE_NAMES.has(name)) return false;
  const bareName = name.replace(/^__(?:Secure|Host)-/, "");
  return (
    bareName === COOKIE_NAME ||
    bareName === EMBED_SESSION_COOKIE ||
    bareName === "an_session" ||
    bareName === "an_session_workspace" ||
    bareName.startsWith("an_session_") ||
    bareName === `${BETTER_AUTH_COOKIE_PREFIX}.session_token` ||
    bareName === `${BETTER_AUTH_COOKIE_PREFIX}.session_data` ||
    BETTER_AUTH_SESSION_COOKIE_RE.test(bareName)
  );
}

const PRIVATE_NO_STORE = "private, no-store";

function isSsrHtmlOrDataResponse(
  headers: Headers,
  status: number,
  pathname: string,
): boolean {
  if (status < 200 || status >= 400) return false;
  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html")) return true;
  return pathname.endsWith(".data") && contentType.includes("text/x-script");
}

/**
 * Apply the correct SSR cache policy to the response headers.
 *
 * Anonymous requests (no auth signal on the incoming request) get the public
 * stale-while-revalidate default so the CDN can serve shared app-shell HTML
 * and React Router loader data to every unauthenticated visitor without
 * hammering origin.
 *
 * Authenticated requests must never be publicly CDN-cached: the loader may
 * have embedded session-personalized data. If the route already returned a
 * Cache-Control header we respect it; otherwise we fall back to
 * `private, no-store` so the browser re-fetches but no shared cache stores
 * the response.
 *
 * The distinction is on the *incoming* auth signal, not on whether the loader
 * actually used the session — that would require inspecting the response body.
 * Erring toward private for any credentialed request is the safe default.
 */
function applyDefaultSsrCacheHeader(
  headers: Headers,
  status: number,
  pathname: string,
  hasAuthSignal: boolean,
) {
  if (!isSsrHtmlOrDataResponse(headers, status, pathname)) return;

  if (hasAuthSignal) {
    // A route that explicitly opts into public caching (e.g. a share page that
    // accepts an optional auth cookie) can signal intent via a `public` directive.
    // Any other route-level or framework-default value (no-cache, private, unset)
    // is overridden with private/no-store so no shared CDN cache stores a
    // potentially personalized response.
    const existingCc = headers.get("cache-control") ?? "";
    if (!existingCc.includes("public")) {
      headers.set("cache-control", PRIVATE_NO_STORE);
    }
    // Never propagate CDN-specific cache headers on authenticated responses,
    // regardless of what the route set.
    headers.delete("cdn-cache-control");
    headers.delete("netlify-cdn-cache-control");
    return;
  }

  // Netlify Functions/proxies are not cached by default, and production docs
  // requests often carry stale auth/doc cookies. Keep all three cache headers:
  // Cache-Control for browsers, CDN-Cache-Control for generic CDNs, and
  // Netlify-CDN-Cache-Control (with durable) so Netlify's shared cache actually
  // serves SSR HTML/.data instead of forwarding every request to origin.
  for (const [name, value] of Object.entries(DEFAULT_SSR_CACHE_HEADERS)) {
    headers.set(name, value);
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

  // Cloudflare Speed Brain injects its own Speculation-Rules header when the
  // origin omits one. Those browser prefetches carry `Sec-Purpose: prefetch`,
  // and Cloudflare refuses cache-ineligible dynamic pages with a 503 before
  // the request can reach Netlify/origin. We publish an explicit no-op ruleset
  // by default so Cloudflare does not inject its edge prefetch rules. Preserve
  // an app-provided Speculation-Rules header above if a template deliberately
  // owns this behavior.
  const rulesPath = prefixMountedPath(DEFAULT_SPECULATION_RULES_PATH, basePath);
  headers.set("speculation-rules", `"${rulesPath}"`);
}

/**
 * Extract the plain JS body from a `<script ...>body</script>` string.
 * Returns `null` if the input is falsy or has no recognisable `</script>` end.
 * Used to compute the sha256 hash of framework-injected inline scripts so the
 * hash can be listed in the `script-src` CSP directive without relying on
 * `'unsafe-inline'`.
 */
function extractScriptBody(scriptTag: string | null): string | null {
  if (!scriptTag) return null;
  const start = scriptTag.indexOf(">") + 1;
  const end = scriptTag.lastIndexOf("</script>");
  if (start <= 0 || end < start) return null;
  return scriptTag.slice(start, end);
}

/**
 * Apply a Content-Security-Policy header to HTML document responses.
 *
 * Two directives are always enforced in production:
 *
 *   - `object-src 'none'`  — disables Flash / Java / PDF plugin execution,
 *     which are a reliable code-execution vector even in modern browsers.
 *   - `base-uri 'self'`    — prevents a `<base href="...">` injection from
 *     hijacking all relative URLs in the document (a common attack target when
 *     user-controlled content reaches the HTML).
 *
 * A third directive, `script-src`, is emitted via `Content-Security-Policy-
 * Report-Only` rather than enforced. The framework injects one deterministic
 * inline script per process (the Sentry config block — its hash is computed
 * once at process startup from the resolved env vars). Templates additionally
 * render a theme-init inline script whose exact content varies by template
 * (default theme param, custom docs variant, etc.) and which is rendered by
 * React Router, not this handler, so its hash is not available here. Shipping
 * script-src as Report-Only surfaces violations without breaking template
 * customisations; teams can graduate to enforcement once their hashes are
 * enumerated.
 *
 * Skipped in development (`NODE_ENV !== 'production'`) so HMR eval and Vite
 * dev-server injects are never blocked. Set `AGENT_NATIVE_DISABLE_DOC_CSP=1`
 * to opt out in production for a template with exotic needs.
 */
function applyDocumentCsp(headers: Headers, sentryScript: string | null): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.AGENT_NATIVE_DISABLE_DOC_CSP === "1") return;

  // object-src / base-uri: enforced; neither directive mentions scripts, so
  // they are safe even when a template's inline script hashes are unknown.
  const existing = headers.get("content-security-policy") ?? "";
  if (!existing) {
    headers.set(
      "content-security-policy",
      "object-src 'none'; base-uri 'self'",
    );
  }

  // script-src as Report-Only: list 'self' plus the hash for the Sentry config
  // script the SSR handler injects into every HTML response (the hash is
  // computed once from the resolved env vars at process startup). Template
  // theme-init hashes are NOT included here — see function comment above.
  const sentryBody = extractScriptBody(sentryScript);
  const sentryHash = sentryBody ? computeInlineScriptHash(sentryBody) : null;
  const scriptSrcTokens = ["'self'", ...(sentryHash ? [sentryHash] : [])];
  const scriptSrc = `script-src ${scriptSrcTokens.join(" ")}`;

  const existingRo = headers.get("content-security-policy-report-only") ?? "";
  if (!existingRo) {
    headers.set("content-security-policy-report-only", scriptSrc);
  }
}

function isFrameworkOrAssetPath(pathname: string): boolean {
  return (
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
  hasAuthSignal: boolean,
): Promise<Response> {
  const sentryClientConfigScript = getSentryClientConfigScript();
  const headers = new Headers(response.headers);
  applyDefaultSsrCacheHeader(headers, response.status, pathname, hasAuthSignal);
  applyDefaultSpeculationRulesHeader(headers, response.status, basePath);

  const location = headers.get("location");
  if (location?.startsWith("/") && !location.startsWith("//")) {
    headers.set("location", prefixMountedPath(location, basePath));
  }

  const contentType = headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html") || !response.body) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const html = await response.text();
  headers.delete("content-length");
  applyDocumentCsp(headers, sentryClientConfigScript);
  return new Response(
    injectHeadScript(
      injectDefaultSocialImageMeta(
        prefixMountedHtml(html, basePath),
        defaultSocialImageUrl(requestUrl, basePath),
      ),
      sentryClientConfigScript,
    ),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
}

/**
 * Create an h3 catch-all that hands page routes to React Router and
 * returns 404 for framework / asset paths that React Router doesn't own.
 */
export function createH3SSRHandler(getBuild: () => Promise<unknown> | unknown) {
  const handler = createRequestHandler(getBuild as any);
  return defineEventHandler(async (event) => {
    const basePath = getAppBasePath();
    const p = stripAppBasePath(event.url.pathname);
    if (isFrameworkOrAssetPath(p)) {
      return new Response(null, { status: 404 });
    }
    try {
      const request = requestWithPathname(event.req as Request, p, basePath);
      // Pin the active session onto the async request context so React Router
      // loaders that call `getRequestUserEmail()` / `accessFilter()` see the
      // signed-in user. Without this, SSR loaders fall through to the
      // unauthenticated branch even when the user is logged in — which broke
      // shared-deck "Presentation link" access for non-public decks.
      let session: Awaited<ReturnType<typeof getSession>> | null = null;
      const hasAuthSignal = requestHasAuthSignal(event);
      if (hasAuthSignal) {
        try {
          session = await getSession(event);
        } catch {
          // Auth lookup failures must not break SSR; treat as unauthenticated.
        }
      }
      // readOrgIdForEvent fast-paths when session.orgId is already backfilled
      // (the common case), avoiding a duplicate org_members query. A second
      // query only fires for authenticated users whose session has no orgId.
      const orgId = session?.email
        ? await readOrgIdForEvent(event, session)
        : undefined;
      const ctx = {
        userEmail: session?.email ?? undefined,
        orgId,
      };
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
          hasAuthSignal,
        );
      }
      return await rewriteMountedResponse(
        await runWithRequestContext(ctx, () => handler(request)),
        basePath,
        p,
        request.url,
        hasAuthSignal,
      );
    } catch (err) {
      // Log the full stack server-side, but never leak it to the client.
      // Stack traces expose file paths, library versions, and code structure
      // that aid reconnaissance attacks. In dev we surface the message text
      // so devtools shows something useful; in prod we return a bare 500.
      console.error("[ssr-handler] SSR error:", err);
      const isProd = process.env.NODE_ENV === "production";
      const body = isProd
        ? "Internal Server Error"
        : `Internal Server Error: ${(err as Error)?.message ?? err}`;
      return new Response(body, {
        status: 500,
        headers: { "content-type": "text/plain" },
      });
    }
  });
}
