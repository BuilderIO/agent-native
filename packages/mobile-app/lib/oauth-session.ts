import AsyncStorage from "@react-native-async-storage/async-storage";

import { clipsSessionOwnerKey } from "./clips-session";
import { OAUTH_STATE_KEY } from "./oauth-storage";
import { saveSessionToken } from "./session-token-store";

export function redirectParam(url: string, name: string): string | null {
  const queryStart = url.indexOf("?");
  if (queryStart < 0) return null;
  const value = new URLSearchParams(url.slice(queryStart + 1)).get(name);
  return value && value.length > 0 ? value : null;
}

export async function rememberOAuthState(url: string): Promise<void> {
  const state = redirectParam(url, "state");
  if (!state) return;
  const existingState = await AsyncStorage.getItem(OAUTH_STATE_KEY);
  if (existingState && existingState !== state) {
    throw new Error("Another Google sign-in is already in progress.");
  }
  await AsyncStorage.setItem(OAUTH_STATE_KEY, state);
}

// handler must gate token acceptance on this.
export async function consumeOAuthStateMatches(
  state: string | null,
): Promise<boolean> {
  const expected = await AsyncStorage.getItem(OAUTH_STATE_KEY);
  const matches = Boolean(expected) && state === expected;
  if (matches) await AsyncStorage.removeItem(OAUTH_STATE_KEY);
  return matches;
}

// before its session counts as connected. The token alone can't produce it, so
export async function resolveAndStoreOwnerKey(
  token: string,
  ownerKeyName: string | null,
  baseUrl: string | null,
): Promise<void> {
  if (!ownerKeyName || !baseUrl) return;
  try {
    const res = await fetch(`${baseUrl}/_agent-native/auth/session`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
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
  tokenKey: string | null;
  ownerKeyName: string | null;
  baseUrl: string | null;
}

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
