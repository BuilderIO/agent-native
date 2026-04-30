const ALLOWED_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
]);

const BLOCKED_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "forwarded",
  "host",
  "keep-alive",
  "origin",
  "proxy-authenticate",
  "proxy-authorization",
  "referer",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Path allowlist for the tool postMessage bridge.
 *
 * Tools can only call paths under `/_agent-native/*` (the framework's own
 * namespace). Template-defined `/api/*` routes are intentionally rejected:
 * those routes are written by app authors who may not consistently apply the
 * `accessFilter`/`assertAccess` access scoping helpers. A shared/org tool
 * running with the viewer's session should not be able to reach surfaces
 * outside the framework's own well-audited namespace.
 *
 * If a template needs a tool to reach a custom route, expose it via an
 * action (`defineAction` auto-mounts under `/_agent-native/actions/<name>`).
 */
export function isAllowedToolPath(path: string, toolId: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.includes("\\") || path.includes("\0")) return false;

  let pathname: string;
  try {
    const parsed = new URL(path, "http://agent-native.local");
    if (parsed.origin !== "http://agent-native.local") return false;
    pathname = parsed.pathname;
  } catch {
    return false;
  }

  const rawPathname = path.split("?")[0].split("#")[0];
  if (pathname !== rawPathname || pathname.includes("..")) return false;

  if (pathname.startsWith("/_agent-native/actions/")) return true;
  if (pathname.startsWith("/_agent-native/application-state/")) return true;

  if (pathname === "/_agent-native/tools/proxy") return true;
  if (pathname === "/_agent-native/tools/sql/query") return true;
  if (pathname === "/_agent-native/tools/sql/exec") return true;

  const parts = pathname.split("/");
  if (
    parts.length >= 6 &&
    parts.length <= 7 &&
    parts[1] === "_agent-native" &&
    parts[2] === "tools" &&
    parts[3] === "data"
  ) {
    try {
      return decodeURIComponent(parts[4]) === toolId;
    } catch {
      return false;
    }
  }

  return false;
}

export function sanitizeToolRequestOptions(value: unknown): RequestInit {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const method =
    typeof raw.method === "string" && raw.method.trim()
      ? raw.method.toUpperCase()
      : "GET";
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error("Tool request method is not allowed");
  }

  const headers =
    raw.headers && typeof raw.headers === "object"
      ? Object.fromEntries(
          Object.entries(raw.headers as Record<string, unknown>)
            .filter(([key, val]) => isAllowedHeader(key) && val !== undefined)
            .map(([key, val]) => [key, String(val)]),
        )
      : undefined;
  const body =
    typeof raw.body === "string" ||
    raw.body instanceof Blob ||
    raw.body instanceof FormData
      ? raw.body
      : raw.body === undefined
        ? undefined
        : JSON.stringify(raw.body);

  return {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  };
}

function isAllowedHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return HEADER_NAME_RE.test(name) && !BLOCKED_HEADERS.has(lower);
}
