import {
  defineEventHandler,
  getQuery,
  sendRedirect,
  setResponseStatus,
  type H3Event,
} from "h3";
import {
  readBody,
  getSession,
  isElectron,
  getOrigin,
  getAppUrl,
  encodeOAuthState,
  decodeOAuthState,
  resolveOAuthOwner,
  createOAuthSession,
  oauthCallbackResponse,
  oauthDesktopExchangePage,
  oauthErrorPage,
  safeReturnPath,
  setDesktopExchange,
  setDesktopExchangeError,
  DEV_MODE_USER_EMAIL,
} from "@agent-native/core/server";
import {
  getAuthUrl,
  exchangeCode,
  getAuthStatus,
  disconnect,
  getClient,
  setAccountDisplayName,
} from "../lib/google-auth.js";
import { googleFetch } from "../lib/google-api.js";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import {
  OAuthAccountOwnedByOtherUserError,
  setOAuthDisplayName,
} from "@agent-native/core/oauth-tokens";

function googleOAuthErrorPayload(
  error: any,
  prefix = "Connection failed",
): {
  message: string;
  code?: string;
  accountId?: string;
  existingOwner?: string;
  attemptedOwner?: string;
} {
  if (
    error instanceof OAuthAccountOwnedByOtherUserError ||
    error?.name === "OAuthAccountOwnedByOtherUserError"
  ) {
    const account = error.accountId || "This Google account";
    const existingOwner = error.existingOwner || undefined;
    const attemptedOwner = error.attemptedOwner || undefined;
    const message = `${account} is connected to another login. Sign out, then sign in with ${account}.`;
    return {
      message,
      code: "account_owner_mismatch",
      accountId: error.accountId,
      existingOwner,
      attemptedOwner,
    };
  }

  const msg = error?.message || "Unknown error";
  const isPermission =
    msg.includes("Insufficient Permission") ||
    msg.includes("insufficient_scope");
  return {
    message: isPermission
      ? "This account wasn't granted the required permissions. Make sure you check all the permission boxes on the consent screen. If the app is in testing mode, add this email as a test user in Google Cloud Console."
      : `${prefix}: ${msg}`,
    code: isPermission ? "missing_google_permissions" : "google_oauth_failed",
  };
}

function googleOAuthErrorResponse(
  event: H3Event,
  error: any,
  opts: { desktop?: boolean; flowId?: string; prefix?: string } = {},
) {
  const payload = googleOAuthErrorPayload(error, opts.prefix);
  if (opts.desktop && opts.flowId) {
    setDesktopExchangeError(opts.flowId, payload);
    return oauthDesktopExchangePage("Returning to Mail...");
  }
  return oauthErrorPage(payload.message);
}

