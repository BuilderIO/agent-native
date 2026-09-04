import { loadString } from "./storage";

/** Strip trailing slashes and whitespace from a server URL. */
export function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, "");
}

/** localStorage key the popover persists the connected server URL under. */
export const SERVER_URL_STORAGE_KEY = "clips:server-url";

// Sensible defaults so the user never has to type a URL on first launch.
// Dev builds point at the local dev server; production builds point at the
// hosted Clips instance. The user can still override from Settings.
// Dev points at the Clips dev server (shared-app-config says 8094).
export const DEFAULT_SERVER_URL = import.meta.env.DEV
  ? "http://localhost:8094"
  : "https://clips.agent-native.com";

/**
 * The server URL the desktop app is connected to, as the popover stored it.
 * All Tauri windows share one localStorage, so overlays (the meeting pill's
 * ask sheet) read the same value the popover saves in Settings.
 */
export function loadStoredServerUrl(): string {
  return normalizeServerUrl(
    loadString(SERVER_URL_STORAGE_KEY, DEFAULT_SERVER_URL),
  );
}
