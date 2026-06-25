import { OAuthAccountOwnedByOtherUserError } from "@agent-native/core/oauth-tokens";
import {
  readBody,
  getSession,
  isElectron,
  getAppUrl,
  resolveGoogleSignInCredentials,
  resolveOAuthRedirectUri,
  encodeOAuthState,
  decodeOAuthState,
  resolveOAuthOwner,
  createOAuthSession,
  oauthCallbackResponse,
  oauthDesktopExchangePage,
  oauthErrorPage,
  setDesktopExchange,
  setDesktopExchangeError,
  safeReturnPath,
} from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  getAuthUrl,
  exchangeCode,
  getAuthStatus,
  disconnect,
} from "../lib/google-calendar.js";

const OAUTH_STATE_APP_ID = process.env.APP_NAME || "calendar";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_IDENTITY_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

function resolveCalendarOAuthCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function isCalendarConnectRequest(
  query: Record<string, any>,
  owner: string | undefined,
) {
  return (
    !!owner ||
    query.calendar === "1" ||
    query.calendar === "true" ||
    query.product === "calendar"
  );
}

async function exchangeIdentityCode(
  code: string,
  redirectUri: string,
): Promise<{
  email: string;
  id?: string;
  name?: string;
}> {
  const credentials = resolveGoogleSignInCredentials();
  if (!credentials) {
    throw new Error(
      "Google sign-in credentials are not configured. Set GOOGLE_SIGN_IN_CLIENT_ID and GOOGLE_SIGN_IN_CLIENT_SECRET.",
    );
  }

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(
      tokens.error_description || tokens.error || "Token exchange failed",
    );
  }

  const userRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const user = await userRes.json();
  const email = user.email as string | undefined;
  if (!email) throw new Error("Could not get email from Google");
  if (user.verified_email !== true) {
    throw new Error(
      "Google account email is not verified. Please verify your email with Google and try again.",
    );
  }

  return {
    email,
    id: typeof user.id === "string" ? user.id : undefined,
    name: typeof user.name === "string" ? user.name : undefined,
  };
}

function oauthRedirectResponse(url: string) {
  // h3 v2 sendRedirect returns an object the framework shim can stringify as
  // "[object Object]" in production auth-url popups. Native Response stays a
  // real 302 across the stack.
  return new Response(null, {
    status: 302,
    headers: { Location: url },
  });
}

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
    return oauthDesktopExchangePage("Returning to Calendar...");
  }
  return oauthErrorPage(payload.message);
}

export const getGoogleAuthUrl = defineEventHandler(async (event: H3Event) => {
  try {
    const q = getQuery(event);
    const redirectUri = resolveOAuthRedirectUri(event);
    if (!redirectUri) {
      setResponseStatus(event, 400);
      return {
        error: "invalid_redirect_uri",
        message: "redirect_uri must stay on this app's _agent-native routes.",
      };
    }
    const session = await getSession(event);
    const owner = session?.email;
    const desktop =
      isElectron(event) || q.desktop === "1" || q.desktop === "true";
    const flowId = desktop ? (q.flow_id as string) || undefined : undefined;
    const calendarConnect = isCalendarConnectRequest(q, owner);
    const credentials = calendarConnect
      ? resolveCalendarOAuthCredentials()
      : resolveGoogleSignInCredentials();

    if (!credentials) {
      setResponseStatus(event, 422);
      return {
        error: "missing_credentials",
        message: calendarConnect
          ? "Google Calendar OAuth credentials are not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
          : "Google sign-in credentials are not configured. Set GOOGLE_SIGN_IN_CLIENT_ID and GOOGLE_SIGN_IN_CLIENT_SECRET.",
      };
    }

    if (calendarConnect && !owner) {
      setResponseStatus(event, 401);
      return {
        error: "not_authenticated",
        message: "Sign in before connecting Google Calendar.",
      };
    }

    const requestedReturn =
      typeof q.return === "string" ? safeReturnPath(q.return) : "/";
    const returnUrl = requestedReturn !== "/" ? requestedReturn : undefined;
    // Use the named-arg overload — the positional form previously passed
    // `flowId` in the `returnUrl` slot, breaking desktop completion.
    const state = encodeOAuthState({
      redirectUri,
      owner,
      desktop,
      addAccount: calendarConnect,
      app: OAUTH_STATE_APP_ID,
      returnUrl,
      flowId,
    });

    const url = calendarConnect
      ? getAuthUrl(undefined, redirectUri, state)
      : `${GOOGLE_AUTH_URL}?${new URLSearchParams({
          client_id: credentials.clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: GOOGLE_IDENTITY_SCOPES.join(" "),
          access_type: "online",
          prompt: "select_account",
          state,
        })}`;
    if (q.redirect === "1") {
      return oauthRedirectResponse(url);
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
      desktop = state.desktop ?? false;
      flowId = state.flowId;

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

      if (!addAccount) {
        const identity = await exchangeIdentityCode(code, redirectUri);
        const { sessionToken } = await createOAuthSession(
          event,
          identity.email,
          {
            hasProductionSession,
            desktop,
            trackSignup: {
              authProvider: "google",
              authUserId: identity.id,
              name: identity.name,
            },
          },
        );

        if (flowId && sessionToken) {
          setDesktopExchange(flowId, sessionToken, identity.email);
        }

        return oauthCallbackResponse(event, identity.email, {
          sessionToken,
          desktop,
          returnUrl,
          flowId,
          appName: "Calendar",
        });
      }

      // 2. Exchange code with Google (template-specific Calendar connect)
      const email = await exchangeCode(code, undefined, redirectUri, owner);

      // 3. Create session token (after we have the email)
      // Skip for add-account flows — adding a second account must not switch
      // the current session. If the selected Google account differs from the
      // current owner, treat it as add-account even if older state omitted the
      // flag; otherwise the UI reloads as the newly selected account and loses
      // sight of the tokens that were saved under the original owner.
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
        flowId,
        appName: "Calendar",
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
      const redirectUri = resolveOAuthRedirectUri(event);
      if (!redirectUri) {
        setResponseStatus(event, 400);
        return {
          error: "invalid_redirect_uri",
          message: "redirect_uri must stay on this app's _agent-native routes.",
        };
      }
      const desktop =
        isElectron(event) || q.desktop === "1" || q.desktop === "true";
      const flowId = desktop ? (q.flow_id as string) || undefined : undefined;
      const state = encodeOAuthState({
        redirectUri,
        owner: session.email,
        desktop,
        addAccount: true,
        app: OAUTH_STATE_APP_ID,
        flowId,
      });
      const url = getAuthUrl(undefined, redirectUri, state);
      if (q.redirect === "1") {
        return oauthRedirectResponse(url);
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
      desktop = state.desktop ?? false;
      flowId = state.flowId;

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
        appName: "Calendar",
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
