import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import { completeOAuthCallback, rememberOAuthState } from "./oauth-session";
import {
  OAUTH_BASE_URL_KEY,
  OAUTH_OWNER_KEY_KEY,
  OAUTH_RETURN_PATH_KEY,
  OAUTH_STATE_KEY,
  OAUTH_TOKEN_STORE_KEY,
} from "./oauth-storage";
import {
  getSessionToken,
  saveSessionToken,
  SESSION_TOKEN_KEY,
} from "./session-token-store";

const dispatchApp = TEMPLATE_APPS.find((app) => app.id === "dispatch");
export const NATIVE_AUTH_BASE_URL =
  dispatchApp?.url ?? "https://dispatch.agent-native.com";

type NativeAuthResponse = {
  error?: unknown;
  email?: unknown;
  flowId?: unknown;
  orgId?: unknown;
  pending?: unknown;
  token?: unknown;
  verifier?: unknown;
};

function responseMessage(
  payload: NativeAuthResponse | null,
): string | undefined {
  return typeof payload?.error === "string" && payload.error.trim()
    ? payload.error.trim()
    : undefined;
}

export type NativeAuthMode = "sign-in" | "sign-up";

export interface NativeAuthResult {
  email: string;
  token: string;
  orgId?: string;
}

function cleanBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function readSessionIdentity(
  token: string,
  baseUrl: string,
): Promise<NativeAuthResult> {
  const response = await fetch(
    `${cleanBaseUrl(baseUrl)}/_agent-native/auth/session?_session=${encodeURIComponent(token)}`,
    { headers: { Accept: "application/json" } },
  );
  let payload: NativeAuthResponse | null = null;
  try {
    payload = (await response.json()) as NativeAuthResponse;
  } catch (error) {
    // The status below remains the source of truth when the server did not
    // return JSON.
    console.warn("[mobile auth] session response was not valid JSON", {
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }
  const email = typeof payload?.email === "string" ? payload.email.trim() : "";
  if (!response.ok || !email) {
    throw new Error("Sign-in did not create a usable session.");
  }
  const orgId =
    typeof payload?.orgId === "string" && payload.orgId.trim()
      ? payload.orgId.trim()
      : undefined;
  return { email, token, ...(orgId ? { orgId } : {}) };
}

/**
 * Check whether the stored credential is still a valid native parent session.
 * Child app sessions are intentionally not interchangeable with this token.
 */
export async function validateNativeSession(
  token: string | null,
  baseUrl = NATIVE_AUTH_BASE_URL,
): Promise<NativeAuthResult | null> {
  if (!token) return null;
  try {
    return await readSessionIdentity(token, baseUrl);
  } catch {
    return null;
  }
}
async function resolveGoogleAuthUrl(baseUrl: string): Promise<string> {
  const authUrl = new URL(
    `${cleanBaseUrl(baseUrl)}/_agent-native/google/auth-url`,
  );
  authUrl.searchParams.set("mobile", "1");
  const response = await fetch(authUrl.toString(), {
    headers: { Accept: "application/json" },
  });
  let payload: { error?: unknown; url?: unknown } | null = null;
  try {
    payload = (await response.json()) as { error?: unknown; url?: unknown };
  } catch (error) {
    // Use the status-based fallback below when the endpoint is not JSON.
    console.warn("[mobile auth] Google auth-url response was not valid JSON", {
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }
  if (!response.ok || typeof payload?.url !== "string" || !payload.url) {
    throw new Error(
      typeof payload?.error === "string" && payload.error.trim()
        ? payload.error.trim()
        : "Google sign-in is unavailable right now.",
    );
  }
  return payload.url;
}

async function waitForStoredParentSession(
  previousToken: string | null,
  timeoutMs = 8_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  do {
    const token = await getSessionToken();
    if (token && token !== previousToken) return token;
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  return null;
}

async function clearNativeOAuthContext(): Promise<void> {
  await AsyncStorage.multiRemove([
    OAUTH_STATE_KEY,
    OAUTH_RETURN_PATH_KEY,
    OAUTH_TOKEN_STORE_KEY,
    OAUTH_OWNER_KEY_KEY,
    OAUTH_BASE_URL_KEY,
  ]);
}

/**
 * Sign the native parent into Google. The browser owns Google's UI; the
 * callback is state-validated before its one-time session is stored under the
 * parent key. Child WebViews never receive the parent bearer.
 */
export async function signInWithGoogle({
  baseUrl = NATIVE_AUTH_BASE_URL,
}: {
  baseUrl?: string;
} = {}): Promise<NativeAuthResult> {
  const origin = cleanBaseUrl(baseUrl);
  const googleUrl = await resolveGoogleAuthUrl(origin);
  const previousToken = await getSessionToken();
  await rememberOAuthState(googleUrl);
  await AsyncStorage.multiSet([
    [OAUTH_RETURN_PATH_KEY, ""],
    [OAUTH_TOKEN_STORE_KEY, SESSION_TOKEN_KEY],
    [OAUTH_OWNER_KEY_KEY, ""],
    [OAUTH_BASE_URL_KEY, origin],
  ]);

  let token: string | null = null;
  let preserveAndroidOAuthContext = false;
  try {
    if (Platform.OS === "android") {
      const { preferredBrowserPackage } =
        await WebBrowser.getCustomTabsSupportingBrowsersAsync();
      await WebBrowser.openBrowserAsync(googleUrl, {
        browserPackage: preferredBrowserPackage,
        showInRecents: true,
      });
      preserveAndroidOAuthContext = true;
      token = await waitForStoredParentSession(previousToken);
    } else {
      const result = await WebBrowser.openAuthSessionAsync(
        googleUrl,
        "agentnative://oauth-complete",
      );
      if (result.type === "success" && result.url) {
        token = await completeOAuthCallback(result.url, {
          tokenKey: SESSION_TOKEN_KEY,
          ownerKeyName: null,
          baseUrl: origin,
        });
      }
      const storedToken = await getSessionToken();
      if (storedToken && storedToken !== previousToken) token = storedToken;
    }
  } finally {
    if (!preserveAndroidOAuthContext || token) {
      await clearNativeOAuthContext();
    }
  }

  if (!token) throw new Error("Google sign-in was cancelled.");
  return readSessionIdentity(token, origin);
}

async function readMagicLinkResponse(
  response: Response,
): Promise<NativeAuthResponse | null> {
  try {
    return (await response.json()) as NativeAuthResponse;
  } catch (error) {
    console.warn("[mobile auth] magic-link response was not valid JSON", {
      reason: error instanceof Error ? error.message : "unknown error",
    });
    return null;
  }
}

/**
 * Request and complete a parent magic-link sign-in. The verified browser
 * session is bridged through the existing single-use desktop exchange; no
 * child app page is opened and the bearer is stored only under the parent key.
 */
export async function signInWithMagicLink({
  email,
  baseUrl = NATIVE_AUTH_BASE_URL,
  timeoutMs = 5 * 60 * 1000,
}: {
  email: string;
  baseUrl?: string;
  timeoutMs?: number;
}): Promise<NativeAuthResult> {
  const normalizedEmail = email.trim();
  if (!normalizedEmail) throw new Error("Enter your email to continue.");
  const origin = cleanBaseUrl(baseUrl);
  const requestResponse = await fetch(
    `${origin}/_agent-native/auth/magic-link`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: normalizedEmail,
        callbackURL: "/_agent-native/auth/magic-link/desktop-callback",
      }),
    },
  );
  const requestPayload = await readMagicLinkResponse(requestResponse);
  if (!requestResponse.ok) {
    throw new Error(
      responseMessage(requestPayload) ??
        "Could not send a sign-in link. Please try again.",
    );
  }
  const flowId =
    typeof requestPayload?.flowId === "string" ? requestPayload.flowId : "";
  const verifier =
    typeof requestPayload?.verifier === "string" ? requestPayload.verifier : "";
  if (!flowId || !verifier) {
    throw new Error("The magic-link sign-in flow could not be initialized.");
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const exchangeUrl = new URL(
      `${origin}/_agent-native/auth/desktop-exchange`,
    );
    exchangeUrl.searchParams.set("flow_id", flowId);
    exchangeUrl.searchParams.set("verifier", verifier);
    const exchangeResponse = await fetch(exchangeUrl.toString(), {
      headers: { Accept: "application/json" },
    });
    const exchangePayload = await readMagicLinkResponse(exchangeResponse);
    if (!exchangeResponse.ok) {
      throw new Error(
        responseMessage(exchangePayload) ??
          "The magic-link sign-in flow could not be completed.",
      );
    }
    if (
      typeof exchangePayload?.error === "string" &&
      exchangePayload.error.trim()
    ) {
      throw new Error(exchangePayload.error.trim());
    }
    const token =
      typeof exchangePayload?.token === "string"
        ? exchangePayload.token.trim()
        : "";
    if (token) {
      const session = await readSessionIdentity(token, origin);
      await saveSessionToken(token);
      return session;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error("The magic link expired. Request a new link to continue.");
}

async function postPasswordAuth(
  mode: NativeAuthMode,
  email: string,
  password: string,
  baseUrl: string,
): Promise<NativeAuthResponse | null> {
  const response = await fetch(
    `${baseUrl.replace(/\/+$/, "")}/_agent-native/auth/${mode === "sign-up" ? "register" : "login"}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Request-Source": "mobile",
      },
      body: JSON.stringify({ email, password }),
    },
  );

  let payload: NativeAuthResponse | null = null;
  try {
    payload = (await response.json()) as NativeAuthResponse;
  } catch (error) {
    // The status below remains the source of truth when the server did not
    // return JSON.
    console.warn("[mobile auth] auth response was not valid JSON", {
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }

  if (!response.ok) {
    throw new Error(
      responseMessage(payload) ??
        (mode === "sign-up"
          ? "Could not create your account. Please try again."
          : "Sign in failed. Check your email and password."),
    );
  }
  return payload;
}

export async function authenticateWithPassword({
  mode,
  email,
  password,
  baseUrl = NATIVE_AUTH_BASE_URL,
}: {
  mode: NativeAuthMode;
  email: string;
  password: string;
  baseUrl?: string;
}): Promise<NativeAuthResult> {
  const normalizedEmail = email.trim();
  if (!normalizedEmail || !password) {
    throw new Error("Enter your email and password to continue.");
  }

  if (mode === "sign-up") {
    await postPasswordAuth("sign-up", normalizedEmail, password, baseUrl);
  }

  // Registration intentionally completes with the same login response shape
  // so the parent stores exactly one session credential for both paths.
  const payload = await postPasswordAuth(
    "sign-in",
    normalizedEmail,
    password,
    baseUrl,
  );

  const token = typeof payload?.token === "string" ? payload.token.trim() : "";
  const returnedEmail =
    typeof payload?.email === "string" && payload.email.trim()
      ? payload.email.trim()
      : email.trim();
  if (!token || !returnedEmail) {
    throw new Error(
      mode === "sign-up"
        ? "Account created, but sign-in could not finish. Check your email and try again."
        : "Sign in did not return a mobile session. Please try again.",
    );
  }

  await saveSessionToken(token);
  const orgId =
    typeof payload?.orgId === "string" && payload.orgId.trim()
      ? payload.orgId.trim()
      : undefined;
  return { email: returnedEmail, token, ...(orgId ? { orgId } : {}) };
}

export async function signInWithPassword(options: {
  email: string;
  password: string;
  baseUrl?: string;
}): Promise<NativeAuthResult> {
  return authenticateWithPassword({ ...options, mode: "sign-in" });
}
