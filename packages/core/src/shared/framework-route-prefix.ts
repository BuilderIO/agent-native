export const FRAMEWORK_INTERNAL_ROUTE_PREFIX = "/_agent-native";

export const FRAMEWORK_ROUTE_PREFIX_ENV =
  "AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX";

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

export function matchesPathPrefix(pathname: string, prefix: string): boolean {
  if (!prefix) return false;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function stripPathPrefix(
  pathname: string,
  prefix: string,
): string | null {
  if (!matchesPathPrefix(pathname, prefix)) return null;
  return pathname.slice(prefix.length) || "/";
}

export interface FrameworkRoutePrefixOptions {
  publicPrefix: string;
  basePath?: string;
}

function normalizedBasePath(basePath: string | undefined): string {
  if (!basePath || basePath === "/") return "";
  return basePath;
}

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

function swapPrefix(pathname: string, from: string, to: string): string | null {
  if (!matchesPathPrefix(pathname, from)) return null;
  return `${to}${pathname.slice(from.length)}`;
}

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
