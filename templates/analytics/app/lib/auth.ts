import type { AuthSession } from "@agent-native/core";

export type AnalyticsAuth = AuthSession;

export async function getIdToken(): Promise<string | null> {
  return null;
}

export async function signOutUser(): Promise<void> {
  // no-op — use the logout endpoint instead
}
