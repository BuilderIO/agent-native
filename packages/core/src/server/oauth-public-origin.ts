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

export function getPublicOAuthOrigin(): string {
  for (const raw of [
    process.env.WORKSPACE_OAUTH_ORIGIN,
    process.env.VITE_WORKSPACE_OAUTH_ORIGIN,
    process.env.APP_URL,
    process.env.VITE_APP_URL,
    process.env.BETTER_AUTH_URL,
    process.env.VITE_BETTER_AUTH_URL,
  ]) {
    const origin = normalizeOrigin(raw);
    if (origin && !isLoopbackOrigin(origin)) return origin;
  }
  for (const raw of [
    process.env.WORKSPACE_GATEWAY_URL,
    process.env.VITE_WORKSPACE_GATEWAY_URL,
  ]) {
    const origin = normalizeOrigin(raw);
    if (origin && !isLoopbackOrigin(origin)) return origin;
  }
  return "";
}
