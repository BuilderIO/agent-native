// Stub auth module — authentication is handled by the framework middleware.
// getIdToken returns null so existing fetch calls safely skip the Authorization header.
// In production, auth is enforced at the middleware layer via cookies.

import type { AuthSession } from "@agent-native/core";

export type AnalyticsAuth = AuthSession;

export async function getIdToken(): Promise<string | null> {
  return null;
}

export async function signOutUser(): Promise<void> {
  // no-op — use the logout endpoint instead
}
