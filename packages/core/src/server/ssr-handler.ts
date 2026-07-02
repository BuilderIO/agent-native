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
  GA_CSP_CONNECT_HOSTS,
  GA_CSP_IMG_HOSTS,
  GA_CSP_SCRIPT_HOSTS,
  getGaInlineConfigScriptBody,
} from "./analytics.js";
import {
  getAppBasePathFromViteEnv,
  stripAppBasePath as canonicalStripAppBasePath,
} from "./app-base-path.js";
import { runWithRequestContext } from "./request-context.js";
import { computeInlineScriptHash } from "./security-headers.js";
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

type CspDirective = {
  name: string;
  tokens: string[];
};

const CSP_DIRECTIVES_WITH_VALUE_TOKENS = new Set([
  "base-uri",
  "block-all-mixed-content",
  "child-src",
  "connect-src",
  "default-src",
  "fenced-frame-src",
  "font-src",
  "form-action",
  "frame-ancestors",
  "frame-src",
  "img-src",
  "manifest-src",
  "media-src",
  "navigate-to",
  "object-src",
  "plugin-types",
  "prefetch-src",
  "referrer",
  "reflected-xss",
  "require-sri-for",
  "require-trusted-types-for",
  "report-to",
  "report-uri",
  "sandbox",
  "script-src",
  "script-src-attr",
  "script-src-elem",
  "style-src",
  "style-src-attr",
  "style-src-elem",
  "trusted-types",
  "upgrade-insecure-requests",
  "webrtc",
  "worker-src",
]);

function hasCommaJoinedCspPolicies(policy: string): boolean {
  let commaIndex = policy.indexOf(",");
  while (commaIndex !== -1) {
    const afterComma = policy.slice(commaIndex + 1);
    const directive = /^\s+([a-z][a-z0-9-]*)(?=\s|;|$)/i.exec(afterComma)?.[1];
    if (
      directive &&
      CSP_DIRECTIVES_WITH_VALUE_TOKENS.has(directive.toLowerCase())
    ) {
      return true;
    }
    commaIndex = policy.indexOf(",", commaIndex + 1);
  }
  return false;
}

function parseCsp(policy: string): CspDirective[] {
  return policy
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name = "", ...tokens] = part.split(/\s+/);
      return { name: name.toLowerCase(), tokens };
    })
    .filter((directive) => directive.name);
}

function serializeCsp(directives: CspDirective[]): string {
  return directives
    .map((directive) =>
      [directive.name, ...directive.tokens].filter(Boolean).join(" "),
    )
    .join("; ");
}

function appendCspTokens(
  tokens: string[],
  additions: readonly string[],
): string[] {
  if (!additions.length) return tokens;
  const next = tokens.filter((token) => token !== "'none'");
  const seen = new Set(next);
  for (const token of additions) {
    if (!token || seen.has(token)) continue;
    next.push(token);
    seen.add(token);
  }
  return next;
}

function findCspDirective(
  directives: CspDirective[],
  name: string,
): CspDirective | undefined {
  return directives.find((directive) => directive.name === name);
}

function appendToExistingOrDefaultCspDirective(
  directives: CspDirective[],
  name: string,
  additions: readonly string[],
): void {
  if (!additions.length) return;
  const existing = findCspDirective(directives, name);
  if (existing) {
    existing.tokens = appendCspTokens(existing.tokens, additions);
    return;
  }

  const defaultSrc = findCspDirective(directives, "default-src");
  if (!defaultSrc) return;
  directives.push({
    name,
    tokens: appendCspTokens([...defaultSrc.tokens], additions),
  });
}

function appendToExistingCspDirective(
  directives: CspDirective[],
  name: string,
  additions: readonly string[],
): void {
  const existing = findCspDirective(directives, name);
  if (!existing) return;
  existing.tokens = appendCspTokens(existing.tokens, additions);
}

function ensureCspDirective(
  directives: CspDirective[],
  name: string,
  tokens: readonly string[],
): void {
  if (findCspDirective(directives, name)) return;
  directives.push({ name, tokens: [...tokens] });
}

function hasStrictNonceScriptPolicy(tokens: readonly string[]): boolean {
  return tokens.some(
    (token) => token === "'strict-dynamic'" || token.startsWith("'nonce-"),
  );
}

function appendToScriptCspDirective(
  directives: CspDirective[],
  name: string,
  additions: readonly string[],
): boolean {
  const existing = findCspDirective(directives, name);
  if (existing) {
    if (hasStrictNonceScriptPolicy(existing.tokens)) return false;
    existing.tokens = appendCspTokens(existing.tokens, additions);
    return true;
  }

  const defaultSrc = findCspDirective(directives, "default-src");
  if (!defaultSrc || hasStrictNonceScriptPolicy(defaultSrc.tokens)) {
    return false;
  }
  directives.push({
    name,
    tokens: appendCspTokens([...defaultSrc.tokens], additions),
  });
  return true;
}

function appendToEffectiveScriptElementCspDirective(
  directives: CspDirective[],
  additions: readonly string[],
): boolean {
  const scriptSrcElem = findCspDirective(directives, "script-src-elem");
  if (scriptSrcElem) {
    if (hasStrictNonceScriptPolicy(scriptSrcElem.tokens)) return false;
    scriptSrcElem.tokens = appendCspTokens(scriptSrcElem.tokens, additions);
    return true;
  }

  return appendToScriptCspDirective(directives, "script-src", additions);
}

