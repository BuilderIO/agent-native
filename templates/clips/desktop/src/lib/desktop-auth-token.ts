import { loadString } from "./storage";

// Kept out of app.tsx so overlay windows can read the token without loading the
// whole popover app.
const AUTH_TOKEN_KEY = "clips:auth-token";

export function originForUrl(value: string, base?: string): string | null {
  try {
    return new URL(value, base).origin;
  } catch {
    return null;
  }
}

export function originForServer(serverUrl: string): string {
  return originForUrl(serverUrl) ?? serverUrl.trim().replace(/\/+$/, "");
}

export function authTokenStorageKey(serverUrl: string): string {
  return `${AUTH_TOKEN_KEY}:${originForServer(serverUrl)}`;
}

export function loadDesktopAuthToken(serverUrl: string): string {
  return loadString(authTokenStorageKey(serverUrl), "");
}
