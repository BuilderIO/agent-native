import { loadString } from "./storage";

export function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, "");
}

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
  return normalizeServerUrl(
    loadString(SERVER_URL_STORAGE_KEY, DEFAULT_SERVER_URL),
  );
}
