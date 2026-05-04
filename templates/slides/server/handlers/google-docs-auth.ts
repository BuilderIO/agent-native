import {
  defineEventHandler,
  getQuery,
  sendRedirect,
  setResponseStatus,
  type H3Event,
} from "h3";
import {
  decodeOAuthState,
  encodeOAuthState,
  getAppUrl,
  getSession,
  isElectron,
  oauthCallbackResponse,
  oauthErrorPage,
  resolveOAuthRedirectUri,
  safeReturnPath,
} from "@agent-native/core/server";
import {
  disconnectGoogleDocs,
  exchangeGoogleDocsCode,
  getGoogleDocsAccessToken,
  getGoogleDocsAuthUrl,
  getGooglePickerConfig,
  isGoogleDocsOAuthConfigured,
  listGoogleDocsAccounts,
} from "../lib/google-docs-oauth.js";

function permissionMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : String(error || "Unknown error");
  if (
    message.includes("Insufficient Permission") ||
    message.includes("insufficient_scope") ||
    message.includes("access_denied")
  ) {
    return "Google Docs access was denied. Connect again and approve the requested Google Drive file permission.";
  }
  return message;
}

async function requireSessionEmail(event: H3Event): Promise<string | null> {
  const session = await getSession(event);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return null;
  }
  return session.email;
}

export const getGoogleDocsAuthUrlHandler = defineEventHandler(
  async (event: H3Event) => {
    const owner = await requireSessionEmail(event);
    if (!owner) {
      return { error: "not_authenticated" };
    }

    if (!isGoogleDocsOAuthConfigured()) {
      setResponseStatus(event, 422);
      return {
        error: "missing_credentials",
        message:
          "Google OAuth credentials are not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      };
    }

    try {
      const q = getQuery(event);
      const redirectUri = resolveOAuthRedirectUri(
        event,
        "/_agent-native/google-docs/callback",
      );
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
      const requestedReturn =
        typeof q.return === "string" ? safeReturnPath(q.return) : "/";
      const returnUrl = requestedReturn !== "/" ? requestedReturn : undefined;
      const state = encodeOAuthState({
        redirectUri,
        owner,
        desktop,
        addAccount: true,
        app: "slides-google-docs",
        returnUrl,
        flowId,
      });
      const url = getGoogleDocsAuthUrl(redirectUri, state);
      if (q.redirect === "1") {
        return sendRedirect(event, url, 302);
      }
      return { url };
    } catch (error) {
      setResponseStatus(event, 500);
      return { error: permissionMessage(error) };
    }
  },
);

export const handleGoogleDocsCallback = defineEventHandler(
  async (event: H3Event) => {
    let desktop = false;
    let flowId: string | undefined;
    try {
      const query = getQuery(event);
      const state = decodeOAuthState(
        query.state as string | undefined,
        getAppUrl(event, "/_agent-native/google-docs/callback"),
      );
      desktop = state.desktop ?? false;
      flowId = state.flowId;

      const googleError = query.error as string | undefined;
      if (googleError) {
        const errorDesc =
          (query.error_description as string | undefined) || googleError;
        return oauthErrorPage(permissionMessage(new Error(errorDesc)));
      }

      const code = query.code as string | undefined;
      if (!code) {
        setResponseStatus(event, 400);
        return oauthErrorPage("Missing Google authorization code.");
      }

      const owner = state.owner || (await getSession(event))?.email;
      if (!owner) {
        setResponseStatus(event, 401);
        return oauthErrorPage("Session expired. Please log in and try again.");
      }

      const account = await exchangeGoogleDocsCode({
        code,
        redirectUri: state.redirectUri,
        owner,
      });

      return oauthCallbackResponse(event, account.email, {
        desktop,
        addAccount: true,
        returnUrl: state.returnUrl,
        flowId,
        appName: "Google Docs",
      });
    } catch (error) {
      return oauthErrorPage(`Google Docs connection failed: ${permissionMessage(error)}`);
    }
  },
);

export const getGoogleDocsStatus = defineEventHandler(
  async (event: H3Event) => {
    const owner = await requireSessionEmail(event);
    if (!owner) {
      return { error: "not_authenticated" };
    }

    try {
      const accounts = await listGoogleDocsAccounts(owner);
      const picker = getGooglePickerConfig();
      return {
        configured: isGoogleDocsOAuthConfigured(),
        connected: accounts.length > 0,
        accounts,
        pickerConfigured: !!(picker.apiKey && picker.appId),
        pickerApiKey: picker.apiKey,
        pickerAppId: picker.appId,
      };
    } catch (error) {
      setResponseStatus(event, 500);
      return { error: permissionMessage(error) };
    }
  },
);

export const getGoogleDocsPickerToken = defineEventHandler(
  async (event: H3Event) => {
    const owner = await requireSessionEmail(event);
    if (!owner) {
      return { error: "not_authenticated" };
    }

    if (!isGoogleDocsOAuthConfigured()) {
      setResponseStatus(event, 422);
      return {
        error: "missing_credentials",
        message:
          "Google OAuth credentials are not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      };
    }

    const picker = getGooglePickerConfig();
    if (!picker.apiKey || !picker.appId) {
      setResponseStatus(event, 422);
      return {
        error: "missing_picker_config",
        message:
          "Google Picker is not configured. Set GOOGLE_PICKER_API_KEY and GOOGLE_PICKER_APP_ID.",
      };
    }

    try {
      const token = await getGoogleDocsAccessToken(owner);
      if (!token) {
        setResponseStatus(event, 401);
        return {
          error: "not_connected",
          message: "Connect Google Docs before choosing a document.",
        };
      }
      return {
        ...token,
        apiKey: picker.apiKey,
        appId: picker.appId,
      };
    } catch (error) {
      setResponseStatus(event, 401);
      return { error: permissionMessage(error) };
    }
  },
);

export const disconnectGoogleDocsHandler = defineEventHandler(
  async (event: H3Event) => {
    const owner = await requireSessionEmail(event);
    if (!owner) {
      return { error: "not_authenticated" };
    }

    try {
      await disconnectGoogleDocs(owner);
      return { ok: true };
    } catch (error) {
      setResponseStatus(event, 500);
      return { error: permissionMessage(error) };
    }
  },
);
