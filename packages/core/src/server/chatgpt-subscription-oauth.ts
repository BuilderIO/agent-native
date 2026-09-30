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
import * as jose from "jose";

import {
  CHATGPT_SUBSCRIPTION_ACTIVE_ACCOUNT_SETTING_KEY,
  CHATGPT_SUBSCRIPTION_AUTHORIZATION_ENDPOINT,
  CHATGPT_SUBSCRIPTION_CALLBACK_PATH,
  CHATGPT_SUBSCRIPTION_DYNAMIC_CLIENT_ID,
  CHATGPT_SUBSCRIPTION_HOST_ID_SETTING_KEY,
  CHATGPT_SUBSCRIPTION_ISSUER,
  CHATGPT_SUBSCRIPTION_JWKS_URI,
  CHATGPT_SUBSCRIPTION_OIDC_CONFIGURATION_URI,
  CHATGPT_SUBSCRIPTION_PROVIDER,
  CHATGPT_SUBSCRIPTION_REGISTRATIONS_SETTING_KEY,
  CHATGPT_SUBSCRIPTION_RESOURCE,
  CHATGPT_SUBSCRIPTION_SCOPES,
  CHATGPT_SUBSCRIPTION_TOKEN_ENDPOINT,
} from "../agent/chatgpt-subscription-contract.js";
import { getAppConfig } from "../app-config/index.js";
import {
  listOAuthAccountsByOwner,
  markOAuthReconnectRequired,
  readOAuthCredentialState,
  resolveOAuthCredentialAccess,
  revokeOAuthCredential,
  saveOAuthCredential,
  type OAuthCredential,
  type OAuthCredentialIdentity,
  type OAuthCredentialState,
} from "../oauth-tokens/index.js";
import { encryptSecretValue, decryptSecretValue } from "../secrets/crypto.js";
import { getSetting, mutateSetting } from "../settings/store.js";
import {
  getUserSetting,
  mutateUserSetting,
  putUserSetting,
  deleteUserSetting,
} from "../settings/user-settings.js";
import {
  getSession,
  isLoopbackRequest,
  redirectWithStagedCookies,
} from "./auth.js";
import { oauthErrorPage } from "./google-oauth.js";
import { getRequestContext } from "./request-context.js";

export const CHATGPT_SUBSCRIPTION_OAUTH_PROVIDER =
  CHATGPT_SUBSCRIPTION_PROVIDER;

const CHATGPT_OAUTH_FLOW_COOKIE = "an_chatgpt_subscription_oauth";
const CHATGPT_OAUTH_FLOW_TTL_SECONDS = 10 * 60;
const CHATGPT_OAUTH_HOST_ID_RE =
  /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHATGPT_ACCOUNT_ID_RE = /^siwc_[a-f0-9]{64}$/;
const LEGACY_CHATGPT_SUBSCRIPTION_RESOURCE =
  "https://chatgpt.com/backend-api/codex/responses";
const LEGACY_RESOURCE_SUFFIX = `:resource:${crypto
  .createHash("sha256")
  .update(LEGACY_CHATGPT_SUBSCRIPTION_RESOURCE)
  .digest("hex")}`;
const ISSUED_CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,256}$/;
const STATE_RE = /^[A-Za-z0-9_-]{43}$/;
const RESOURCE_SUFFIX = `:resource:${crypto
  .createHash("sha256")
  .update(CHATGPT_SUBSCRIPTION_RESOURCE)
  .digest("hex")}`;

interface ChatGPTSubscriptionCredential extends OAuthCredential {
  clientId: string;
  subject: string;
  email?: string;
  displayName?: string;
  chatgptAccountId?: string;
  idToken: string;
  extAgentHostId: string;
  grantedScopes: string[];
}

interface ChatGPTSubscriptionRegistration {
  id: string;
  clientId: string;
  subject: string;
  extAgentHostId: string;
  email?: string;
  displayName?: string;
  chatgptAccountId?: string;
}

interface ChatGPTOAuthFlow {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  owner: string;
  flowId: string;
  hostId: string;
  expiresAt: number;
  mode: "new" | "existing";
  accountId?: string;
  clientId?: string;
}

interface ChatGPTTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

class ChatGPTTokenRequestError extends Error {
  constructor(
    status: number,
    readonly oauthError: string | undefined,
  ) {
    super(`ChatGPT OAuth token request failed (${status}).`);
  }
}

function shouldReconnectAfterChatGPTRefreshFailure(error: unknown): boolean {
  return (
    error instanceof ChatGPTTokenRequestError &&
    error.oauthError === "invalid_grant"
  );
}

export interface ChatGPTSubscriptionAccountSummary {
  id: string;
  email: string | null;
  label: string;
  connected: boolean;
  reconnectRequired: boolean;
  planUsageEnabled: boolean;
  active: boolean;
}

export interface ChatGPTSubscriptionStatus {
  supported: boolean;
  localLoopback: boolean;
  supportReason: "requires_local_loopback" | null;
  connected: boolean;
  reconnectRequired: boolean;
  /** Retained for callers that used the former ChatGPT account header value. */
  accountId: string | null;
  activeAccountId: string | null;
  activeAccount: ChatGPTSubscriptionAccountSummary | null;
  accounts: ChatGPTSubscriptionAccountSummary[];
  legacyRegistrationCleanupAvailable: boolean;
}

function normalizedEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error("A signed-in user is required.");
  return normalized;
}

function credentialOwner(email: string): string {
  return `user:${normalizedEmail(email)}`;
}

function credentialIdentity(
  email: string,
  accountId: string,
): OAuthCredentialIdentity {
  return {
    provider: CHATGPT_SUBSCRIPTION_OAUTH_PROVIDER,
    accountId,
    resource: CHATGPT_SUBSCRIPTION_RESOURCE,
    owner: { scope: "user", id: normalizedEmail(email) },
  };
}

function legacyCredentialIdentity(email: string): OAuthCredentialIdentity {
  const normalized = normalizedEmail(email);
  return {
    provider: CHATGPT_SUBSCRIPTION_OAUTH_PROVIDER,
    accountId: `user:${normalized}`,
    resource: LEGACY_CHATGPT_SUBSCRIPTION_RESOURCE,
    owner: { scope: "user", id: normalized },
  };
}

async function hasLegacyCredential(email: string): Promise<boolean> {
  const identity = legacyCredentialIdentity(email);
  const rows = await listOAuthAccountsByOwner(
    identity.provider,
    credentialOwner(email),
  );
  return rows.some(
    (row) => row.accountId === `${identity.accountId}${LEGACY_RESOURCE_SUFFIX}`,
  );
}

