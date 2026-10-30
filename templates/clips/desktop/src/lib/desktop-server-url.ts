import { originForServer } from "./desktop-auth-token";

export const LEGACY_PRODUCTION_SERVER_URL = "https://clips.agent-native.com";
export const NIGHTLY_DEFAULT_SERVER_URL = "https://beta.clips.agent-native.com";

export function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, "");
}

export function resolveDesktopServerUrl({
  storedServerUrl,
  defaultServerUrl,
  hasLegacyProductionToken,
  hasDefaultServerToken,
}: {
  storedServerUrl: string | null | undefined;
  defaultServerUrl: string;
  hasLegacyProductionToken: boolean;
  hasDefaultServerToken: boolean;
}): string {
  const stored = normalizeServerUrl(storedServerUrl ?? "");
  if (stored) return stored;

  const defaultUrl = normalizeServerUrl(defaultServerUrl);
  if (
    hasLegacyProductionToken &&
    !hasDefaultServerToken &&
    originForServer(defaultUrl) === originForServer(NIGHTLY_DEFAULT_SERVER_URL)
  ) {
    return LEGACY_PRODUCTION_SERVER_URL;
  }

  return defaultUrl;
}
