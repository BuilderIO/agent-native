import { defineEventHandler } from "h3";
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

import {
  DEFAULT_SSR_CACHE_HEADERS,
  DEFAULT_SPECULATION_RULES_PATH,
} from "../shared/cache-control.js";
import {
  AGENT_NATIVE_SOCIAL_IMAGE_ALT,
  AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT,
  AGENT_NATIVE_SOCIAL_IMAGE_PATH,
  AGENT_NATIVE_SOCIAL_IMAGE_TYPE,
  AGENT_NATIVE_SOCIAL_IMAGE_WIDTH,
  withAgentNativeSocialImageCacheBuster,
} from "../shared/social-meta.js";
import {
  getAppBasePathFromViteEnv,
  stripAppBasePath as canonicalStripAppBasePath,
} from "./app-base-path.js";
import { captureError } from "./capture-error.js";
import { runWithRequestContext } from "./request-context.js";
import { getSentryClientConfigScript } from "./sentry-config.js";

export {
  DEFAULT_SSR_CACHE_HEADERS,
  DEFAULT_SPECULATION_RULES_HEADER,
  DEFAULT_SSR_CACHE_CONTROL,
} from "../shared/cache-control.js";

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
  if (path === basePath || path.startsWith(`${basePath}/`)) return path;
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

  // React Router serializes the server-side basename into its hydration
  // context. The request above is deliberately rendered mount-relative, so
  // that value is normally "/" even though the browser URL is mounted at a
  // workspace prefix such as "/analytics". If the client hydrates that
  // context unchanged, the mounted pathname no longer matches the route tree:
  // index redirects can stall and child pages can fall through to the 404.
  // Keep the serialized router state consistent with the URLs we just
  // prefixed. Template entry clients also set this defensively for older
  // responses, but the initial hydration state must be correct at the source.
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
 * Apply the SSR cache policy to the response headers.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ SSR IS A PUBLIC, HARD-CDN-CACHED SHELL — SERVED IDENTICALLY TO EVERYONE.   │
 * │                                                                            │
 * │ Every SSR HTML / React Router `.data` response gets the same public        │
 * │ stale-while-revalidate policy for ALL visitors, authenticated or not, so   │
 * │ the edge serves one shared copy and never stampedes origin.                │
 * │                                                                            │
 * │ DO NOT reintroduce per-user / cookie-based cache variation here (no        │
 * │ `private`, no `no-store`, no `Vary: Cookie`, no "authenticated → don't     │
 * │ cache" branch). That makes pages uncacheable for every logged-in visitor,  │
 * │ which is slow and expensive — exactly the regression this guardrail        │
 * │ prevents. The reason it is SAFE to hard-cache is that the SSR response is  │
 * │ impersonal: `createH3SSRHandler` renders without reading the request's     │
 * │ session/cookies, so there is no per-user data baked into the HTML. ALL     │
 * │ per-user state (who's logged in, private records, access checks) is        │
 * │ resolved CLIENT-SIDE after load. Keep it that way: if you need the SSR     │
 * │ output to differ per user, the fix is to move that work client-side, not   │
 * │ to disable caching here.                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function applyDefaultSsrCacheHeader(
  headers: Headers,
  status: number,
  pathname: string,
) {
  if (!isSsrHtmlOrDataResponse(headers, status, pathname)) return;

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

  // Netlify Functions/proxies are not cached by default. Set all three cache
  // headers: Cache-Control for browsers, CDN-Cache-Control for generic CDNs,
  // and Netlify-CDN-Cache-Control (with durable) so Netlify's shared cache
  // actually serves SSR HTML/.data from the edge instead of forwarding every
  // request to origin — for every visitor, authenticated or not.
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
 * Strip document-level CSP from app HTML responses.
 *
 * Hosted templates inject framework bootstrap scripts, analytics, Sentry config,
 * and app-owned inline scripts whose exact bytes vary by build/template. Any
 * shared CSP header, even Report-Only, can block or noisily report Google Tag
 * Manager and those bootstraps. Extension iframes and webviews keep their own
 * route-specific sandboxes; normal app documents deliberately do not emit CSP.
 */
function removeDocumentCsp(headers: Headers): void {
  headers.delete("content-security-policy");
  headers.delete("content-security-policy-report-only");
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
): Promise<Response> {
  const sentryClientConfigScript = getSentryClientConfigScript();
  const headers = new Headers(response.headers);
  applyDefaultSsrCacheHeader(headers, response.status, pathname);
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
      const request = requestForAnonymousSsr(
        requestWithPathname(event.req as Request, p, basePath),
      );
      // SSR renders an IMPERSONAL public shell — we deliberately do NOT read the
      // request's session/cookies here, and pin an explicitly anonymous request
      // context. That keeps the SSR HTML/.data identical for every visitor so it
      // can be hard-cached at the CDN for everyone (see applyDefaultSsrCacheHeader).
      //
      // Consequence: SSR loaders that call `getRequestUserEmail()` / `accessFilter()`
      // always see the unauthenticated branch and render public content only. Any
      // per-user view (private records, share-grant access, who's logged in) MUST
      // be resolved CLIENT-SIDE after load, never baked into SSR. Do not re-pin the
      // session here to "fix" a per-user page — that silently makes the page
      // uncacheable and/or leaks one user's data into another's cached copy.
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
        );
      }
      return await rewriteMountedResponse(
        await runWithRequestContext(ctx, () => handler(request)),
        basePath,
        p,
        request.url,
      );
    } catch (err) {
      // Log the full stack server-side, but never leak it to the client.
      // Stack traces expose file paths, library versions, and code structure
      // that aid reconnaissance attacks. In dev we surface the message text
      // so devtools shows something useful; in prod we return a bare 500.
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
        : `Internal Server Error: ${(err as Error)?.message ?? err}`;
      return new Response(body, {
        status: 500,
        headers: { "content-type": "text/plain" },
      });
    }
  });
}
