/**
 * The framework's route namespace, in its two forms.
 *
 * Every framework route is registered under `/_agent-native`. That name is
 * the INTERNAL prefix: it is what `getH3App().use(...)` mounts, what handlers
 * see in `event.path`, and what the CSRF classifier and route discovery match
 * against. It never changes.
 *
 * A deployment may choose a different PUBLIC prefix (`runtime.frameworkRoutePrefix`
 * in `agent-native.config.ts`), because a gateway or reverse proxy in front of
 * the app may own the namespace. The public prefix is translated to the
 * internal one exactly once, at the request boundary, and every URL the
 * framework hands out (browser fetches, redirects, OAuth callbacks, self
 * dispatch) is built through `toPublicFrameworkPath` at the point it is
 * constructed. Nothing rewrites a response body.
 *
 * The two prefixes are one value by default, so the translation is a no-op
 * for every deployment that does not set the option.
 *
 * This module runs in the browser and on the server: no Node imports.
 */

export const FRAMEWORK_INTERNAL_ROUTE_PREFIX = "/_agent-native";

/**
 * The deployment alias for `runtime.frameworkRoutePrefix`. It is the same
 * name `agentNativeConfigEnvName(["runtime", "frameworkRoutePrefix"])`
 * derives, spelled out here because the server bundle reads it back as a
 * literal `process.env` key embedded at build time.
 */
export const FRAMEWORK_ROUTE_PREFIX_ENV =
  "AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX";

/**
 * Namespaces the framework already routes on, or that apps own by convention.
 * A public prefix that shadows one of these would make the request boundary
 * ambiguous: `/api/actions/...` could be an app route or a framework route.
 */
export const RESERVED_FRAMEWORK_ROUTE_PREFIXES = [
  "/api",
  "/mcp",
  "/.well-known",
  "/assets",
  "/sign-in",
  "/login",
  "/signup",
] as const;

const PREFIX_SHAPE = /^\/[A-Za-z0-9_-]+$/;
const HAS_ALNUM = /[A-Za-z0-9]/;

export class FrameworkRoutePrefixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameworkRoutePrefixError";
  }
}

/**
 * Validate a configured public prefix and return it in canonical form.
 *
 * The accepted shape is deliberately one segment of `[A-Za-z0-9_-]`. Nested
 * namespaces, dots, escapes, queries and trailing slashes all make
 * segment-aware matching and the CSRF classification harder to reason about;
 * they can be added later as their own change.
 *
 * `undefined` means "not configured" and resolves to the internal prefix.
 * Anything else that is not a valid prefix throws: an empty string or `/`
 * is a misconfiguration, not a request for the default.
 */