export async function removeLegacyChatGPTSubscriptionCredential(
  email: string,
): Promise<{ removed: boolean; remoteRevocationConfirmed: false }> {
  const identity = legacyCredentialIdentity(email);
  if (!(await hasLegacyCredential(email))) {
    return { removed: false, remoteRevocationConfirmed: false };
  }
  const result = await revokeOAuthCredential(identity);
  return {
    removed: result.local === "deleted",
    remoteRevocationConfirmed: false,
  };
}

function requiredText(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    throw new Error(`ChatGPT OAuth did not return a valid ${field}.`);
  }
  return value;
}

function parseQueryText(
  query: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    throw new Error(`OAuth callback contains an invalid ${key}.`);
  }
  return value;
}

function accountRegistrationId(
  email: string,
  clientId: string,
  subject: string,
): string {
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify([normalizedEmail(email), clientId, subject]))
    .digest("hex");
  return `siwc_${digest}`;
}

function isIssuedClientId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISSUED_CLIENT_ID_RE.test(value) &&
    value !== CHATGPT_SUBSCRIPTION_DYNAMIC_CLIENT_ID
  );
}

function hasAllRequiredScopes(scopes: readonly string[]): boolean {
  const granted = new Set(scopes);
  return CHATGPT_SUBSCRIPTION_SCOPES.every((scope) => granted.has(scope));
}

export function parseChatGPTSubscriptionScopes(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("ChatGPT OAuth returned no granted scopes.");
  }
  const scopes = [...new Set(value.trim().split(/\s+/))];
  const missing = CHATGPT_SUBSCRIPTION_SCOPES.filter(
    (scope) => !scopes.includes(scope),
  );
  if (missing.length > 0) {
    throw new Error(
      `ChatGPT OAuth did not grant required scope(s): ${missing.join(", ")}.`,
    );
  }
  return scopes;
}

export function isChatGPTSubscriptionLoopbackCallbackUri(
  value: unknown,
): value is string {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === CHATGPT_SUBSCRIPTION_CALLBACK_PATH &&
    url.search === "" &&
    url.hash === "" &&
    url.port !== "0" &&
    url.href === value
  );
}

function exactLoopbackSocketAddress(
  address: string | null | undefined,
): boolean {
  return address === "127.0.0.1" || address === "::ffff:127.0.0.1";
}

function callbackUriForEvent(event: H3Event): string | null {
  const host = getRequestHeader(event, "host");
  const request = event.node?.req;
  const socket = request?.socket;
  if (
    !host ||
    host.trim() !== host ||
    getRequestHeader(event, "x-forwarded-host") ||
    getRequestHeader(event, "x-forwarded-proto") ||
    !isLoopbackRequest(event) ||
    !socket ||
    ("encrypted" in socket && socket.encrypted) ||
    !exactLoopbackSocketAddress(socket.localAddress)
  ) {
    return null;
  }
  const originValue = `http://${host}`;
  if (!URL.canParse(originValue)) return null;
  const origin = new URL(originValue);
  if (
    origin.hostname !== "127.0.0.1" ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    return null;
  }
  const callbackUri = `${origin.origin}${CHATGPT_SUBSCRIPTION_CALLBACK_PATH}`;
  return isChatGPTSubscriptionLoopbackCallbackUri(callbackUri)
    ? callbackUri
    : null;
}

function currentRequestIsLocalLoopback(): boolean {
  const context = getRequestContext();
  if (!context?.isLoopbackRequest || !context.requestOrigin) return false;
  if (!URL.canParse(context.requestOrigin)) return false;
  const origin = new URL(context.requestOrigin);
  return (
    origin.protocol === "http:" &&
    origin.hostname === "127.0.0.1" &&
    origin.username === "" &&
    origin.password === "" &&
    origin.pathname === "/" &&
    origin.search === "" &&
    origin.hash === ""
  );
}

async function stableHostId(): Promise<string> {
  const current = await getSetting(CHATGPT_SUBSCRIPTION_HOST_ID_SETTING_KEY, {
    bypassCache: true,
  });
  if (current !== null) {
    if (
      typeof current.hostId !== "string" ||
      !CHATGPT_OAUTH_HOST_ID_RE.test(current.hostId)
    ) {
      throw new Error(
        `The saved ChatGPT host ID at ${CHATGPT_SUBSCRIPTION_HOST_ID_SETTING_KEY} is invalid.`,
      );
    }
    return current.hostId;
  }

  const created = `urn:uuid:${crypto.randomUUID()}`;
  const stored = await mutateSetting(
    CHATGPT_SUBSCRIPTION_HOST_ID_SETTING_KEY,
    (previous) => previous ?? { hostId: created },
  );
  if (
    typeof stored.hostId !== "string" ||
    !CHATGPT_OAUTH_HOST_ID_RE.test(stored.hostId)
  ) {
    throw new Error(
      `The saved ChatGPT host ID at ${CHATGPT_SUBSCRIPTION_HOST_ID_SETTING_KEY} is invalid.`,
    );
  }
  return stored.hostId;
}

function appNameHint(): string {
  const app = getAppConfig().app;
  const name =
    typeof app?.name === "string" && app.name.trim()
      ? app.name.trim()
      : typeof app?.slug === "string" && app.slug.trim()
        ? app.slug.trim()
        : "";
  if (!name) {
    throw new Error(
      "Set an app name in agent-native.json before registering a ChatGPT client.",
    );
  }
  return name;
}

function tokenExpiry(expiresIn: unknown): number {
  if (
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new Error("ChatGPT OAuth returned an invalid token expiry.");
  }
  return Date.now() + expiresIn * 1_000;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalClaimText(
  payload: jose.JWTPayload,
  name: string,
): string | undefined {
  const value = payload[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`ChatGPT ID token has an invalid ${name} claim.`);
  }
  return value.trim();
}

function optionalChatGPTAccountId(
  payload: jose.JWTPayload,
): string | undefined {
  const topLevel = optionalClaimText(payload, "chatgpt_account_id");
  const rawNested = payload["https://api.openai.com/auth"];
  if (rawNested === undefined) return topLevel;
  const nested = record(rawNested);
  if (!nested) {
    throw new Error("ChatGPT ID token has invalid authentication metadata.");
  }
  if (nested.chatgpt_account_id === undefined) return topLevel;
  if (
    typeof nested.chatgpt_account_id !== "string" ||
    !nested.chatgpt_account_id.trim()
  ) {
    throw new Error("ChatGPT ID token has an invalid ChatGPT account claim.");
  }
  return topLevel ?? nested.chatgpt_account_id.trim();
}

