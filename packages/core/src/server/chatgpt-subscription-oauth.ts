import crypto from "node:crypto";

import {
  deleteCookie,
  getCookie,
  getMethod,
  getQuery,
  getRequestHeader,
  setCookie,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  CHATGPT_SUBSCRIPTION_ENDPOINT,
  CHATGPT_SUBSCRIPTION_LAB_KEY,
} from "../agent/chatgpt-subscription-contract.js";
import { getUserLabs } from "../labs/store.js";
import {
  readOAuthCredentialState,
  markOAuthReconnectRequired,
  resolveOAuthCredentialAccess,
  revokeOAuthCredential,
  saveOAuthCredential,
  type OAuthCredential,
  type OAuthCredentialIdentity,
} from "../oauth-tokens/index.js";
import { decryptSecretValue, encryptSecretValue } from "../secrets/crypto.js";
import { getSession, redirectWithStagedCookies } from "./auth.js";
import {
  decodeOAuthState,
  encodeOAuthState,
  oauthErrorPage,
  resolveOAuthRedirectUri,
} from "./google-oauth.js";

export const CHATGPT_SUBSCRIPTION_OAUTH_PROVIDER = "openai-codex";
const CHATGPT_OAUTH_ISSUER = "https://auth.openai.com";
const CHATGPT_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CHATGPT_OAUTH_FLOW_COOKIE = "an_chatgpt_subscription_oauth";
const CHATGPT_OAUTH_FLOW_TTL_SECONDS = 10 * 60;
const CHATGPT_CALLBACK_PATH =
  "/_agent-native/agent-engine/chatgpt-subscription/callback";

interface ChatGPTSubscriptionCredential extends OAuthCredential {
  chatgptAccountId?: string;
  email?: string;
}

interface ChatGPTOAuthFlow {
  verifier: string;
  redirectUri: string;
  owner: string;
  flowId: string;
  expiresAt: number;
}

interface ChatGPTTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  expires_in?: unknown;
}

function credentialIdentity(email: string): OAuthCredentialIdentity {
  return {
    provider: CHATGPT_SUBSCRIPTION_OAUTH_PROVIDER,
    accountId: `user:${email.trim().toLowerCase()}`,
    resource: CHATGPT_SUBSCRIPTION_ENDPOINT,
    owner: { scope: "user", id: email },
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseJwtClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const decoded = Buffer.from(parts[1], "base64url").toString("utf8");
    const value: unknown = JSON.parse(decoded);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
    // coercion-ok: malformed JWT claims are absent metadata, never authentication success.
  } catch {
    return undefined;
  }
}

function extractAccountId(tokens: ChatGPTTokenResponse): string | undefined {
  for (const token of [tokens.id_token, tokens.access_token]) {
    const claims =
      typeof token === "string" ? parseJwtClaims(token) : undefined;
    const nested = claims?.["https://api.openai.com/auth"];
    const nestedClaims =
      nested && typeof nested === "object" && !Array.isArray(nested)
        ? (nested as Record<string, unknown>)
        : undefined;
    const accountId =
      text(claims?.chatgpt_account_id) ??
      text(nestedClaims?.chatgpt_account_id) ??
      (Array.isArray(claims?.organizations)
        ? text(
            (claims.organizations[0] as Record<string, unknown> | undefined)
              ?.id,
          )
        : undefined);
    if (accountId) return accountId;
  }
  return undefined;
}

function extractEmail(tokens: ChatGPTTokenResponse): string | undefined {
  for (const token of [tokens.id_token, tokens.access_token]) {
    const claims =
      typeof token === "string" ? parseJwtClaims(token) : undefined;
    const email = text(claims?.email);
    if (email) return email;
  }
  return undefined;
}

