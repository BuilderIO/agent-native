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
import { BETTER_AUTH_COOKIE_PREFIX, COOKIE_NAME, getSession } from "./auth.js";
import {
  hasAuthContextAccess,
  runWithRequestContext,
  type RequestContext,
} from "./request-context.js";
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
  DEFAULT_SSR_CACHE_CONTROL,
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
 */
async function readOrgIdForEvent(event: H3Event): Promise<string | undefined> {
  try {
    const { getOrgContext } = await import("../org/context.js");
    const ctx = await getOrgContext(event);
    return ctx?.orgId ?? undefined;
  } catch {
    return undefined;
  }
}

function normalizeAppBasePath(value: string | undefined): string {
  if (!value || value === "/") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function getAppBasePath(): string {
  const metaEnv = (
    import.meta as unknown as {
      env?: Record<string, string | undefined>;
    }
  ).env;
  return normalizeAppBasePath(
    process.env.VITE_APP_BASE_PATH ||
      process.env.APP_BASE_PATH ||
      metaEnv?.VITE_APP_BASE_PATH ||
      metaEnv?.APP_BASE_PATH ||
      metaEnv?.BASE_URL,
  );
}

function stripAppBasePath(pathname: string): string {
  const basePath = getAppBasePath();
  return stripBasePath(pathname, basePath);
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

function shouldUseDefaultSsrCacheHeader(
  headers: Headers,
  status: number,
  pathname: string,
  authContextAccessed: boolean,
): boolean {
  if (status < 200 || status >= 400) return false;
  if (authContextAccessed) {
    // Do not bypass cache just because a browser carries an auth-looking
    // cookie: public docs/pages can receive stale workspace cookies and should
    // still warm the CDN. But if SSR code actually reads user/org context,
    // that route is rendering private data and must not be public-cached.
    // Move those reads to client-side actions/API to regain CDN caching.
    return false;
  }

  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html")) {
    // SSR HTML is public app shell in this framework; any per-user state is
    // fetched after hydration. Always enforce the framework SWR default here;
    // route-level no-cache/private headers on SSR HTML recreate the same
    // origin stampede this cache policy is meant to prevent.
    return true;
  }

  if (!pathname.endsWith(".data")) return false;
  if (!contentType.includes("text/x-script")) return false;

  // React Router gives loader `.data` responses `cache-control: no-cache` by
  // default. In Agent-Native, SSR output is intentionally public app shell:
  // user/org-specific reads happen after hydration through actions and API
  // routes. Keep `.data` on the same short-fresh/long-SWR policy as HTML so
  // route data fetches warm the CDN instead of hammering origin.
  // Do not re-add a blanket cookie/auth-signal bypass here: logged-in browsers
  // still need CDN-cached public route data. The auth-context leak guard above
  // is the narrow protection for old SSR loaders that still read user/org data.
  // Also do not preserve route-level private/no-store for React Router .data:
  // if a route needs per-user data, it belongs behind a client-side action/API
  // call rather than in the shared SSR payload.
  return true;
}

function applyDefaultSsrCacheHeader(
  headers: Headers,
  status: number,
  pathname: string,
  authContextAccessed: boolean,
) {
  if (
    !shouldUseDefaultSsrCacheHeader(
      headers,
      status,
      pathname,
      authContextAccessed,
    )
  ) {
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
  requestContext?: RequestContext,
): Promise<Response> {
  const sentryClientConfigScript = getSentryClientConfigScript();
  const headers = new Headers(response.headers);
  applyDefaultSsrCacheHeader(
    headers,
    response.status,
    pathname,
    hasAuthContextAccess(requestContext),
  );
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
      const orgId = session?.email ? await readOrgIdForEvent(event) : undefined;
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
          ctx,
        );
      }
      return await rewriteMountedResponse(
        await runWithRequestContext(ctx, () => handler(request)),
        basePath,
        p,
        request.url,
        ctx,
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
