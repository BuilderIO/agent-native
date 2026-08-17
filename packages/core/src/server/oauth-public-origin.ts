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

export function getPublicOAuthOrigin(): string {
  const config = getAppConfig();
  // An OAuth callback has to be publicly reachable, so a loopback origin is
  // useless and we keep looking. This used to walk eight env keys — each
  // canonical spelling followed by its `VITE_` mirror — so a loopback
  // `APP_URL` could still fall through to a public `BETTER_AUTH_URL`. Those
  // are one declared value now, so the skip is per concept, not per spelling.
  for (const raw of [
    config.workspace.oauthOrigin,
    config.app.url,
    config.workspace.gatewayUrl,
  ]) {
    const origin = normalizeOrigin(raw);
    if (origin && !isLoopbackOrigin(origin)) return origin;
  }
  return "";
}
