import { getAppConfig } from "../app-config/index.js";

function normalizeOrigin(raw: string | undefined): string {
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function isBuilderPreviewOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (hostname === "builderio.xyz" ||
        hostname.endsWith(".builderio.xyz") ||
        hostname === "builderio.dev" ||
        hostname.endsWith(".builderio.dev") ||
        hostname === "builder.codes" ||
        hostname.endsWith(".builder.codes") ||
        hostname === "builder.my" ||
        hostname.endsWith(".builder.my"))
    );
  } catch {
    return false;
  }
}

export function getWorkspaceGatewayReturnOrigin(): string {
  // Loopback-only, inverted from getPublicOAuthOrigin: this is the local-dev
  // gateway a return URL may point back at.
  const origin = normalizeOrigin(getAppConfig().workspace.gatewayUrl);
  return origin && isLoopbackOrigin(origin) ? origin : "";
}

function allowedOAuthReturnOrigins(allowDefaultLoopback: boolean): Set<string> {
  const out = new Set<string>();
  const configured = getWorkspaceGatewayReturnOrigin();
  if (configured) out.add(configured);
  if (allowDefaultLoopback) out.add("http://127.0.0.1:8080");
  return out;
}

export function safeOAuthReturnUrl(
  raw: string | null | undefined,
  opts: {
    allowDefaultLoopback?: boolean;
    allowedOrigins?: Iterable<string | undefined>;
  } = {},
): string {
  if (!raw) return "/";
  if (/[\x00-\x1f]/.test(raw)) return "/";
  try {
    const parsed = new URL(raw, "http://safe-base.invalid");
    if (parsed.origin === "http://safe-base.invalid") {
      return parsed.pathname + parsed.search + parsed.hash;
    }
    const allowedOrigins = allowedOAuthReturnOrigins(
      opts.allowDefaultLoopback === true,
    );
    for (const origin of opts.allowedOrigins ?? []) {
      const normalized = normalizeOrigin(origin);
      if (normalized) allowedOrigins.add(normalized);
    }
    if (allowedOrigins.has(parsed.origin)) {
      return parsed.toString();
    }
  } catch {
    return "/";
  }
  return "/";
}

export function appendSessionToOAuthReturnUrl(
  raw: string | null | undefined,
  sessionToken: string | undefined,
): string {
  let safe = safeOAuthReturnUrl(raw, { allowDefaultLoopback: true });
  if (safe === "/" && raw && !/[\x00-\x1f]/.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (isBuilderPreviewOrigin(parsed.origin)) {
        safe = parsed.toString();
      }
    } catch {}
  }
  if (!sessionToken) return safe;
  try {
    const parsed = new URL(safe);
    if (
      !allowedOAuthReturnOrigins(true).has(parsed.origin) &&
      !isBuilderPreviewOrigin(parsed.origin)
    ) {
      return safe;
    }
    parsed.searchParams.set("_session", sessionToken);
    return parsed.toString();
  } catch {
    return safe;
  }
}