export const getGoogleAuthUrl = defineEventHandler(async (event: H3Event) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    setResponseStatus(event, 422);
    return {
      error: "missing_credentials",
      message:
        "Google OAuth credentials are not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    };
  }
  try {
    const q = getQuery(event);
    const redirectUri =
      (q.redirect_uri as string) ||
      getAppUrl(event, "/_agent-native/google/callback");
    const session = await getSession(event);
    const owner =
      session?.email && session.email !== DEV_MODE_USER_EMAIL
        ? session.email
        : undefined;
    const desktop =
      isElectron(event) || q.desktop === "1" || q.desktop === "true";
    const flowId = desktop ? (q.flow_id as string) || undefined : undefined;
    const requestedReturn =
      typeof q.return === "string" ? safeReturnPath(q.return) : "/";
    const returnUrl = requestedReturn !== "/" ? requestedReturn : undefined;
    // Use the named-arg overload — the positional form smuggled `flowId`
    // into the `returnUrl` slot in earlier revisions, which broke desktop
    // OAuth completion. See encodeOAuthState's docs.
    const state = encodeOAuthState({
      redirectUri,
      owner,
      desktop,
      addAccount: false,
      app: "mail",
      returnUrl,
      flowId,
    });
    const url = getAuthUrl(undefined, redirectUri, state);
    if (q.redirect === "1") {
      return sendRedirect(event, url, 302);
    }
    return { url };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const handleGoogleCallback = defineEventHandler(
  async (event: H3Event) => {
    let desktop = false;
    let flowId: string | undefined;
    try {
      const query = getQuery(event);
      const state = decodeOAuthState(
        query.state as string | undefined,
        getAppUrl(event, "/_agent-native/google/callback"),
      );
      desktop = state.desktop;
      flowId = state.flowId;

      // Handle Google authorization errors (e.g. user denied access, invalid client)
      const googleError = query.error as string | undefined;
      if (googleError) {
        const errorDesc =
          (query.error_description as string | undefined) || googleError;
        const isPermission =
          googleError === "access_denied" ||
          errorDesc.includes("Insufficient Permission");
        const userMessage = isPermission
          ? "Access was denied. Make sure to check all the permission boxes on the consent screen. If the app is in testing mode, add this email as a test user in Google Cloud Console."
          : `Connection failed: ${errorDesc}`;
        return googleOAuthErrorResponse(event, new Error(userMessage), {
          desktop,
          flowId,
        });
      }

      const code = query.code as string;
      if (!code) {
        setResponseStatus(event, 400);
        return { error: "Missing authorization code" };
      }

      const { redirectUri, owner: stateOwner, addAccount, returnUrl } = state;

      // 1. Resolve owner (needs session context, before exchangeCode)
      const { owner, hasProductionSession } = await resolveOAuthOwner(
        event,
        stateOwner,
      );

      // 2. Exchange code with Google (template-specific)
      const email = await exchangeCode(code, undefined, redirectUri, owner);

      // 2b. Auto-populate display name in settings if not set
      try {
        const client = await getClient(email);
        if (client) {
          const settings = (await getUserSetting(
            owner ?? email,
            "mail-settings",
          )) as Record<string, unknown> | null;
          if (!settings?.name) {
            const sendAs = await googleFetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs`,
              client.accessToken,
            );
            const match = sendAs?.sendAs?.find(
              (s: any) => s.sendAsEmail?.toLowerCase() === email.toLowerCase(),
            );
            if (match?.displayName) {
              setAccountDisplayName(email, match.displayName);
              await setOAuthDisplayName("google", email, match.displayName);
              await putUserSetting(owner ?? email, "mail-settings", {
                ...(settings || {}),
                name: match.displayName,
                email,
              });
            }
          }
        }
      } catch {
        // Non-critical — settings can be set manually later
      }

      // 3. Create session token (after we have the email)
      // Skip for add-account flows — adding a second account must not switch
      // the current session (the token is stored under the original owner).
      // Fallback: if the authenticated email differs from the session owner,
      // treat it as an add-account regardless of the state flag (guards against
      // state decode failures where addAccount is missing).
      const isAddAccount =
        addAccount || (owner !== undefined && email !== owner);
      const { sessionToken } = isAddAccount
        ? { sessionToken: undefined }
        : await createOAuthSession(event, email, {
            hasProductionSession,
            desktop,
          });

      if (flowId && sessionToken) {
        setDesktopExchange(flowId, sessionToken, email);
      }

      // 4. Return platform-appropriate response
      return oauthCallbackResponse(event, email, {
        sessionToken,
        desktop,
        addAccount: isAddAccount,
        returnUrl,
        flowId,
        appName: "Mail",
      });
    } catch (error: any) {
      return googleOAuthErrorResponse(event, error, { desktop, flowId });
    }
  },
);

export const getGoogleAddAccountUrl = defineEventHandler(
  async (event: H3Event) => {
    const session = await getSession(event);
    if (!session?.email) {
      setResponseStatus(event, 401);
      return { error: "Must be logged in to add an account" };
    }
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      setResponseStatus(event, 422);
      return {
        error: "missing_credentials",
        message:
          "Google OAuth credentials are not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      };
    }
    try {
      const q = getQuery(event);
      const redirectUri =
        (q.redirect_uri as string) ||
        getAppUrl(event, "/_agent-native/google/callback");
      const desktop =
        isElectron(event) || q.desktop === "1" || q.desktop === "true";
      const flowId = desktop ? (q.flow_id as string) || undefined : undefined;
      const state = encodeOAuthState({
        redirectUri,
        owner: session.email,
        desktop,
        addAccount: true,
        app: "mail",
        flowId,
      });
      const url = getAuthUrl(undefined, redirectUri, state);
      if (q.redirect === "1") {
        return sendRedirect(event, url, 302);
      }
      return { url };
    } catch (error: any) {
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  },
);

export const handleGoogleAddAccountCallback = defineEventHandler(
  async (event: H3Event) => {
    let desktop = false;
    let flowId: string | undefined;
    try {
      const session = await getSession(event);
      const query = getQuery(event);
      const state = decodeOAuthState(
        query.state as string | undefined,
        getAppUrl(event, "/_agent-native/google/add-account/callback"),
      );
      desktop = state.desktop;
      flowId = state.flowId;

      // Handle Google authorization errors (e.g. user denied access, invalid client)
      const googleError = query.error as string | undefined;
      if (googleError) {
        const errorDesc =
          (query.error_description as string | undefined) || googleError;
        const isPermission =
          googleError === "access_denied" ||
          errorDesc.includes("Insufficient Permission");
        const userMessage = isPermission
          ? "Access was denied. Make sure to check all the permission boxes on the consent screen. If the app is in testing mode, add this email as a test user in Google Cloud Console."
          : `Connection failed: ${errorDesc}`;
        return googleOAuthErrorResponse(event, new Error(userMessage), {
          desktop,
          flowId,
        });
      }

      const { redirectUri, owner: stateOwner } = state;

      const ownerEmail = session?.email || stateOwner;
      if (!ownerEmail) {
        return oauthErrorPage("Session expired. Please log in again.");
      }

      const code = query.code as string;
      if (!code) {
        setResponseStatus(event, 400);
        return oauthErrorPage("Missing authorization code.");
      }

      const addedEmail = await exchangeCode(
        code,
        undefined,
        redirectUri,
        ownerEmail,
      );

      return oauthCallbackResponse(event, addedEmail, {
        desktop,
        addAccount: true,
        appName: "Mail",
      });
    } catch (error: any) {
      return googleOAuthErrorResponse(event, error, {
        desktop,
        flowId,
        prefix: "Failed to add account",
      });
    }
  },
);

export const getGoogleStatus = defineEventHandler(async (event: H3Event) => {
  try {
    const session = await getSession(event);
    return await getAuthStatus(session?.email);
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const disconnectGoogle = defineEventHandler(async (event: H3Event) => {
  try {
    const session = await getSession(event);
    if (!session?.email) {
      setResponseStatus(event, 401);
      return { error: "Not authenticated" };
    }
    const body = await readBody(event);
    const targetEmail = body?.email as string | undefined;
    if (!targetEmail) {
      setResponseStatus(event, 400);
      return { error: "email is required" };
    }
    const owned = await getAuthStatus(session.email);
    const isOwned = owned.accounts.some((a) => a.email === targetEmail);
    if (!isOwned) {
      setResponseStatus(event, 403);
      return { error: "Cannot disconnect an account you don't own" };
    }
    await disconnect(targetEmail);
    return { success: true };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
