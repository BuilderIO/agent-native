import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect } from "react";
import { Linking } from "react-native";

import { completeOAuthCallback } from "@/lib/oauth-session";
import {
  OAUTH_BASE_URL_KEY,
  OAUTH_OWNER_KEY_KEY,
  OAUTH_RETURN_PATH_KEY,
  OAUTH_TOKEN_STORE_KEY,
} from "@/lib/oauth-storage";

async function handleOAuthUrl(url: string | null): Promise<void> {
  console.log("[oauth] handleOAuthUrl saw url:", url);
  if (!url || !url.includes("oauth-complete")) return;
  // completeOAuthCallback consumes OAUTH_STATE_KEY itself; here we read the rest
  // of the context persisted before the browser opened (they survive an app
  // kill) so the completion is identical to the iOS inline path.
  const [returnPath, tokenKey, ownerKeyName, baseUrl] = await Promise.all([
    AsyncStorage.getItem(OAUTH_RETURN_PATH_KEY),
    AsyncStorage.getItem(OAUTH_TOKEN_STORE_KEY),
    AsyncStorage.getItem(OAUTH_OWNER_KEY_KEY),
    AsyncStorage.getItem(OAUTH_BASE_URL_KEY),
  ]);
  await AsyncStorage.multiRemove([
    OAUTH_RETURN_PATH_KEY,
    OAUTH_TOKEN_STORE_KEY,
    OAUTH_OWNER_KEY_KEY,
    OAUTH_BASE_URL_KEY,
  ]);
  const token = await completeOAuthCallback(url, {
    tokenKey,
    ownerKeyName,
    baseUrl,
  });
  console.log("[oauth] deep link handler. token saved:", !!token, returnPath);
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