function tokenExpiry(expiresIn: unknown): number {
  const seconds = Number(expiresIn);
  return (
    Date.now() +
    (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1_000
  );
}

function isChatGPTCredential(
  value: OAuthCredential,
): value is ChatGPTSubscriptionCredential {
  return typeof value.tokens?.access_token === "string";
}

function toCredential(
  tokens: ChatGPTTokenResponse,
  previous?: ChatGPTSubscriptionCredential,
): ChatGPTSubscriptionCredential {
  const accessToken = text(tokens.access_token);
  if (!accessToken)
    throw new Error("ChatGPT OAuth did not return an access token.");
  const refreshToken =
    text(tokens.refresh_token) ?? previous?.tokens.refresh_token;
  const accountId = extractAccountId(tokens) ?? previous?.chatgptAccountId;
  const email = extractEmail(tokens) ?? previous?.email;
  return {
    tokens: {
      access_token: accessToken,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      ...(typeof tokens.id_token === "string"
        ? { id_token: tokens.id_token }
        : previous?.tokens.id_token
          ? { id_token: previous.tokens.id_token }
          : {}),
    },
    tokenExpiresAt: tokenExpiry(tokens.expires_in),
    ...(accountId ? { chatgptAccountId: accountId } : {}),
    ...(email ? { email } : {}),
  };
}

async function requestTokens(
  body: Record<string, string>,
): Promise<ChatGPTTokenResponse> {
  const response = await fetch(`${CHATGPT_OAUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok || !payload || typeof payload !== "object") {
    throw new Error(`ChatGPT OAuth token request failed (${response.status}).`);
  }
  return payload as ChatGPTTokenResponse;
}

async function exchangeCode(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<ChatGPTTokenResponse> {
  return requestTokens({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: CHATGPT_OAUTH_CLIENT_ID,
    code_verifier: verifier,
  });
}

async function refreshCredential(
  credential: ChatGPTSubscriptionCredential,
): Promise<ChatGPTSubscriptionCredential> {
  const refreshToken = text(credential.tokens.refresh_token);
  if (!refreshToken) throw new Error("ChatGPT OAuth refresh token is missing.");
  return toCredential(
    await requestTokens({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CHATGPT_OAUTH_CLIENT_ID,
    }),
    credential,
  );
}

export async function isChatGPTSubscriptionLabEnabled(
  email: string,
): Promise<boolean> {
  const labs = await getUserLabs(email);
  return labs[CHATGPT_SUBSCRIPTION_LAB_KEY] === true;
}

export async function hasChatGPTSubscriptionCredential(
  email: string,
): Promise<boolean> {
  if (!(await isChatGPTSubscriptionLabEnabled(email))) return false;
  const state = await readOAuthCredentialState<ChatGPTSubscriptionCredential>(
    credentialIdentity(email),
    { validateCredential: isChatGPTCredential },
  );
  return (
    (state.kind === "connected" || state.kind === "expired") &&
    (state.kind === "connected" ||
      Boolean(state.credential.tokens.refresh_token))
  );
}

export async function getChatGPTSubscriptionStatus(email: string): Promise<{
  labEnabled: boolean;
  connected: boolean;
  reconnectRequired: boolean;
  accountId: string | null;
}> {
  const labEnabled = await isChatGPTSubscriptionLabEnabled(email);
  if (!labEnabled) {
    return {
      labEnabled: false,
      connected: false,
      reconnectRequired: false,
      accountId: null,
    };
  }
  const state = await readOAuthCredentialState<ChatGPTSubscriptionCredential>(
    credentialIdentity(email),
    { validateCredential: isChatGPTCredential },
  );
  return {
    labEnabled,
    connected:
      state.kind === "connected" ||
      (state.kind === "expired" &&
        Boolean(state.credential.tokens.refresh_token)),
    reconnectRequired: state.kind === "reconnect_required",
    accountId:
      state.kind === "connected" || state.kind === "expired"
        ? (state.credential.chatgptAccountId ?? null)
        : null,
  };
}

export async function getChatGPTSubscriptionAccess(email: string): Promise<{
  accessToken: string;
  accountId?: string;
}> {
  if (!(await isChatGPTSubscriptionLabEnabled(email))) {
    throw new Error("Enable the ChatGPT subscription lab before using it.");
  }
  const identity = credentialIdentity(email);
  const result =
    await resolveOAuthCredentialAccess<ChatGPTSubscriptionCredential>(
      identity,
      {
        refresh: ({ credential }) => refreshCredential(credential),
        validateCredential: isChatGPTCredential,
      },
    );
  if (!result.accessToken) {
    throw new Error(
      result.state.kind === "reconnect_required"
        ? "Reconnect your ChatGPT subscription."
        : "Connect a ChatGPT subscription before using it.",
    );
  }
  return {
    accessToken: result.accessToken,
    accountId:
      result.state.kind === "connected" || result.state.kind === "expired"
        ? result.state.credential.chatgptAccountId
        : undefined,
  };
}

export async function markChatGPTSubscriptionReconnectRequired(
  email: string,
): Promise<void> {
  const state = await readOAuthCredentialState<ChatGPTSubscriptionCredential>(
    credentialIdentity(email),
    { validateCredential: isChatGPTCredential },
  );
  if (state.kind === "connected" || state.kind === "expired") {
    await markOAuthReconnectRequired(credentialIdentity(email), {
      validateCredential: isChatGPTCredential,
    });
  }
}

export async function disconnectChatGPTSubscription(
  email: string,
): Promise<void> {
  await revokeOAuthCredential(credentialIdentity(email), {
    validateCredential: isChatGPTCredential,
  });
}

function flowFromCookie(event: H3Event): ChatGPTOAuthFlow | null {
  const encoded = getCookie(event, CHATGPT_OAUTH_FLOW_COOKIE);
  if (!encoded) return null;
  try {
    const value: unknown = JSON.parse(decryptSecretValue(encoded));
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const flow = value as Partial<ChatGPTOAuthFlow>;
    return typeof flow.verifier === "string" &&
      typeof flow.redirectUri === "string" &&
      typeof flow.owner === "string" &&
      typeof flow.flowId === "string" &&
      typeof flow.expiresAt === "number"
      ? (flow as ChatGPTOAuthFlow)
      : null;
    // coercion-ok: an unreadable flow cookie is an absent OAuth flow, never a valid session.
  } catch {
    return null;
  }
}

function successPage(): Response {
  return new Response(
    '<!doctype html><html><head><meta charset="utf-8"><title>ChatGPT connected</title></head><body><p>ChatGPT subscription connected. You can close this window.</p><script>try{window.opener?.postMessage({type:"agent-native-chatgpt-subscription-connected"},window.location.origin)}catch{window.close()}setTimeout(()=>window.close(),250)</script></body></html>',
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

function failure(event: H3Event, status: number, message: string) {
  setResponseStatus(event, status);
  if ((getRequestHeader(event, "accept") ?? "").includes("text/html")) {
    return oauthErrorPage(message, status);
  }
  return { error: message };
}

export function createChatGPTSubscriptionOAuthStartHandler() {
  return async (event: H3Event) => {
    if (getMethod(event) !== "GET")
      return failure(event, 405, "Method not allowed.");
    let session;
    try {
      session = await getSession(event);
    } catch {
      return failure(event, 500, "Unable to read authentication session.");
    }
    if (!session?.email) return failure(event, 401, "Authentication required.");
    if (!(await isChatGPTSubscriptionLabEnabled(session.email))) {
      return failure(event, 404, "Enable the ChatGPT subscription lab first.");
    }

    const redirectUri = resolveOAuthRedirectUri(event, CHATGPT_CALLBACK_PATH);
    if (!redirectUri) return failure(event, 400, "Invalid OAuth redirect URI.");
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
    const flowId = crypto.randomUUID();
    const state = encodeOAuthState({
      redirectUri,
      owner: session.email,
      app: "chatgpt-subscription",
      flowId,
    });
    setCookie(
      event,
      CHATGPT_OAUTH_FLOW_COOKIE,
      encryptSecretValue(
        JSON.stringify({
          verifier,
          redirectUri,
          owner: session.email,
          flowId,
          expiresAt: Date.now() + CHATGPT_OAUTH_FLOW_TTL_SECONDS * 1_000,
        } satisfies ChatGPTOAuthFlow),
      ),
      {
        httpOnly: true,
        secure: redirectUri.startsWith("https://"),
        sameSite: "lax",
        path: "/",
        maxAge: CHATGPT_OAUTH_FLOW_TTL_SECONDS,
      },
    );
    const authorizationUrl = new URL(`${CHATGPT_OAUTH_ISSUER}/oauth/authorize`);
    authorizationUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: CHATGPT_OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: "openid profile email offline_access",
      code_challenge: challenge,
      code_challenge_method: "S256",
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      state,
      originator: "agent-native",
    }).toString();
    return redirectWithStagedCookies(event, authorizationUrl.href, 302);
  };
}

export function createChatGPTSubscriptionOAuthCallbackHandler() {
  return async (event: H3Event) => {
    if (getMethod(event) !== "GET")
      return failure(event, 405, "Method not allowed.");
    let session;
    try {
      session = await getSession(event);
    } catch {
      return failure(event, 500, "Unable to read authentication session.");
    }
    if (!session?.email) return failure(event, 401, "Authentication required.");
    if (!(await isChatGPTSubscriptionLabEnabled(session.email))) {
      return failure(event, 404, "Enable the ChatGPT subscription lab first.");
    }
    const flow = flowFromCookie(event);
    deleteCookie(event, CHATGPT_OAUTH_FLOW_COOKIE, { path: "/" });
    if (!flow || flow.expiresAt < Date.now()) {
      return failure(
        event,
        400,
        "The ChatGPT connection expired. Start again.",
      );
    }
    const query = getQuery(event);
    const providerError = text(query.error);
    if (providerError)
      return failure(event, 400, "ChatGPT authorization was not completed.");
    const code = text(query.code);
    const stateParam = text(query.state);
    if (!code || !stateParam)
      return failure(event, 400, "OAuth callback is missing code or state.");
    const state = decodeOAuthState(stateParam, "");
    if (
      !state.ok ||
      state.owner?.toLowerCase() !== session.email.toLowerCase() ||
      state.flowId !== flow.flowId ||
      state.redirectUri !== flow.redirectUri ||
      flow.owner.toLowerCase() !== session.email.toLowerCase()
    ) {
      return failure(
        event,
        400,
        "OAuth state rejected. Start the connection again.",
      );
    }
    try {
      const tokens = await exchangeCode(code, flow.verifier, flow.redirectUri);
      await saveOAuthCredential(
        credentialIdentity(session.email),
        toCredential(tokens),
      );
      return successPage();
    } catch (error) {
      return failure(
        event,
        502,
        error instanceof Error ? error.message : "ChatGPT connection failed.",
      );
    }
  };
}
