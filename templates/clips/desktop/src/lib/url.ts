import { loadDesktopAuthToken } from "./desktop-auth-token";
import {
  LEGACY_PRODUCTION_SERVER_URL,
  normalizeServerUrl,
  resolveDesktopServerUrl,
} from "./desktop-server-url";
import { loadStringAllowEmpty, saveString } from "./storage";

export { normalizeServerUrl } from "./desktop-server-url";

export const SERVER_URL_STORAGE_KEY = "clips:server-url";

// The release workflow sets this for the Nightly channel only.
const BUILD_DEFAULT_SERVER_URL =
  import.meta.env.VITE_CLIPS_DEFAULT_SERVER_URL?.trim();

export const DEFAULT_SERVER_URL = import.meta.env.DEV
  ? "http://localhost:8094"
  : normalizeServerUrl(
      BUILD_DEFAULT_SERVER_URL || "https://clips.agent-native.com",
    );

export function loadStoredServerUrl(): string {
  return resolveDesktopServerUrl({
    storedServerUrl: loadStringAllowEmpty(SERVER_URL_STORAGE_KEY, ""),
    defaultServerUrl: DEFAULT_SERVER_URL,
    hasLegacyProductionToken: Boolean(
      loadDesktopAuthToken(LEGACY_PRODUCTION_SERVER_URL).trim(),
    ),
    hasDefaultServerToken: Boolean(
      loadDesktopAuthToken(DEFAULT_SERVER_URL).trim(),
    ),
  });
}

export function persistStoredServerUrl(serverUrl: string): void {
  const normalized = normalizeServerUrl(serverUrl);
  if (normalized) saveString(SERVER_URL_STORAGE_KEY, normalized);
}
