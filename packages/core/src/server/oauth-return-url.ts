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

export function getWorkspaceGatewayReturnOrigin(): string {
  for (const raw of [
    process.env.WORKSPACE_GATEWAY_URL,
    process.env.VITE_WORKSPACE_GATEWAY_URL,
  ]) {
    const origin = normalizeOrigin(raw);
    if (origin && isLoopbackOrigin(origin)) return origin;
  }
  return "";
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
  opts: { allowDefaultLoopback?: boolean } = {},
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
  const safe = safeOAuthReturnUrl(raw, { allowDefaultLoopback: true });
  if (!sessionToken) return safe;
  try {
    const parsed = new URL(safe);
    if (!allowedOAuthReturnOrigins(true).has(parsed.origin)) return safe;
    parsed.searchParams.set("_session", sessionToken);
    return parsed.toString();
  } catch {
    return safe;
  }
}
