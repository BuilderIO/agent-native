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
import { runWithRequestContext } from "./request-context.js";
import { requestHasEmbedAuthMarker } from "./embed-session.js";
import {
  EMBED_SESSION_COOKIE,
  EMBED_TOKEN_QUERY_PARAM,
} from "../shared/embed-auth.js";
import { AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE } from "../shared/social-meta.js";

export const DEFAULT_SSR_CACHE_CONTROL =
  "public, max-age=5, stale-while-revalidate=604800, stale-if-error=3600";
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

function injectDefaultSocialImageMeta(html: string): string {
  const headCloseIdx = html.indexOf("</head>");
  if (headCloseIdx === -1) return html;

  const hasAnySocialImage =
    OG_IMAGE_META_RE.test(html) || TWITTER_IMAGE_META_RE.test(html);
  const tags: string[] = [];

  if (!hasAnySocialImage) {
    tags.push(
      `<meta property="og:image" content="${AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE}">`,
    );
  }
  if (!TWITTER_CARD_META_RE.test(html)) {
    tags.push(`<meta name="twitter:card" content="summary_large_image">`);
  }
  if (!hasAnySocialImage) {
    tags.push(
      `<meta name="twitter:image" content="${AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE}">`,
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

function applyDefaultSsrCacheHeader(headers: Headers, status: number) {
  if (headers.has("cache-control")) return;
  if (status < 200 || status >= 400) return;

  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html")) return;

  headers.set("cache-control", DEFAULT_SSR_CACHE_CONTROL);
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
): Promise<Response> {
  const sentryClientConfigScript = getSentryClientConfigScript();
  const headers = new Headers(response.headers);
  applyDefaultSsrCacheHeader(headers, response.status);

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
      injectDefaultSocialImageMeta(prefixMountedHtml(html, basePath)),
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
        );
      }
      return await rewriteMountedResponse(
        await runWithRequestContext(ctx, () => handler(request)),
        basePath,
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