export function normalizeFrameworkRoutePrefix(
  value: unknown,
  source = "runtime.frameworkRoutePrefix",
): string {
  if (value === undefined) return FRAMEWORK_INTERNAL_ROUTE_PREFIX;
  if (typeof value !== "string") {
    throw new FrameworkRoutePrefixError(`${source} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") {
    throw new FrameworkRoutePrefixError(
      `${source} must be a single absolute path segment such as "/_agent-native"; omit it to keep the default`,
    );
  }
  if (!PREFIX_SHAPE.test(trimmed) || !HAS_ALNUM.test(trimmed)) {
    throw new FrameworkRoutePrefixError(
      `${source} must be one absolute path segment of letters, digits, "_" or "-" (received ${JSON.stringify(value)})`,
    );
  }
  const reserved = RESERVED_FRAMEWORK_ROUTE_PREFIXES.find(
    (candidate) => candidate.toLowerCase() === trimmed.toLowerCase(),
  );
  if (reserved) {
    throw new FrameworkRoutePrefixError(
      `${source} must not use the reserved namespace ${JSON.stringify(reserved)}`,
    );
  }
  return trimmed;
}

/** Segment-aware prefix test: `/_platform` matches `/_platform/x`, not `/_platform-extra`. */
export function matchesPathPrefix(pathname: string, prefix: string): boolean {
  if (!prefix) return false;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The remainder of `pathname` after a segment-aware `prefix`, always starting
 * with `/` (`/` for an exact match), or `null` when the prefix does not match.
 */
export function stripPathPrefix(
  pathname: string,
  prefix: string,
): string | null {
  if (!matchesPathPrefix(pathname, prefix)) return null;
  return pathname.slice(prefix.length) || "/";
}

export interface FrameworkRoutePrefixOptions {
  /** The validated public prefix. Equal to the internal prefix by default. */
  publicPrefix: string;
  /** The app base path (`/mail`), already normalized, or empty. */
  basePath?: string;
}

function normalizedBasePath(basePath: string | undefined): string {
  if (!basePath || basePath === "/") return "";
  return basePath;
}

/**
 * Translate an incoming PUBLIC request pathname to the INTERNAL pathname the
 * framework's mounts are registered on.
 *
 * Returns `null` when the request is not under the public framework prefix
 * (with or without the app base path) — including every request when the
 * public prefix is the default, so the boundary can skip the rewrite entirely.
 * The translation is idempotent: an internal pathname is never under the
 * public prefix once the two differ, so translating twice is translating once.
 */
export function toInternalFrameworkPath(
  pathname: string,
  { publicPrefix, basePath }: FrameworkRoutePrefixOptions,
): string | null {
  if (publicPrefix === FRAMEWORK_INTERNAL_ROUTE_PREFIX) return null;
  const base = normalizedBasePath(basePath);
  const swapped =
    (base &&
      swapPrefix(
        pathname,
        `${base}${publicPrefix}`,
        `${base}${FRAMEWORK_INTERNAL_ROUTE_PREFIX}`,
      )) ||
    swapPrefix(pathname, publicPrefix, FRAMEWORK_INTERNAL_ROUTE_PREFIX);
  return swapped;
}

/**
 * Replace a segment-aware `from` prefix with `to`, keeping the remainder
 * byte-for-byte (an exact match stays exact, a trailing slash stays), or
 * `null` when `from` does not match.
 */
function swapPrefix(pathname: string, from: string, to: string): string | null {
  if (!matchesPathPrefix(pathname, from)) return null;
  return `${to}${pathname.slice(from.length)}`;
}

/**
 * True when `pathname` addresses the framework namespace by its INTERNAL
 * name while a different public prefix is configured. Such a request must
 * not be served: the internal name is not part of the deployment's URL
 * surface, and answering it would keep a second, undeclared namespace alive.
 */
export function isInternalFrameworkPathLeak(
  pathname: string,
  { publicPrefix, basePath }: FrameworkRoutePrefixOptions,
): boolean {
  if (publicPrefix === FRAMEWORK_INTERNAL_ROUTE_PREFIX) return false;
  const base = normalizedBasePath(basePath);
  return (
    matchesPathPrefix(pathname, FRAMEWORK_INTERNAL_ROUTE_PREFIX) ||
    (base
      ? matchesPathPrefix(pathname, `${base}${FRAMEWORK_INTERNAL_ROUTE_PREFIX}`)
      : false)
  );
}

function swapInternalPrefix(
  pathname: string,
  publicPrefix: string,
  base: string,
): string {
  return (
    (base &&
      swapPrefix(
        pathname,
        `${base}${FRAMEWORK_INTERNAL_ROUTE_PREFIX}`,
        `${base}${publicPrefix}`,
      )) ||
    swapPrefix(pathname, FRAMEWORK_INTERNAL_ROUTE_PREFIX, publicPrefix) ||
    pathname
  );
}

/**
 * Build the PUBLIC form of a framework URL from its INTERNAL form.
 *
 * Accepts a bare pathname (`/_agent-native/actions/x`), a pathname carrying
 * the app base path (`/mail/_agent-native/actions/x`), either with a query or
 * fragment, or an absolute URL whose pathname has one of those shapes. Any
 * other input is returned unchanged, which is what makes it safe to apply at
 * every construction site: a path that is not under the internal prefix is
 * not a framework route of this deployment.
 *
 * It does NOT add the base path. Every existing construction site already
 * composes the base path its own way; this helper only renames the segment
 * so the base path is applied exactly once, by whoever applied it before.
 *
 * Never call this for a URL that targets a different installation — a peer
 * keeps its own declared namespace.
 */
export function toPublicFrameworkPath(
  path: string,
  { publicPrefix, basePath }: FrameworkRoutePrefixOptions,
): string {
  if (publicPrefix === FRAMEWORK_INTERNAL_ROUTE_PREFIX) return path;
  const base = normalizedBasePath(basePath);

  if (path.startsWith("/")) {
    const cut = path.search(/[?#]/);
    const pathname = cut === -1 ? path : path.slice(0, cut);
    const suffix = cut === -1 ? "" : path.slice(cut);
    return `${swapInternalPrefix(pathname, publicPrefix, base)}${suffix}`;
  }

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return path;
  let url: URL;
  try {
    url = new URL(path);
  } catch {
    return path;
  }
  const swapped = swapInternalPrefix(url.pathname, publicPrefix, base);
  if (swapped === url.pathname) return path;
  url.pathname = swapped;
  return url.toString();
}
