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
  encodeOAuthState,
  decodeOAuthState,
  resolveOAuthOwner,
  createOAuthSession,
  oauthCallbackResponse,
  oauthErrorPage,
  setDesktopExchange,
} from "@agent-native/core/server";
import {
  getAuthUrl,
  exchangeCode,
  getAuthStatus,
  disconnect,
} from "../lib/google-calendar.js";

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
      `${getOrigin(event)}/_agent-native/google/callback`;
    const session = await getSession(event);
    const owner =
      session?.email && session.email !== "local@localhost"
        ? session.email
        : undefined;
    const desktop =
      isElectron(event) || q.desktop === "1" || q.desktop === "true";
    const flowId = desktop ? (q.flow_id as string) || undefined : undefined;
    const state = encodeOAuthState(
      redirectUri,
      owner,
      desktop,
      false,
      "calendar",
      flowId,
    );
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
    try {
      const query = getQuery(event);
      const code = query.code as string;
      if (!code) {
        setResponseStatus(event, 400);
        return { error: "Missing authorization code" };
      }

      const {
        redirectUri,
        owner: stateOwner,
        desktop,
        addAccount,
        flowId,
      } = decodeOAuthState(
        query.state as string | undefined,
        `${getOrigin(event)}/_agent-native/google/callback`,
      );

      // 1. Resolve owner (needs session context, before exchangeCode)
      const { owner, hasProductionSession } = await resolveOAuthOwner(
        event,
        stateOwner,
      );

      // 2. Exchange code with Google (template-specific)
      const email = await exchangeCode(code, undefined, redirectUri, owner);

      // 3. Create session token (after we have the email)
      const { sessionToken } = await createOAuthSession(event, email, {
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
        addAccount,
        flowId,
      });
    } catch (error: any) {
      const msg = error.message || "Unknown error";
      const isPermission =
        msg.includes("Insufficient Permission") ||
        msg.includes("insufficient_scope");
      const userMessage = isPermission
        ? "This account wasn't granted the required permissions. Make sure you check all the permission boxes on the consent screen. If the app is in testing mode, add this email as a test user in Google Cloud Console."
        : `Connection failed: ${msg}`;
      return oauthErrorPage(userMessage);
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
        `${getOrigin(event)}/_agent-native/google/callback`;
      const desktop =
        isElectron(event) || q.desktop === "1" || q.desktop === "true";
      const flowId = desktop ? (q.flow_id as string) || undefined : undefined;
      const state = encodeOAuthState(
        redirectUri,
        session.email,
        desktop,
        true,
        "calendar",
        flowId,
      );
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
    try {
      const session = await getSession(event);
      const query = getQuery(event);
      const {
        redirectUri,
        owner: stateOwner,
        desktop,
      } = decodeOAuthState(
        query.state as string | undefined,
        `${getOrigin(event)}/_agent-native/google/add-account/callback`,
      );

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
      });
    } catch (error: any) {
      const msg = error.message || "Unknown error";
      const isPermission =
        msg.includes("Insufficient Permission") ||
        msg.includes("insufficient_scope");
      const userMessage = isPermission
        ? "This account wasn't granted the required permissions. Make sure you check all the permission boxes on the consent screen."
        : `Failed to add account: ${msg}`;
      return oauthErrorPage(userMessage);
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