const OPENAI_JWKS = jose.createRemoteJWKSet(
  new URL(CHATGPT_SUBSCRIPTION_JWKS_URI),
);

export async function verifyChatGPTSubscriptionIdToken(
  token: string,
  clientId: string,
  nonce: string,
  keySet = OPENAI_JWKS,
): Promise<{
  subject: string;
  email?: string;
  displayName?: string;
  chatgptAccountId?: string;
}> {
  const { payload } = await jose.jwtVerify(token, keySet, {
    issuer: CHATGPT_SUBSCRIPTION_ISSUER,
    audience: clientId,
    requiredClaims: ["sub", "iss", "aud", "exp", "iat", "nonce"],
  });
  const subject = optionalClaimText(payload, "sub");
  if (!subject) throw new Error("ChatGPT ID token has no valid subject.");
  if (payload.nonce !== nonce) {
    throw new Error("ChatGPT ID token nonce does not match this sign-in.");
  }
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (
    audiences.length === 0 ||
    !audiences.every((audience) => typeof audience === "string") ||
    !audiences.includes(clientId) ||
    (audiences.length > 1 && payload.azp !== clientId) ||
    (payload.azp !== undefined && payload.azp !== clientId)
  ) {
    throw new Error("ChatGPT ID token audience does not match this client.");
  }
  const email = optionalClaimText(payload, "email");
  const displayName = optionalClaimText(payload, "name");
  return {
    subject,
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {}),
    ...(optionalChatGPTAccountId(payload)
      ? { chatgptAccountId: optionalChatGPTAccountId(payload) }
      : {}),
  };
}

function isChatGPTCredential(
  value: OAuthCredential,
): value is ChatGPTSubscriptionCredential {
  if (
    typeof value.tokens?.access_token !== "string" ||
    typeof value.tokens.refresh_token !== "string" ||
    !isIssuedClientId(value.clientId) ||
    typeof value.subject !== "string" ||
    !value.subject.trim() ||
    typeof value.idToken !== "string" ||
    !value.idToken ||
    typeof value.extAgentHostId !== "string" ||
    !CHATGPT_OAUTH_HOST_ID_RE.test(value.extAgentHostId) ||
    typeof value.tokenExpiresAt !== "number" ||
    !Number.isFinite(value.tokenExpiresAt) ||
    !Array.isArray(value.grantedScopes) ||
    !value.grantedScopes.every((scope) => typeof scope === "string") ||
    !hasAllRequiredScopes(value.grantedScopes)
  ) {
    return false;
  }
  return true;
}

function isConnectedState(
  state: OAuthCredentialState<ChatGPTSubscriptionCredential>,
): state is OAuthCredentialState<ChatGPTSubscriptionCredential> & {
  kind: "connected" | "expired";
} {
  return state.kind === "connected" || state.kind === "expired";
}

function identityFromStoredAccountId(storedAccountId: string): string | null {
  if (!storedAccountId.endsWith(RESOURCE_SUFFIX)) return null;
  const accountId = storedAccountId.slice(0, -RESOURCE_SUFFIX.length);
  return CHATGPT_ACCOUNT_ID_RE.test(accountId) ? accountId : null;
}

async function readActiveAccountId(email: string): Promise<string | null> {
  const setting = await getUserSetting(
    normalizedEmail(email),
    CHATGPT_SUBSCRIPTION_ACTIVE_ACCOUNT_SETTING_KEY,
  );
  if (setting === null) return null;
  if (
    typeof setting.accountId !== "string" ||
    !CHATGPT_ACCOUNT_ID_RE.test(setting.accountId)
  ) {
    throw new Error(
      "The active ChatGPT subscription account setting is invalid.",
    );
  }
  return setting.accountId;
}

