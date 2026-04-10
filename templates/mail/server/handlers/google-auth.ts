import {
  defineEventHandler,
  getQuery,
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
import { setOAuthDisplayName } from "@agent-native/core/oauth-tokens";

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
    const redirectUri =
      (getQuery(event).redirect_uri as string) ||
      `${getOrigin(event)}/_agent-native/google/callback`;
    const session = await getSession(event);
    const owner =
      session?.email && session.email !== "local@localhost"
        ? session.email
        : undefined;
    const desktop = isElectron(event);
    const state = encodeOAuthState(redirectUri, owner, desktop);
    const url = getAuthUrl(undefined, redirectUri, state);
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
      const { sessionToken } = addAccount
        ? { sessionToken: undefined }
        : await createOAuthSession(event, email, {
            hasProductionSession,
            desktop,
          });

      // 4. Return platform-appropriate response
      return oauthCallbackResponse(event, email, {
        sessionToken,
        desktop,
        addAccount,
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
      const redirectUri =
        (getQuery(event).redirect_uri as string) ||
        `${getOrigin(event)}/_agent-native/google/callback`;
      const desktop = isElectron(event);
      const state = encodeOAuthState(redirectUri, session.email, desktop, true);
      const url = getAuthUrl(undefined, redirectUri, state);
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
