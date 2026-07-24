import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect } from "react";
import { Linking } from "react-native";

import { clipsSessionOwnerKey } from "@/lib/clips-session";
import {
  OAUTH_BASE_URL_KEY,
  OAUTH_OWNER_KEY_KEY,
  OAUTH_RETURN_PATH_KEY,
  OAUTH_STATE_KEY,
  OAUTH_TOKEN_STORE_KEY,
} from "@/lib/oauth-storage";
import { saveSessionToken } from "@/lib/session-token-store";

// Clips needs an owner key (email/orgId) alongside the token before its session
// counts as connected. The token alone can't produce it, so resolve the owner
// from the app's session endpoint using the freshly-saved token.
async function setOwnerKeyIfNeeded(
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
      console.log("[oauth] owner key set for", ownerKeyName);
    }
  } catch {
    // Owner key will still be set by the WebView session bridge on next load.
  }
}

// Custom-scheme URLs don't parse reliably via `new URL` in React Native, so
// read the query string directly.
function queryParams(url: string): URLSearchParams {
  const queryStart = url.indexOf("?");
  return new URLSearchParams(queryStart < 0 ? "" : url.slice(queryStart + 1));
}

async function handleOAuthUrl(url: string | null): Promise<void> {
  console.log("[oauth] handleOAuthUrl saw url:", url);
  if (!url || !url.includes("oauth-complete")) return;
  const params = queryParams(url);
  const token = params.get("token");
  const state = params.get("state");
  const [expectedState, returnPath, tokenKey, ownerKeyName, baseUrl] =
    await Promise.all([
      AsyncStorage.getItem(OAUTH_STATE_KEY),
      AsyncStorage.getItem(OAUTH_RETURN_PATH_KEY),
      AsyncStorage.getItem(OAUTH_TOKEN_STORE_KEY),
      AsyncStorage.getItem(OAUTH_OWNER_KEY_KEY),
      AsyncStorage.getItem(OAUTH_BASE_URL_KEY),
    ]);
  await AsyncStorage.multiRemove([
    OAUTH_STATE_KEY,
    OAUTH_RETURN_PATH_KEY,
    OAUTH_TOKEN_STORE_KEY,
    OAUTH_OWNER_KEY_KEY,
    OAUTH_BASE_URL_KEY,
  ]);
  const stateMatch = !!expectedState && state === expectedState;
  console.log(
    "[oauth] deep link handler. token:",
    !!token,
    "stateMatch:",
    stateMatch,
    "returnPath:",
    returnPath,
    "tokenKey:",
    tokenKey,
  );
  if (token && stateMatch) {
    await saveSessionToken(token, tokenKey ?? undefined);
    console.log("[oauth] token saved via deep link handler");
    await setOwnerKeyIfNeeded(token, ownerKeyName, baseUrl);
  }
  // Close the Custom Tab left open by openBrowserAsync (Android) so the app is
  // visible again. No-op if nothing is open.
  try {
    await WebBrowser.dismissBrowser();
  } catch {
    // Nothing to dismiss.
  }
  if (returnPath) router.replace(returnPath as never);
}

/**
 * Owns the agentnative://oauth-complete return, at the app root, so it works
 * even when the OS killed the app while it was in the Google sign-in browser
 * and cold-starts it from the deep link. getInitialURL covers that cold start;
 * the url listener covers a warm return. Running here (not in a route) sidesteps
 * expo-router's host/path ambiguity for agentnative://oauth-complete, which
 * otherwise lands the user on Home. The persisted return-path and token key
 * survive the app kill in AsyncStorage.
 */
export default function OAuthDeepLinkHandler() {
  useEffect(() => {
    console.log("[oauth] handler mounted");
    void Linking.getInitialURL().then((url) => {
      console.log("[oauth] getInitialURL:", url);
      return handleOAuthUrl(url);
    });
    const sub = Linking.addEventListener("url", (event) => {
      console.log("[oauth] url event:", event.url);
      void handleOAuthUrl(event.url);
    });
    return () => sub.remove();
  }, []);
  return null;
}