function parseRegistrationIndex(
  email: string,
  setting: Record<string, unknown> | null,
): Map<string, ChatGPTSubscriptionRegistration> {
  if (setting === null) return new Map();
  if (setting.version !== 1 || typeof setting.encrypted !== "string") {
    throw new Error("The saved ChatGPT registration index is invalid.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptSecretValue(setting.encrypted));
  } catch {
    throw new Error(
      "The saved ChatGPT registration index cannot be decrypted.",
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("The saved ChatGPT registration index is invalid.");
  }
  const registrations = new Map<string, ChatGPTSubscriptionRegistration>();
  for (const value of parsed) {
    const item = record(value);
    if (
      !item ||
      typeof item.id !== "string" ||
      !CHATGPT_ACCOUNT_ID_RE.test(item.id) ||
      !isIssuedClientId(item.clientId) ||
      typeof item.subject !== "string" ||
      !item.subject.trim() ||
      typeof item.extAgentHostId !== "string" ||
      !CHATGPT_OAUTH_HOST_ID_RE.test(item.extAgentHostId)
    ) {
      throw new Error("The saved ChatGPT registration index is invalid.");
    }
    const optional: Partial<
      Pick<
        ChatGPTSubscriptionRegistration,
        "email" | "displayName" | "chatgptAccountId"
      >
    > = {};
    for (const field of ["email", "displayName", "chatgptAccountId"] as const) {
      if (item[field] === undefined) continue;
      if (typeof item[field] !== "string" || !item[field].trim()) {
        throw new Error("The saved ChatGPT registration index is invalid.");
      }
      optional[field] = item[field].trim();
    }
    if (
      accountRegistrationId(email, item.clientId, item.subject) !== item.id ||
      registrations.has(item.id)
    ) {
      throw new Error("The saved ChatGPT registration identity is invalid.");
    }
    registrations.set(item.id, {
      id: item.id,
      clientId: item.clientId,
      subject: item.subject,
      extAgentHostId: item.extAgentHostId,
      ...optional,
    });
  }
  return registrations;
}

async function readRegistrationIndex(
  email: string,
): Promise<Map<string, ChatGPTSubscriptionRegistration>> {
  const normalized = normalizedEmail(email);
  return parseRegistrationIndex(
    normalized,
    await getUserSetting(
      normalized,
      CHATGPT_SUBSCRIPTION_REGISTRATIONS_SETTING_KEY,
    ),
  );
}

async function saveRegistration(
  email: string,
  registration: ChatGPTSubscriptionRegistration,
): Promise<void> {
  const normalized = normalizedEmail(email);
  if (
    accountRegistrationId(
      normalized,
      registration.clientId,
      registration.subject,
    ) !== registration.id
  ) {
    throw new Error("The ChatGPT registration identity is invalid.");
  }
  await mutateUserSetting(
    normalized,
    CHATGPT_SUBSCRIPTION_REGISTRATIONS_SETTING_KEY,
    (current) => {
      const registrations = parseRegistrationIndex(normalized, current);
      const existing = registrations.get(registration.id);
      if (
        existing &&
        (existing.clientId !== registration.clientId ||
          existing.subject !== registration.subject ||
          existing.extAgentHostId !== registration.extAgentHostId)
      ) {
        throw new Error(
          "The ChatGPT registration identity cannot be replaced.",
        );
      }
      registrations.set(registration.id, registration);
      return {
        version: 1,
        encrypted: encryptSecretValue(
          JSON.stringify([...registrations.values()]),
        ),
      };
    },
  );
}

async function writeActiveAccountId(
  email: string,
  accountId: string,
): Promise<void> {
  if (!CHATGPT_ACCOUNT_ID_RE.test(accountId)) {
    throw new Error("A valid ChatGPT registration is required.");
  }
  await putUserSetting(
    normalizedEmail(email),
    CHATGPT_SUBSCRIPTION_ACTIVE_ACCOUNT_SETTING_KEY,
    { accountId },
  );
}

async function accountSummaries(
  email: string,
): Promise<ChatGPTSubscriptionAccountSummary[]> {
  const normalized = normalizedEmail(email);
  const rows = await listOAuthAccountsByOwner(
    CHATGPT_SUBSCRIPTION_OAUTH_PROVIDER,
    credentialOwner(normalized),
  );
  const registrationIndex = await readRegistrationIndex(normalized);
  const accountIds = new Set(registrationIndex.keys());
  for (const row of rows) {
    const id = identityFromStoredAccountId(row.accountId);
    if (id) accountIds.add(id);
  }
  const sortedAccountIds = [...accountIds].sort((left, right) =>
    left.localeCompare(right),
  );

  const summaries: Array<ChatGPTSubscriptionAccountSummary | null> =
    await Promise.all(
      sortedAccountIds.map(async (id) => {
        const state =
          await readOAuthCredentialState<ChatGPTSubscriptionCredential>(
            credentialIdentity(normalized, id),
            { validateCredential: isChatGPTCredential },
          );
        const credential =
          isConnectedState(state) || state.kind === "reconnect_required"
            ? state.credential
            : undefined;
        const registration = registrationIndex.get(id);
        if (state.kind === "missing" && !registration) return null;
        if (
          credential &&
          accountRegistrationId(
            normalized,
            credential.clientId,
            credential.subject,
          ) !== id
        ) {
          throw new Error(
            "The saved ChatGPT registration identity is invalid.",
          );
        }
        if (
          registration &&
          credential &&
          (registration.clientId !== credential.clientId ||
            registration.subject !== credential.subject ||
            registration.extAgentHostId !== credential.extAgentHostId)
        ) {
          throw new Error(
            "The saved ChatGPT registration identity is invalid.",
          );
        }
        const emailValue = credential?.email ?? registration?.email ?? null;
        const suffix = id.slice(-6);
        const labelBase =
          credential?.displayName ??
          registration?.displayName ??
          emailValue ??
          `ChatGPT account ${suffix}`;
        const connected =
          isConnectedState(state) &&
          typeof state.credential.tokens.refresh_token === "string";
        const planUsageEnabled = Boolean(
          connected &&
          credential?.grantedScopes.includes("chatgpt.tokens.use.direct"),
        );
        return {
          id,
          email: emailValue,
          label: labelBase,
          connected,
          reconnectRequired:
            state.kind === "reconnect_required" || state.kind === "malformed",
          planUsageEnabled,
          active: false,
        } satisfies ChatGPTSubscriptionAccountSummary;
      }),
    );
  const accountRows = summaries.filter((summary) => summary !== null);
  const byLabel = new Map<string, number>();
  for (const account of accountRows) {
    byLabel.set(account.label, (byLabel.get(account.label) ?? 0) + 1);
  }
  return accountRows.map((account) =>
    (byLabel.get(account.label) ?? 0) > 1
      ? { ...account, label: `${account.label} (${account.id.slice(-6)})` }
      : account,
  );
}

async function activeAccount(
  email: string,
  accounts?: ChatGPTSubscriptionAccountSummary[],
): Promise<ChatGPTSubscriptionAccountSummary | null> {
  const accountRows = accounts ?? (await accountSummaries(email));
  const activeId = await readActiveAccountId(email);
  if (!activeId) {
    if (accountRows.length === 1) {
      await writeActiveAccountId(email, accountRows[0]!.id);
      return { ...accountRows[0]!, active: true };
    }
    return null;
  }
  const active = accountRows.find((account) => account.id === activeId);
  if (!active) {
    await deleteUserSetting(
      normalizedEmail(email),
      CHATGPT_SUBSCRIPTION_ACTIVE_ACCOUNT_SETTING_KEY,
    );
    if (accountRows.length === 1) {
      await writeActiveAccountId(email, accountRows[0]!.id);
      return { ...accountRows[0]!, active: true };
    }
    return null;
  }
  return { ...active, active: true };
}

export async function hasChatGPTSubscriptionCredential(
  email: string,
): Promise<boolean> {
  if (!currentRequestIsLocalLoopback()) return false;
  const selected = await activeAccount(email);
  if (!selected) return false;
  return selected.connected && selected.planUsageEnabled;
}

export async function getChatGPTSubscriptionStatus(
  email: string,
): Promise<ChatGPTSubscriptionStatus> {
  const localLoopback = currentRequestIsLocalLoopback();
  const [accounts, legacyRegistrationCleanupAvailable] = await Promise.all([
    accountSummaries(email),
    hasLegacyCredential(email),
  ]);
  const selected = await activeAccount(email, accounts);
  const activeAccountId = selected?.id ?? null;
  const activeState = selected
    ? await readOAuthCredentialState<ChatGPTSubscriptionCredential>(
        credentialIdentity(email, selected.id),
        { validateCredential: isChatGPTCredential },
      )
    : null;
  const activeCredential =
    activeState && isConnectedState(activeState)
      ? activeState.credential
      : null;
  const visibleAccounts = accounts.map((account) => ({
    ...account,
    active: account.id === activeAccountId,
  }));
  const connected = Boolean(
    localLoopback && selected?.connected && selected.planUsageEnabled,
  );
  return {
    supported: localLoopback,
    localLoopback,
    supportReason: localLoopback ? null : "requires_local_loopback",
    connected,
    reconnectRequired: Boolean(selected?.reconnectRequired),
    accountId: activeCredential?.chatgptAccountId ?? null,
    activeAccountId,
    activeAccount: selected,
    accounts: visibleAccounts,
    legacyRegistrationCleanupAvailable,
  };
}

async function readRegistration(
  email: string,
  accountId: string,
): Promise<ChatGPTSubscriptionRegistration | null> {
  const registration = (await readRegistrationIndex(email)).get(accountId);
  if (registration) return registration;
  return null;
}

function registrationForCredential(
  id: string,
  credential: ChatGPTSubscriptionCredential,
): ChatGPTSubscriptionRegistration {
  return {
    id,
    clientId: credential.clientId,
    subject: credential.subject,
    extAgentHostId: credential.extAgentHostId,
    ...(credential.email ? { email: credential.email } : {}),
    ...(credential.displayName ? { displayName: credential.displayName } : {}),
    ...(credential.chatgptAccountId
      ? { chatgptAccountId: credential.chatgptAccountId }
      : {}),
  };
}

async function savedAccountForOAuth(
  email: string,
  accountId: string,
): Promise<{
  registration?: ChatGPTSubscriptionRegistration;
  credential?: ChatGPTSubscriptionCredential;
}> {
  const [registration, state] = await Promise.all([
    readRegistration(email, accountId),
    readOAuthCredentialState<ChatGPTSubscriptionCredential>(
      credentialIdentity(email, accountId),
      { validateCredential: isChatGPTCredential },
    ),
  ]);
  if (state.kind === "missing") {
    return registration ? { registration } : {};
  }
  if (state.kind === "malformed") {
    if (state.reason === "identity" || !registration) {
      throw new Error(
        "The saved ChatGPT registration is malformed. Reconnect it.",
      );
    }
    return { registration };
  }
  const credential = state.credential;
  if (
    accountRegistrationId(email, credential.clientId, credential.subject) !==
    accountId
  ) {
    throw new Error("The saved ChatGPT registration identity is invalid.");
  }
  const credentialRegistration = registrationForCredential(
    accountId,
    credential,
  );
  if (
    registration &&
    (registration.clientId !== credential.clientId ||
      registration.subject !== credential.subject ||
      registration.extAgentHostId !== credential.extAgentHostId)
  ) {
    throw new Error("The saved ChatGPT registration identity is invalid.");
  }
  return {
    registration: registration ?? credentialRegistration,
    credential,
  };
}

export async function listChatGPTSubscriptionAccounts(email: string): Promise<{
  accounts: ChatGPTSubscriptionAccountSummary[];
  activeAccountId: string | null;
}> {
  const accounts = await accountSummaries(email);
  const selected = await activeAccount(email, accounts);
  const activeAccountId = selected?.id ?? null;
  return {
    accounts: accounts.map((account) => ({
      ...account,
      active: account.id === activeAccountId,
    })),
    activeAccountId,
  };
}

export async function selectChatGPTSubscriptionAccount(
  email: string,
  accountId: string,
): Promise<{ activeAccountId: string; connected: boolean }> {
  if (!CHATGPT_ACCOUNT_ID_RE.test(accountId)) {
    throw new Error("Choose a valid ChatGPT account.");
  }
  const { credential, registration } = await savedAccountForOAuth(
    email,
    accountId,
  );
  if (!credential && !registration) {
    throw new Error("ChatGPT account was not found.");
  }
  await writeActiveAccountId(email, accountId);
  const state = await readOAuthCredentialState<ChatGPTSubscriptionCredential>(
    credentialIdentity(email, accountId),
    { validateCredential: isChatGPTCredential },
  );
  return {
    activeAccountId: accountId,
    connected:
      isConnectedState(state) &&
      state.credential.grantedScopes.includes("chatgpt.tokens.use.direct"),
  };
}

export async function getChatGPTSubscriptionAccess(email: string): Promise<{
  accessToken: string;
  accountId?: string;
}> {
  if (!currentRequestIsLocalLoopback()) {
    throw new Error(
      "Sign in with ChatGPT plan access is available only from a local app at http://127.0.0.1.",
    );
  }
  const selected = await activeAccount(email);
  if (!selected) {
    throw new Error("Select a ChatGPT subscription account before using it.");
  }
  if (!selected.planUsageEnabled) {
    throw new Error(
      selected.reconnectRequired
        ? "Reconnect the selected ChatGPT subscription."
        : "The selected ChatGPT account has not granted direct plan access.",
    );
  }
  const identity = credentialIdentity(email, selected.id);
  const result =
    await resolveOAuthCredentialAccess<ChatGPTSubscriptionCredential>(
      identity,
      {
        refresh: ({ credential }) => refreshCredential(credential),
        validateCredential: isChatGPTCredential,
        shouldMarkReconnectRequiredOnRefreshFailure:
          shouldReconnectAfterChatGPTRefreshFailure,
      },
    );
  if (!result.accessToken) {
    throw new Error(
      result.state.kind === "reconnect_required"
        ? "Reconnect your ChatGPT subscription."
        : "Connect a ChatGPT subscription before using it.",
    );
  }
  const credential = isConnectedState(result.state)
    ? result.state.credential
    : null;
  return {
    accessToken: result.accessToken,
    ...(credential?.chatgptAccountId
      ? { accountId: credential.chatgptAccountId }
      : {}),
  };
}

export async function markChatGPTSubscriptionReconnectRequired(
  email: string,
): Promise<void> {
  const account = await activeAccount(email);
  if (!account) return;
  await markOAuthReconnectRequired(credentialIdentity(email, account.id), {
    validateCredential: isChatGPTCredential,
  });
}

export async function disconnectChatGPTSubscription(
  email: string,
  requestedAccountId?: string,
): Promise<{
  disconnectedAccountId: string | null;
  activeAccountId: string | null;
  connected: boolean;
  remoteRevocationConfirmed: boolean;
}> {
  const before = await accountSummaries(email);
  const currentActive = await readActiveAccountId(email);
  const targetId = requestedAccountId ?? currentActive;
  if (!targetId) {
    return {
      disconnectedAccountId: null,
      activeAccountId: currentActive,
      connected: false,
      remoteRevocationConfirmed: false,
    };
  }
  if (!CHATGPT_ACCOUNT_ID_RE.test(targetId)) {
    throw new Error("Choose a valid ChatGPT account.");
  }
  if (!before.some((account) => account.id === targetId)) {
    throw new Error("ChatGPT account was not found.");
  }
  const currentState =
    await readOAuthCredentialState<ChatGPTSubscriptionCredential>(
      credentialIdentity(email, targetId),
      { validateCredential: isChatGPTCredential },
    );
  const credential =
    isConnectedState(currentState) || currentState.kind === "reconnect_required"
      ? currentState.credential
      : null;
  if (
    credential &&
    accountRegistrationId(email, credential.clientId, credential.subject) !==
      targetId
  ) {
    throw new Error("The saved ChatGPT registration identity is invalid.");
  }
  if (credential) {
    await saveRegistration(
      email,
      registrationForCredential(targetId, credential),
    );
  }
  const revocation = await revokeOAuthCredential<ChatGPTSubscriptionCredential>(
    credentialIdentity(email, targetId),
    {
      validateCredential: isChatGPTCredential,
      revoke: ({ credential: savedCredential }) =>
        revokeChatGPTRefreshToken(savedCredential),
    },
  );
  const after = await accountSummaries(email);
  let nextActiveId = currentActive;
  if (targetId === currentActive) {
    const next = after.find((account) => account.connected) ?? after[0] ?? null;
    if (next) {
      await writeActiveAccountId(email, next.id);
      nextActiveId = next.id;
    } else {
      await deleteUserSetting(
        normalizedEmail(email),
        CHATGPT_SUBSCRIPTION_ACTIVE_ACCOUNT_SETTING_KEY,
      );
      nextActiveId = null;
    }
  }
  const nextActive = after.find((account) => account.id === nextActiveId);
  return {
    disconnectedAccountId: targetId,
    activeAccountId: nextActiveId,
    connected: Boolean(nextActive?.connected && nextActive.planUsageEnabled),
    remoteRevocationConfirmed: revocation.remote === "succeeded",
  };
}

function flowFromCookie(event: H3Event): ChatGPTOAuthFlow | null {
  const encoded = getCookie(event, CHATGPT_OAUTH_FLOW_COOKIE);
  if (!encoded) return null;
  try {
    const value: unknown = JSON.parse(decryptSecretValue(encoded));
    const flow = record(value) as Partial<ChatGPTOAuthFlow> | null;
    if (
      !flow ||
      typeof flow.state !== "string" ||
      !STATE_RE.test(flow.state) ||
      typeof flow.nonce !== "string" ||
      typeof flow.verifier !== "string" ||
      typeof flow.redirectUri !== "string" ||
      typeof flow.owner !== "string" ||
      typeof flow.flowId !== "string" ||
      typeof flow.hostId !== "string" ||
      typeof flow.expiresAt !== "number" ||
      !Number.isFinite(flow.expiresAt) ||
      (flow.mode !== "new" && flow.mode !== "existing")
    ) {
      return null;
    }
    if (
      flow.mode === "existing" &&
      (typeof flow.accountId !== "string" ||
        !CHATGPT_ACCOUNT_ID_RE.test(flow.accountId) ||
        !isIssuedClientId(flow.clientId))
    ) {
      return null;
    }
    if (flow.mode === "new" && (flow.accountId || flow.clientId)) return null;
    return flow as ChatGPTOAuthFlow;
    // An unreadable encrypted flow is invalid and cannot authorize a callback.
  } catch {
    return null;
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

export async function requestTokens(
  body: Record<string, string>,
): Promise<ChatGPTTokenResponse> {
  const response = await fetch(CHATGPT_SUBSCRIPTION_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ChatGPTTokenRequestError(response.status, undefined);
  }
  const tokenPayload = record(payload);
  if (!response.ok || !tokenPayload) {
    throw new ChatGPTTokenRequestError(
      response.status,
      typeof tokenPayload?.error === "string" ? tokenPayload.error : undefined,
    );
  }
  return payload as ChatGPTTokenResponse;
}

export function parseChatGPTSubscriptionRevocationEndpoint(
  configuration: unknown,
): string {
  const metadata = record(configuration);
  if (
    !metadata ||
    metadata.issuer !== CHATGPT_SUBSCRIPTION_ISSUER ||
    typeof metadata.revocation_endpoint !== "string"
  ) {
    throw new Error(
      "ChatGPT OAuth discovery has no valid revocation endpoint.",
    );
  }
  let endpoint: URL;
  try {
    endpoint = new URL(metadata.revocation_endpoint);
  } catch {
    throw new Error(
      "ChatGPT OAuth discovery has an invalid revocation endpoint.",
    );
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.hostname !== "auth.openai.com" ||
    (endpoint.port !== "" && endpoint.port !== "443") ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.pathname === "/" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw new Error(
      "ChatGPT OAuth discovery has an untrusted revocation endpoint.",
    );
  }
  return endpoint.href;
}

async function discoverChatGPTRevocationEndpoint(): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(CHATGPT_SUBSCRIPTION_OIDC_CONFIGURATION_URI, {
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      continue;
    }
    if (response.status >= 500 && attempt < 2) {
      await response.body?.cancel().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("ChatGPT OAuth discovery failed.");
    }
    let configuration: unknown;
    try {
      configuration = await response.json();
    } catch {
      throw new Error("ChatGPT OAuth discovery returned invalid metadata.");
    }
    return parseChatGPTSubscriptionRevocationEndpoint(configuration);
  }
  throw new Error("ChatGPT OAuth discovery failed.");
}

async function revokeChatGPTRefreshToken(
  credential: ChatGPTSubscriptionCredential,
): Promise<"succeeded" | "unsupported"> {
  const refreshToken = credential.tokens.refresh_token;
  if (typeof refreshToken !== "string" || !refreshToken) {
    return "unsupported";
  }
  const endpoint = await discoverChatGPTRevocationEndpoint();
  const body = new URLSearchParams({
    token: refreshToken,
    token_type_hint: "refresh_token",
    client_id: credential.clientId,
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      continue;
    }
    if (response.status === 200) {
      await response.body?.cancel().catch(() => undefined);
      return "succeeded";
    }
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 500 && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      continue;
    }
    throw new Error(`ChatGPT OAuth revocation failed (${response.status}).`);
  }
  throw new Error("ChatGPT OAuth revocation failed.");
}

export function tokenCredential(
  tokens: ChatGPTTokenResponse,
  identity: {
    clientId: string;
    hostId: string;
    subject: string;
    email?: string;
    displayName?: string;
    chatgptAccountId?: string;
    idToken: string;
  },
  previous?: ChatGPTSubscriptionCredential,
): ChatGPTSubscriptionCredential {
  const accessToken = requiredText(tokens.access_token, "access token");
  const refreshToken = requiredText(
    tokens.refresh_token,
    "rotating refresh token",
  );
  if (tokens.token_type !== "Bearer") {
    throw new Error("ChatGPT OAuth returned an invalid token type.");
  }
  const grantedScopes = parseChatGPTSubscriptionScopes(
    tokens.scope === undefined && previous
      ? previous.grantedScopes.join(" ")
      : tokens.scope,
  );
  return {
    tokens: {
      access_token: accessToken,
      refresh_token: refreshToken,
    },
    tokenExpiresAt: tokenExpiry(tokens.expires_in),
    clientId: identity.clientId,
    subject: identity.subject,
    ...(identity.email ? { email: identity.email } : {}),
    ...(identity.displayName ? { displayName: identity.displayName } : {}),
    ...(identity.chatgptAccountId
      ? { chatgptAccountId: identity.chatgptAccountId }
      : {}),
    idToken: identity.idToken,
    extAgentHostId: identity.hostId,
    grantedScopes,
    ...(previous?.oauthLifecycle
      ? { oauthLifecycle: previous.oauthLifecycle }
      : {}),
  };
}

async function exchangeCode(
  code: string,
  verifier: string,
  redirectUri: string,
  clientId: string,
): Promise<ChatGPTTokenResponse> {
  return requestTokens({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
    resource: CHATGPT_SUBSCRIPTION_RESOURCE,
  });
}

async function refreshCredential(
  credential: ChatGPTSubscriptionCredential,
): Promise<ChatGPTSubscriptionCredential> {
  const refreshToken = requiredText(
    credential.tokens.refresh_token,
    "refresh token",
  );
  const refreshed = await requestTokens({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: credential.clientId,
    resource: CHATGPT_SUBSCRIPTION_RESOURCE,
  });
  return tokenCredential(
    refreshed,
    {
      clientId: credential.clientId,
      hostId: credential.extAgentHostId,
      subject: credential.subject,
      ...(credential.email ? { email: credential.email } : {}),
      ...(credential.displayName
        ? { displayName: credential.displayName }
        : {}),
      ...(credential.chatgptAccountId
        ? { chatgptAccountId: credential.chatgptAccountId }
        : {}),
      idToken: credential.idToken,
    },
    credential,
  );
}

export function createChatGPTSubscriptionOAuthStartHandler() {
  return async (event: H3Event) => {
    if (getMethod(event) !== "GET") {
      return failure(event, 405, "Method not allowed.");
    }
    const redirectUri = callbackUriForEvent(event);
    if (!redirectUri) {
      return failure(
        event,
        400,
        "Sign in with ChatGPT is available only from a local app at http://127.0.0.1.",
      );
    }
    let session;
    try {
      session = await getSession(event);
    } catch {
      return failure(event, 500, "Unable to read authentication session.");
    }
    if (!session?.email) return failure(event, 401, "Authentication required.");
    const query = getQuery(event) as Record<string, unknown>;
    let requestedAccountId: string | undefined;
    try {
      requestedAccountId = parseQueryText(query, "accountId");
    } catch (error) {
      return failure(
        event,
        400,
        error instanceof Error ? error.message : "Invalid ChatGPT account.",
      );
    }

    const flowId = crypto.randomUUID();
    const state = crypto.randomBytes(32).toString("base64url");
    const nonce = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
    let hostId: string;
    let mode: ChatGPTOAuthFlow["mode"] = "new";
    let selectedCredential: ChatGPTSubscriptionCredential | null = null;
    let selectedRegistration: ChatGPTSubscriptionRegistration | null = null;
    try {
      hostId = await stableHostId();
      if (requestedAccountId) {
        if (!CHATGPT_ACCOUNT_ID_RE.test(requestedAccountId)) {
          return failure(event, 404, "ChatGPT account was not found.");
        }
        const saved = await savedAccountForOAuth(
          session.email,
          requestedAccountId,
        );
        selectedCredential = saved.credential ?? null;
        selectedRegistration = saved.registration ?? null;
        if (!selectedCredential && !selectedRegistration) {
          return failure(event, 404, "ChatGPT account was not found.");
        }
        if (
          selectedCredential?.extAgentHostId !== undefined &&
          selectedCredential.extAgentHostId !== hostId
        ) {
          throw new Error(
            "The saved ChatGPT registration belongs to another host.",
          );
        }
        if (
          selectedRegistration?.extAgentHostId !== undefined &&
          selectedRegistration.extAgentHostId !== hostId
        ) {
          throw new Error(
            "The saved ChatGPT registration belongs to another host.",
          );
        }
        mode = "existing";
      }
    } catch (error) {
      return failure(
        event,
        500,
        error instanceof Error
          ? error.message
          : "Unable to prepare ChatGPT sign-in.",
      );
    }

    const flow: ChatGPTOAuthFlow = {
      state,
      nonce,
      verifier,
      redirectUri,
      owner: normalizedEmail(session.email),
      flowId,
      hostId,
      expiresAt: Date.now() + CHATGPT_OAUTH_FLOW_TTL_SECONDS * 1_000,
      mode,
      ...(requestedAccountId ? { accountId: requestedAccountId } : {}),
      ...(selectedCredential || selectedRegistration
        ? {
            clientId:
              selectedCredential?.clientId ?? selectedRegistration!.clientId,
          }
        : {}),
    };
    let clientId: string;
    try {
      clientId = selectedCredential
        ? selectedCredential.clientId
        : (selectedRegistration?.clientId ??
          CHATGPT_SUBSCRIPTION_DYNAMIC_CLIENT_ID);
      const authorizationUrl = new URL(
        CHATGPT_SUBSCRIPTION_AUTHORIZATION_ENDPOINT,
      );
      authorizationUrl.search = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: CHATGPT_SUBSCRIPTION_SCOPES.join(" "),
        resource: CHATGPT_SUBSCRIPTION_RESOURCE,
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
        ext_agent_host_id: hostId,
        ...(selectedCredential || selectedRegistration
          ? {
              ...(selectedCredential?.idToken
                ? { id_token_hint: selectedCredential.idToken }
                : {}),
              ...((selectedCredential?.email ?? selectedRegistration?.email)
                ? {
                    login_hint:
                      selectedCredential?.email ?? selectedRegistration!.email!,
                  }
                : {}),
            }
          : { agent_name_hint: appNameHint() }),
      }).toString();
      setCookie(
        event,
        CHATGPT_OAUTH_FLOW_COOKIE,
        encryptSecretValue(JSON.stringify(flow)),
        {
          httpOnly: true,
          secure: false,
          sameSite: "lax",
          path: CHATGPT_SUBSCRIPTION_CALLBACK_PATH,
          maxAge: CHATGPT_OAUTH_FLOW_TTL_SECONDS,
        },
      );
      return redirectWithStagedCookies(event, authorizationUrl.href, 302);
    } catch (error) {
      return failure(
        event,
        500,
        error instanceof Error
          ? error.message
          : "Unable to prepare ChatGPT sign-in.",
      );
    }
  };
}

