// ---------------------------------------------------------------------------
// Request-surface classification: distinguishes the framework-owned in-app
// chat/dev-frame/desktop surfaces from arbitrary browser requests so
// production code-editing tools stay blocked outside trusted surfaces.
// ---------------------------------------------------------------------------

export function isLocalhost(event: any): boolean {
  try {
    const host =
      event.node?.req?.headers?.host || event.headers?.get?.("host") || "";
    const hostname = host.split(":")[0];
    return (
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    );
  } catch {
    return false;
  }
}

export type AgentChatRequestSurface = "app" | "dev-frame" | "desktop";

function normalizeAgentChatRequestSurface(
  value: string | null | undefined,
): AgentChatRequestSurface | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (
    normalized === "app" ||
    normalized === "dev-frame" ||
    normalized === "desktop"
  ) {
    return normalized;
  }
  return null;
}

function isBrowserUserAgent(userAgent: string | null | undefined): boolean {
  return /Mozilla\/|Chrome\/|Safari\/|Firefox\/|Edg\//i.test(userAgent ?? "");
}

export function shouldBlockInProductCodeEditingSurface(input: {
  surface?: string | null;
  userAgent?: string | null;
  host?: string | null;
}): boolean {
  const surface = normalizeAgentChatRequestSurface(input.surface);
  if (surface === "dev-frame") return false;
  if (surface === "desktop") return false;
  if (surface === "app") return true;

  // Legacy clients used to send `frame` for any iframe, which includes the
  // app-rendered sidebar inside preview frames. Treat unknown explicit surface
  // values as app-owned so they cannot accidentally receive dev code tools.
  if (input.surface && input.surface.trim()) return true;

  const userAgent = input.userAgent ?? "";
  if (/AgentNativeDesktop/i.test(userAgent)) return false;

  // Missing header from an older browser client. Be conservative for browser
  // UAs on any host, because preview URLs can be non-local while still running
  // a dev-mode app whose in-product chat would be reloaded by source edits.
  if (isBrowserUserAgent(userAgent)) return true;

  const host = (input.host ?? "").toLowerCase();
  const hostname = host.split(":")[0] ?? "";
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}