function augmentExistingEnforcedCspForFrameworkScripts(
  policy: string,
  options: {
    gaScriptSrcTokens: readonly string[];
    gaEnabled: boolean;
  },
): string {
  // Multiple CSP headers are surfaced by Headers.get() as one comma-joined
  // string. CSP is not a comma-list header, so serializing a parsed combined
  // value would turn two policies into one invalid policy. Leave those headers
  // app-owned; a comma inside a source/report URL is still safe to parse.
  if (hasCommaJoinedCspPolicies(policy)) return policy;

  const directives = parseCsp(policy);
  if (!directives.length) return policy;

  if (options.gaEnabled) {
    const addedScriptElement = appendToEffectiveScriptElementCspDirective(
      directives,
      options.gaScriptSrcTokens,
    );
    if (addedScriptElement) {
      appendToExistingOrDefaultCspDirective(
        directives,
        "connect-src",
        GA_CSP_CONNECT_HOSTS,
      );
      appendToExistingOrDefaultCspDirective(
        directives,
        "img-src",
        GA_CSP_IMG_HOSTS,
      );
    }
  }

  ensureCspDirective(directives, "object-src", ["'none'"]);
  ensureCspDirective(directives, "base-uri", ["'self'"]);

  return serializeCsp(directives);
}

function augmentExistingReportOnlyCspForFrameworkScripts(
  policy: string,
  options: {
    scriptSrcTokens: readonly string[];
    gaEnabled: boolean;
  },
): string {
  if (hasCommaJoinedCspPolicies(policy)) return policy;

  const directives = parseCsp(policy);
  if (!directives.length) return policy;

  appendToExistingOrDefaultCspDirective(
    directives,
    "script-src",
    options.scriptSrcTokens,
  );
  appendToExistingCspDirective(
    directives,
    "script-src-elem",
    options.scriptSrcTokens,
  );

  if (options.gaEnabled) {
    appendToExistingOrDefaultCspDirective(
      directives,
      "connect-src",
      GA_CSP_CONNECT_HOSTS,
    );
    appendToExistingOrDefaultCspDirective(
      directives,
      "img-src",
      GA_CSP_IMG_HOSTS,
    );
  }

  return serializeCsp(directives);
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
 * Report-Only` rather than enforced when the app has no existing document CSP.
 * The framework injects deterministic inline scripts (the Sentry config block,
 * whose hash is computed once at process startup from the resolved env vars,
 * and — when `GA_MEASUREMENT_ID` is set — the gtag config block, whose hash is
 * derived from the same string `wrapWithAnalytics` embeds). It also loads
 * Google Tag Manager / GA4 from `GA_CSP_SCRIPT_HOSTS`. All of those are listed
 * here so the report-only policy reflects the code the framework itself injects
 * instead of reporting a violation on every page load.
 *
 * If an app or host already sends an enforced CSP with `script-src`,
 * `script-src-elem`, `connect-src`, `img-src`, or `default-src`, we merge only
 * GA-specific allowances into existing host/hash policies. Strict nonce or
 * `strict-dynamic` script policies stay app-owned because blindly appending
 * hashes or hosts would widen the policy without reliably loading our injected
 * scripts.
 *
 * Templates additionally render a theme-init inline script whose exact content
 * varies by template (default theme param, custom docs variant, etc.) and which
 * is rendered by React Router, not this handler, so its hash is not available
 * here. Shipping script-src as Report-Only surfaces the remaining violations
 * without breaking template customisations; teams can graduate to enforcement
 * once their hashes are enumerated.
 *
 * Skipped in development (`NODE_ENV !== 'production'`) so HMR eval and Vite
 * dev-server injects are never blocked. Set `AGENT_NATIVE_DISABLE_DOC_CSP=1`
 * to opt out in production for a template with exotic needs.
 */
function applyDocumentCsp(headers: Headers, sentryScript: string | null): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.AGENT_NATIVE_DISABLE_DOC_CSP === "1") return;

  // script-src as Report-Only: list 'self', the framework-injected inline
  // script hashes (Sentry config + gtag config), and the Google Analytics /
  // Tag Manager loader hosts. These are exactly the scripts the framework
  // itself injects, so listing them keeps the report-only policy from flagging
  // GA on every page load (and keeps it safe to graduate to enforcement).
  // Template theme-init hashes are NOT included here — see function comment.
  const sentryBody = extractScriptBody(sentryScript);
  const sentryHash = sentryBody ? computeInlineScriptHash(sentryBody) : null;
  const gaInlineBody = getGaInlineConfigScriptBody();
  const gaHash = gaInlineBody ? computeInlineScriptHash(gaInlineBody) : null;
  const gaHosts = gaInlineBody ? [...GA_CSP_SCRIPT_HOSTS] : [];
  const gaScriptSrcTokens = [...(gaHash ? [gaHash] : []), ...gaHosts];
  const scriptSrcTokens = [
    "'self'",
    ...(sentryHash ? [sentryHash] : []),
    ...(gaHash ? [gaHash] : []),
    ...gaHosts,
  ];

  const cspAugmentOptions = {
    scriptSrcTokens,
    gaScriptSrcTokens,
    gaEnabled: Boolean(gaInlineBody),
  };
  const existing = headers.get("content-security-policy") ?? "";
  if (!existing) {
    headers.set(
      "content-security-policy",
      "object-src 'none'; base-uri 'self'",
    );
  } else {
    headers.set(
      "content-security-policy",
      augmentExistingEnforcedCspForFrameworkScripts(
        existing,
        cspAugmentOptions,
      ),
    );
  }

  const scriptSrc = `script-src ${scriptSrcTokens.join(" ")}`;
  const existingRo = headers.get("content-security-policy-report-only") ?? "";
  if (!existingRo) {
    headers.set("content-security-policy-report-only", scriptSrc);
  } else {
    headers.set(
      "content-security-policy-report-only",
      augmentExistingReportOnlyCspForFrameworkScripts(
        existingRo,
        cspAugmentOptions,
      ),
    );
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
