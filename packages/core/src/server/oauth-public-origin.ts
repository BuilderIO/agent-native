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