export function createChatGPTSubscriptionOAuthCallbackHandler() {
  return async (event: H3Event) => {
    if (getMethod(event) !== "GET") {
      return failure(event, 405, "Method not allowed.");
    }
    const callbackUri = callbackUriForEvent(event);
    const requestPath = event.node?.req?.url?.split("?", 1)[0];
    if (!callbackUri || requestPath !== CHATGPT_SUBSCRIPTION_CALLBACK_PATH) {
      return failure(event, 400, "Invalid local ChatGPT OAuth callback.");
    }
    let session;
    try {
      session = await getSession(event);
    } catch {
      return failure(event, 500, "Unable to read authentication session.");
    }
    if (!session?.email) return failure(event, 401, "Authentication required.");
    const flow = flowFromCookie(event);
    if (!flow) {
      return failure(event, 400, "The ChatGPT sign-in expired. Start again.");
    }
    const query = getQuery(event) as Record<string, unknown>;
    let state: string | undefined;
    let providerError: string | undefined;
    let code: string | undefined;
    let callbackClientId: string | undefined;
    try {
      state = parseQueryText(query, "state");
      providerError = parseQueryText(query, "error");
      code = parseQueryText(query, "code");
      callbackClientId = parseQueryText(query, "client_id");
    } catch (error) {
      return failure(
        event,
        400,
        error instanceof Error ? error.message : "Invalid OAuth callback.",
      );
    }
    if (
      !state ||
      !STATE_RE.test(state) ||
      !constantTimeEqual(state, flow.state) ||
      flow.owner !== normalizedEmail(session.email) ||
      flow.redirectUri !== callbackUri ||
      !isChatGPTSubscriptionLoopbackCallbackUri(flow.redirectUri) ||
      !CHATGPT_OAUTH_HOST_ID_RE.test(flow.hostId) ||
      flow.expiresAt < Date.now()
    ) {
      return failure(
        event,
        400,
        "OAuth state rejected. Start the ChatGPT connection again.",
      );
    }

    deleteCookie(event, CHATGPT_OAUTH_FLOW_COOKIE, {
      path: CHATGPT_SUBSCRIPTION_CALLBACK_PATH,
    });
    if (providerError) {
      return failure(event, 400, "ChatGPT authorization was not completed.");
    }
    if (!code) {
      return failure(
        event,
        400,
        "OAuth callback is missing an authorization code.",
      );
    }

    let clientId: string;
    if (flow.mode === "new") {
      if (!isIssuedClientId(callbackClientId)) {
        return failure(
          event,
          400,
          "ChatGPT did not return the issued client ID for this registration.",
        );
      }
      clientId = callbackClientId;
    } else {
      if (!flow.accountId || !isIssuedClientId(flow.clientId)) {
        return failure(
          event,
          400,
          "The saved ChatGPT registration is invalid.",
        );
      }
      if (
        callbackClientId !== undefined &&
        callbackClientId !== flow.clientId
      ) {
        return failure(
          event,
          400,
          "ChatGPT returned a different client ID for the selected account.",
        );
      }
      clientId = flow.clientId;
    }

    try {
      const previous =
        flow.mode === "existing" && flow.accountId
          ? await savedAccountForOAuth(session.email, flow.accountId)
          : null;
      if (
        flow.mode === "existing" &&
        !previous?.credential &&
        !previous?.registration
      ) {
        throw new Error(
          "The selected ChatGPT account was removed during sign-in.",
        );
      }
      if (
        (previous?.credential && previous.credential.clientId !== clientId) ||
        (previous?.registration && previous.registration.clientId !== clientId)
      ) {
        throw new Error(
          "The selected ChatGPT registration changed during sign-in.",
        );
      }
      if (
        previous?.registration &&
        (previous.registration.extAgentHostId !== flow.hostId ||
          previous.registration.id !== flow.accountId)
      ) {
        throw new Error(
          "The saved ChatGPT registration belongs to another host.",
        );
      }
      if (
        previous?.credential &&
        previous.credential.extAgentHostId !== flow.hostId
      ) {
        throw new Error(
          "The saved ChatGPT registration belongs to another host.",
        );
      }

      const tokens = await exchangeCode(
        code,
        flow.verifier,
        flow.redirectUri,
        clientId,
      );
      const idToken = requiredText(tokens.id_token, "ID token");
      const identity = await verifyChatGPTSubscriptionIdToken(
        idToken,
        clientId,
        flow.nonce,
      );
      const accountId = accountRegistrationId(
        session.email,
        clientId,
        identity.subject,
      );
      if (flow.mode === "existing" && accountId !== flow.accountId) {
        throw new Error(
          "ChatGPT signed in as a different account than the selected registration.",
        );
      }
      if (flow.hostId !== (await stableHostId())) {
        throw new Error("The ChatGPT host ID changed during sign-in.");
      }
      const credential = tokenCredential(
        tokens,
        {
          clientId,
          hostId: flow.hostId,
          subject: identity.subject,
          ...((identity.email ??
          previous?.credential?.email ??
          previous?.registration?.email)
            ? {
                email:
                  identity.email ??
                  previous?.credential?.email ??
                  previous?.registration?.email,
              }
            : {}),
          ...((identity.displayName ??
          previous?.credential?.displayName ??
          previous?.registration?.displayName)
            ? {
                displayName:
                  identity.displayName ??
                  previous?.credential?.displayName ??
                  previous?.registration?.displayName,
              }
            : {}),
          ...((identity.chatgptAccountId ??
          previous?.credential?.chatgptAccountId ??
          previous?.registration?.chatgptAccountId)
            ? {
                chatgptAccountId:
                  identity.chatgptAccountId ??
                  previous?.credential?.chatgptAccountId ??
                  previous?.registration?.chatgptAccountId,
              }
            : {}),
          idToken,
        },
        previous?.credential,
      );
      await saveOAuthCredential(
        credentialIdentity(session.email, accountId),
        credential,
      );
      await saveRegistration(
        session.email,
        registrationForCredential(accountId, credential),
      );
      await writeActiveAccountId(session.email, accountId);
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
