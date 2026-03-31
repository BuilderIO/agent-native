import {
  defineEventHandler,
  getQuery,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import {
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
} from "../lib/jira-auth.js";

export const getAtlassianAuthUrl = defineEventHandler(
  async (event: H3Event) => {
    if (
      !process.env.ATLASSIAN_CLIENT_ID ||
      !process.env.ATLASSIAN_CLIENT_SECRET
    ) {
      setResponseStatus(event, 422);
      return {
        error: "missing_credentials",
        message:
          "Atlassian OAuth credentials are not configured. Set ATLASSIAN_CLIENT_ID and ATLASSIAN_CLIENT_SECRET.",
      };
    }
    try {
      const redirectUri =
        (getQuery(event).redirect_uri as string) ||
        `${getOrigin(event)}/api/atlassian/callback`;
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
  },
);

export const handleAtlassianCallback = defineEventHandler(
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
        `${getOrigin(event)}/api/atlassian/callback`,
      );

      const { owner, hasProductionSession } = await resolveOAuthOwner(
        event,
        stateOwner,
      );

      const email = await exchangeCode(code, undefined, redirectUri, owner);

      const { sessionToken } = await createOAuthSession(event, email, {
        hasProductionSession,
        desktop,
      });

      return oauthCallbackResponse(event, email, {
        sessionToken,
        desktop,
        addAccount,
      });
    } catch (error: any) {
      const msg = error.message || "Unknown error";
      return oauthErrorPage(`Connection failed: ${msg}`);
    }
  },
);

export const getAtlassianStatus = defineEventHandler(async (event: H3Event) => {
  try {
    const session = await getSession(event);
    const status = await getAuthStatus(session?.email);
    return status;
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const disconnectAtlassian = defineEventHandler(
  async (event: H3Event) => {
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
  },
);
