import AsyncStorage from "@react-native-async-storage/async-storage";

import { clipsSessionOwnerKey } from "./clips-session";
import { OAUTH_STATE_KEY } from "./oauth-storage";
import { saveSessionToken } from "./session-token-store";

// Custom-scheme callback URLs (agentnative://oauth-complete?…) don't parse
// reliably via `new URL` in React Native, so read the query string directly.
export function redirectParam(url: string, name: string): string | null {
  const queryStart = url.indexOf("?");
  if (queryStart < 0) return null;
  const value = new URLSearchParams(url.slice(queryStart + 1)).get(name);
  return value && value.length > 0 ? value : null;
}

// Validate a callback `state` against the one stored before the browser opened,
// consuming it so it can't be replayed. A custom URL scheme is not
// origin-authenticated, so without this a mismatched or forged callback could
// replace the active session. Both the iOS inline path and the deep-link
// handler must gate token acceptance on this.
export async function consumeOAuthStateMatches(
  state: string | null,
): Promise<boolean> {
  const expected = await AsyncStorage.getItem(OAUTH_STATE_KEY);
  await AsyncStorage.removeItem(OAUTH_STATE_KEY);
  return Boolean(expected) && state === expected;
}

// Clips needs an owner key (derived from email/orgId) alongside the token
// before its session counts as connected. The token alone can't produce it, so
// resolve the owner from the app's session endpoint using the saved token.
export async function resolveAndStoreOwnerKey(
  token: string,
  ownerKeyName: string | null,
  baseUrl: string | null,
): Promise<void> {
  if (!ownerKeyName || !baseUrl) return;
  try {
    const res = await fetch(
      `${baseUrl}/_agent-native/auth/session?_session=${encodeURIComponent(token)}`,
      { headers: { Accept: "application/json" } },
    );
    const data = (await res.json()) as { email?: unknown; orgId?: unknown };
    if (typeof data.email === "string" && data.email.trim()) {
      await AsyncStorage.setItem(
        ownerKeyName,
        clipsSessionOwnerKey(
          data.email,
          typeof data.orgId === "string" ? data.orgId : undefined,
        ),
      );
    }
  } catch {
    // Owner key will still be set by the WebView session bridge on next load.
  }
}

export interface OAuthCompletionContext {
  /** Session-token storage key (Clips uses its own; others the default). */
  tokenKey: string | null;
  /** Owner-key storage key, set only for Clips. */
  ownerKeyName: string | null;
  /** App origin, used to resolve the owner's email/orgId. */
  baseUrl: string | null;
}

// The single validated completion for an OAuth callback URL, shared by the iOS
// inline auth-session path and the Android deep-link handler. Validates the
// callback state, saves the session token under the given key, and resolves the
// Clips owner key. Returns the token on success, or null if the callback is
// invalid (no token or state mismatch).
export async function completeOAuthCallback(
  callbackUrl: string,
  ctx: OAuthCompletionContext,
): Promise<string | null> {
  const token = redirectParam(callbackUrl, "token");
  const state = redirectParam(callbackUrl, "state");
  if (!token || !(await consumeOAuthStateMatches(state))) return null;
  await saveSessionToken(token, ctx.tokenKey ?? undefined);
  await resolveAndStoreOwnerKey(token, ctx.ownerKeyName, ctx.baseUrl);
  return token;
}
