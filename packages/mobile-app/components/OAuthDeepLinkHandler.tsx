import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";
import { useEffect } from "react";
import { Linking, Platform } from "react-native";

import { navigateToPath } from "@/lib/navigation";
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
  const [returnPath, tokenKey, ownerKeyName, baseUrl] = await Promise.all([
    AsyncStorage.getItem(OAUTH_RETURN_PATH_KEY),
    AsyncStorage.getItem(OAUTH_TOKEN_STORE_KEY),
    AsyncStorage.getItem(OAUTH_OWNER_KEY_KEY),
    AsyncStorage.getItem(OAUTH_BASE_URL_KEY),
  ]);
  const token = await completeOAuthCallback(url, {
    tokenKey,
    ownerKeyName,
    baseUrl,
  });
  if (!token) return;
  await AsyncStorage.multiRemove([
    OAUTH_RETURN_PATH_KEY,
    OAUTH_TOKEN_STORE_KEY,
    OAUTH_OWNER_KEY_KEY,
    OAUTH_BASE_URL_KEY,
  ]);
  console.log("[oauth] deep link handler. token saved:", !!token, returnPath);
  try {
    await WebBrowser.dismissBrowser();
  } catch {
    // Nothing to dismiss.
  }
  if (returnPath) navigateToPath(returnPath, "replace");
}

export default function OAuthDeepLinkHandler() {
  useEffect(() => {
    console.log("[oauth] handler mounted");
    void Linking.getInitialURL().then((url) => {
      console.log("[oauth] getInitialURL:", url);
      return handleOAuthUrl(url);
    });
    if (Platform.OS === "ios") return;
    const sub = Linking.addEventListener("url", (event) => {
      console.log("[oauth] url event:", event.url);
      void handleOAuthUrl(event.url);
    });
    return () => sub.remove();
  }, []);
  return null;
}
