import { loadString } from "./storage";

export function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, "");
}

export const SERVER_URL_STORAGE_KEY = "clips:server-url";

export const DEFAULT_SERVER_URL = import.meta.env.DEV
  ? "http://localhost:8094"
  : "https://clips.agent-native.com";

export function loadStoredServerUrl(): string {
  return normalizeServerUrl(
    loadString(SERVER_URL_STORAGE_KEY, DEFAULT_SERVER_URL),
  );
}
