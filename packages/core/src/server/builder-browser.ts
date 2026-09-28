import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { H3Event } from "h3";
import {
  getHeader,
  getRequestIP,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { ActionContractError } from "../action.js";
import { getSetting } from "../settings/store.js";
import { applyBuilderUtmTrackingParams } from "../shared/builder-link-tracking.js";
import {
  getAuthSecret,
  resolveSignupTrackingIdentity,
} from "./better-auth-instance.js";
import {
  resolveBuilderRequestAuthorization,
  type BuilderRequestAuthorization,
} from "./builder-api-auth.js";
import type { BuilderOAuthPermissionScope } from "./builder-oauth.js";
import { readDeployCredentialEnv } from "./credential-provider.js";
import { getWorkspaceA2ADerivedSecret } from "./derived-secret.js";
import { publicFrameworkPath } from "./framework-route-prefix.js";
import {
  getAppBasePath,
  getOrigin,
  getOAuthStateSigningKey,
  isAllowedOAuthRedirectUri,
  isConfiguredAppOrigin,
} from "./google-oauth.js";
import { isLoopbackOrigin } from "./origin-allowlist.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

const DEFAULT_BUILDER_APP_HOST = "https://builder.io";
const DEFAULT_BUILDER_API_HOST = "https://api.builder.io";
const DEFAULT_BUILDER_TEMPLATE_ID = "agent-native-starter";
const BUILDER_API_REQUEST_TIMEOUT_MS = 30_000;
const BUILDER_BROWSER_HOST = "agent-native-browser";
const BUILDER_BROWSER_CLIENT_ID = "Agent-Native Browser";
const DISPATCH_APP_CREATION_SETTINGS_KEY = "dispatch-app-creation-settings";

export const BUILDER_CALLBACK_PATH = "/_agent-native/builder/callback";
export const BUILDER_RELAY_PATH = "/_agent-native/builder/relay";
export const BUILDER_RELAY_STATE_PARAM = "_an_relay";
export const BUILDER_RELAY_SECRET_ENV = "AGENT_NATIVE_BUILDER_RELAY_SECRET";
export const BUILDER_RELAY_TARGET_ORIGINS_ENV =
  "AGENT_NATIVE_BUILDER_RELAY_TARGET_ORIGINS";
export const BUILDER_RELAY_TARGET_DOMAIN_SUFFIXES_ENV =
  "AGENT_NATIVE_BUILDER_RELAY_TARGET_DOMAIN_SUFFIXES";
export const BUILDER_RELAY_TIMESTAMP_HEADER = "x-agent-native-relay-timestamp";
export const BUILDER_RELAY_FLOW_HEADER = "x-agent-native-relay-flow";
export const BUILDER_RELAY_SIGNATURE_HEADER = "x-agent-native-relay-signature";
export const BUILDER_ACCOUNT_PROVISIONING_SECRET_ENV =
  "AGENT_NATIVE_BUILDER_SSO_SECRET";

const BUILDER_RELAY_PURPOSE = "builder-preview-callback-relay";
const BUILDER_RELAY_STATE_VERSION = 1;
const BUILDER_RELAY_TTL_MS = 10 * 60 * 1000;
const BUILDER_RELAY_REQUEST_SKEW_MS = 2 * 60 * 1000;
const IMMUTABLE_NETLIFY_RELAY_HOST =
  /^(?<deploy>[a-f0-9]{24})--(?<site>[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.netlify\.app$/;
const NETLIFY_DEPLOY_PREVIEW_HOST =
  /^deploy-preview-\d+--(?<site>[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.netlify\.app$/;

export interface BuilderPreviewRelayState {
  v: 1;
  purpose: typeof BUILDER_RELAY_PURPOSE;
  flowId: string;
  ownerEmail: string;
  targetOrigin: string;
  basePath: string;
  iat: number;
  exp: number;
}

export interface BuilderRelayCredentials {
  privateKey: string;
  publicKey: string;
  userId: string | null;
  orgName: string | null;
  orgKind: string | null;
  subscription: string | null;
  subscriptionLevel: string | null;
  subscriptionName: string | null;
  isEnterprise: boolean | null;
  isFreeAccount: boolean | null;
}

export interface BuilderRelayRequestBody {
  relayState: string;
  credentials: BuilderRelayCredentials;
}

export class BuilderAccountProvisioningError extends Error {
  readonly code: string | null;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "BuilderAccountProvisioningError";
    this.code = code ?? null;
  }
}

export function isBuilderAccountAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return (
    candidate.name === "BuilderAccountProvisioningError" &&
    (candidate.code === "account_incomplete" ||
      candidate.code === "account_exists")
  );
}

function builderRelaySecret(): string {
  const secret = process.env[BUILDER_RELAY_SECRET_ENV]?.trim();
  if (!secret) {
    throw new Error(
      `${BUILDER_RELAY_SECRET_ENV} is required for Builder preview authorization relay.`,
    );
  }
  if (secret.length < 32) {
    throw new Error(
      `${BUILDER_RELAY_SECRET_ENV} must be at least 32 characters long.`,
    );
  }
  return secret;
}

function builderRelayMac(value: string): string {
  return createHmac("sha256", builderRelaySecret())
    .update(value)
    .digest("base64url");
}

function safeEqualText(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

/**
 * Opaque OAuth `state` for Builder connect. Bound to a server-only signing
 * secret so a pending row cannot be forged from another deployment that shares
 * a database.
 */
function builderConnectStateSigningKeys(): string[] {
  const currentSecret = getOAuthStateSigningKey();
  const keys = [`builder-connect-state:${currentSecret}`];
  const legacySecret =
    readDeployCredentialEnv("BETTER_AUTH_SECRET")?.trim() ||
    getWorkspaceA2ADerivedSecret("better-auth");
  if (legacySecret && legacySecret !== currentSecret) {
    keys.push(`builder-connect-state:${legacySecret}`);
  }
  return keys;
}

export function createBuilderConnectState(): string {
  const stateNonce = randomBytes(32).toString("base64url");
  const signature = createHmac("sha256", builderConnectStateSigningKeys()[0]!)
    .update(stateNonce)
    .digest("base64url");
  return `${stateNonce}.${signature}`;
}

export function isSignedBuilderConnectState(
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  const [nonce, signature, ...rest] = value.split(".");
  if (
    !nonce ||
    !signature ||
    rest.length ||
    !/^[A-Za-z0-9_-]{43}$/.test(nonce) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  ) {
    return false;
  }
  return builderConnectStateSigningKeys().some((key) => {
    const expected = createHmac("sha256", key)
      .update(nonce)
      .digest("base64url");
    return safeEqualText(expected, signature);
  });
}

export function isBuilderConnectCallbackUrlAllowed(
  candidate: string,
  event: H3Event,
): boolean {
  const callbackOrigin = getBuilderConnectCallbackOrigin(event);
  if (
    !callbackOrigin ||
    !isAllowedOAuthRedirectUri(candidate, event, callbackOrigin)
  )
    return false;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    // coercion-ok: malformed callback strings are not allowed redirects.
    return false;
  }
  if (url.username || url.password) return false;
  const hostname = url.hostname.toLowerCase();
  const loopback =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]";
  if (loopback) {
    return url.protocol === "http:" && process.env.NODE_ENV !== "production";
  }
  return url.protocol === "https:";
}

export function resolveBuilderConnectCallbackUrl(
  event: H3Event,
  state?: string,
): string | null {
  const stateSuffix = state ? `?state=${encodeURIComponent(state)}` : "";
  const callbackOrigin = getBuilderConnectCallbackOrigin(event);
  if (!callbackOrigin) return null;
  const withBase = `${callbackOrigin}${getAppBasePath()}${BUILDER_CALLBACK_PATH}${stateSuffix}`;
  if (isBuilderConnectCallbackUrlAllowed(withBase, event)) return withBase;
  const root = `${callbackOrigin}${BUILDER_CALLBACK_PATH}${stateSuffix}`;
  if (root !== withBase && isBuilderConnectCallbackUrlAllowed(root, event)) {
    return root;
  }
  return null;
}

function normalizeBuilderRelayBasePath(value: string): string | null {
  if (!value) return "";
  if (!value.startsWith("/") || value.includes("?") || value.includes("#")) {
    return null;
  }
  const normalized = value.replace(/\/+$/, "");
  if (normalized.split("/").some((part) => part === "." || part === "..")) {
    return null;
  }
  return normalized;
}

export function isSafeBuilderRelayTargetOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.origin !== value ||
      url.username ||
      url.password ||
      url.hostname.includes("*")
    )
      return false;
    const hostname = url.hostname.toLowerCase();
    const loopback =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]";
    if (loopback)
      return url.protocol === "http:" && process.env.NODE_ENV !== "production";
    if (url.protocol !== "https:") return false;
    return (
      hostname.endsWith(".netlify.app") ||
      hostname.endsWith(".vercel.app") ||
      hostname === "agent-native.com" ||
      hostname.endsWith(".agent-native.com") ||
      hostname.endsWith(".builder.io") ||
      hostname.endsWith(".builderio.xyz") ||
      hostname.endsWith(".builderio.dev") ||
      hostname.endsWith(".builder.codes")
    );
  } catch {
    return false;
  }
}

export function isTrustedBuilderRelayTargetOrigin(value: string): boolean {
  if (!isSafeBuilderRelayTargetOrigin(value)) return false;
  const hostname = new URL(value).hostname.toLowerCase();
  if (
    hostname.endsWith(".netlify.app") &&
    !/^[a-f0-9]{24}--[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.netlify\.app$/.test(
      hostname,
    )
  ) {
    return false;
  }
  const exactOriginMatch = (process.env[BUILDER_RELAY_TARGET_ORIGINS_ENV] ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .some((origin) => origin === value && !origin.includes("*"));
  return (
    exactOriginMatch ||
    builderRelayTargetDomainSuffixes().some((suffix) =>
      hostname.endsWith(suffix),
    )
  );
}

export function resolveBuilderPreviewRelayTargetOrigin(
  previewOrigin: string,
): string {
  let previewUrl: URL;
  try {
    previewUrl = new URL(previewOrigin);
  } catch {
    return previewOrigin;
  }
  const previewMatch = NETLIFY_DEPLOY_PREVIEW_HOST.exec(
    previewUrl.hostname.toLowerCase(),
  );
  if (!previewMatch?.groups?.site) return previewOrigin;

  const buildId = process.env.AGENT_NATIVE_BUILD_ID?.trim().toLowerCase();
  const siteName = process.env.SITE_NAME?.trim().toLowerCase();
  if (
    !buildId ||
    !siteName ||
    !/^[a-f0-9]{24}$/.test(buildId) ||
    siteName !== previewMatch.groups.site
  ) {
    return previewOrigin;
  }

  const immutableOrigin = `https://${buildId}--${siteName}.netlify.app`;
  return IMMUTABLE_NETLIFY_RELAY_HOST.test(new URL(immutableOrigin).hostname)
    ? immutableOrigin
    : previewOrigin;
}
export function signBuilderPreviewRelayState(input: {
  ownerEmail: string;
  targetOrigin: string;
  basePath?: string;
  flowId?: string;
  now?: number;
}): { state: string; payload: BuilderPreviewRelayState } {
  if (!isSafeBuilderRelayTargetOrigin(input.targetOrigin)) {
    throw new Error(
      "Builder relay target origin is not an approved preview origin.",
    );
  }
  const basePath = normalizeBuilderRelayBasePath(input.basePath ?? "");
  if (basePath === null) throw new Error("Builder relay base path is invalid.");
  const now = input.now ?? Date.now();
  const payload: BuilderPreviewRelayState = {
    v: BUILDER_RELAY_STATE_VERSION,
    purpose: BUILDER_RELAY_PURPOSE,
    flowId: input.flowId ?? randomBytes(24).toString("base64url"),
    ownerEmail: input.ownerEmail,
    targetOrigin: input.targetOrigin,
    basePath,
    iat: now,
    exp: now + BUILDER_RELAY_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return { state: `${encoded}.${builderRelayMac(encoded)}`, payload };
}

function builderRelayTargetDomainSuffixes(): string[] {
  return (process.env[BUILDER_RELAY_TARGET_DOMAIN_SUFFIXES_ENV] ?? "")
    .split(",")
    .map((suffix) => suffix.trim().toLowerCase())
    .filter((suffix) => {
      if (!suffix.startsWith(".") || suffix.includes("*")) return false;
      const hostname = suffix.slice(1);
      if (!hostname.includes(".") || hostname.length > 253) return false;
      if (
        !hostname
          .split(".")
          .every((label) =>
            /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
          )
      ) {
        return false;
      }
      try {
        return new URL(`https://${hostname}`).hostname === hostname;
      } catch {
        return false;
      }
    });
}

export function verifyBuilderPreviewRelayState(
  state: string | null | undefined,
  options: { now?: number } = {},
): BuilderPreviewRelayState | null {
  if (!state) return null;
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!safeEqualText(builderRelayMac(parts[0]), parts[1])) return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<BuilderPreviewRelayState>;
  const now = options.now ?? Date.now();
  if (
    payload.v !== BUILDER_RELAY_STATE_VERSION ||
    payload.purpose !== BUILDER_RELAY_PURPOSE ||
    typeof payload.flowId !== "string" ||
    !/^[A-Za-z0-9_-]{24,128}$/.test(payload.flowId) ||
    typeof payload.ownerEmail !== "string" ||
    !payload.ownerEmail.includes("@") ||
    typeof payload.targetOrigin !== "string" ||
    !isSafeBuilderRelayTargetOrigin(payload.targetOrigin) ||
    typeof payload.basePath !== "string" ||
    normalizeBuilderRelayBasePath(payload.basePath) !== payload.basePath ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    payload.exp <= payload.iat ||
    payload.exp - payload.iat > BUILDER_RELAY_TTL_MS ||
    payload.iat > now + BUILDER_RELAY_REQUEST_SKEW_MS ||
    payload.exp < now
  ) {
    return null;
  }
  return payload as BuilderPreviewRelayState;
}

export function verifyBuilderPreviewRelayStateForCallback(
  state: string | null | undefined,
  options: { now?: number } = {},
): BuilderPreviewRelayState | null {
  const payload = verifyBuilderPreviewRelayState(state, options);
  return payload && isTrustedBuilderRelayTargetOrigin(payload.targetOrigin)
    ? payload
    : null;
}

export function getBuilderPreviewRelayUrl(
  payload: BuilderPreviewRelayState,
): string {
  return `${payload.targetOrigin}${payload.basePath}${BUILDER_RELAY_PATH}`;
}

function builderRelayBodyDigest(body: string): string {
  return createHash("sha256").update(body).digest("base64url");
}

function builderRelayRequestSignature(
  timestamp: number,
  flowId: string,
  body: string,
): string {
  return builderRelayMac(
    `v1.${timestamp}.${flowId}.${builderRelayBodyDigest(body)}`,
  );
}

export function createBuilderRelayRequest(
  relayState: string,
  credentials: BuilderRelayCredentials,
  options: { now?: number } = {},
): { body: string; headers: Record<string, string>; url: string } {
  const payload = verifyBuilderPreviewRelayState(relayState, options);
  if (!payload) throw new Error("Builder relay state is invalid or expired.");
  const body = JSON.stringify({
    relayState,
    credentials,
  } satisfies BuilderRelayRequestBody);
  const timestamp = options.now ?? Date.now();
  return {
    body,
    url: getBuilderPreviewRelayUrl(payload),
    headers: {
      "content-type": "application/json",
      [BUILDER_RELAY_TIMESTAMP_HEADER]: String(timestamp),
      [BUILDER_RELAY_FLOW_HEADER]: payload.flowId,
      [BUILDER_RELAY_SIGNATURE_HEADER]: builderRelayRequestSignature(
        timestamp,
        payload.flowId,
        body,
      ),
    },
  };
}

export function verifyBuilderRelayRequest(input: {
  body: string;
  timestamp: string | null | undefined;
  flowId: string | null | undefined;
  signature: string | null | undefined;
  requestOrigin: string;
  requestBasePath: string;
  now?: number;
}): {
  payload: BuilderPreviewRelayState;
  body: BuilderRelayRequestBody;
} | null {
  const timestamp = Number(input.timestamp);
  const now = input.now ?? Date.now();
  if (
    !Number.isFinite(timestamp) ||
    Math.abs(now - timestamp) > BUILDER_RELAY_REQUEST_SKEW_MS ||
    !input.flowId ||
    !input.signature ||
    !safeEqualText(
      builderRelayRequestSignature(timestamp, input.flowId, input.body),
      input.signature,
    )
  ) {
    return null;
  }
  let body: BuilderRelayRequestBody;
  try {
    body = JSON.parse(input.body) as BuilderRelayRequestBody;
  } catch {
    return null;
  }
  const payload = verifyBuilderPreviewRelayState(body.relayState, { now });
  if (
    !payload ||
    payload.flowId !== input.flowId ||
    payload.targetOrigin !== input.requestOrigin ||
    payload.basePath !== input.requestBasePath ||
    !body.credentials ||
    typeof body.credentials.privateKey !== "string" ||
    typeof body.credentials.publicKey !== "string" ||
    !body.credentials.privateKey ||
    !body.credentials.publicKey
  ) {
    return null;
  }
  const nullableString = (value: unknown): string | null =>
    typeof value === "string" ? value : null;
  const nullableBoolean = (value: unknown): boolean | null =>
    typeof value === "boolean" ? value : null;
  return {
    payload,
    body: {
      relayState: body.relayState,
      // Explicitly rebuild the credential payload. Extra fields such as an
      // attacker-supplied ownerEmail/orgId never reach the credential writer.
      credentials: {
        privateKey: body.credentials.privateKey,
        publicKey: body.credentials.publicKey,
        userId: nullableString(body.credentials.userId),
        orgName: nullableString(body.credentials.orgName),
        orgKind: nullableString(body.credentials.orgKind),
        subscription: nullableString(body.credentials.subscription),
        subscriptionLevel: nullableString(body.credentials.subscriptionLevel),
        subscriptionName: nullableString(body.credentials.subscriptionName),
        isEnterprise: nullableBoolean(body.credentials.isEnterprise),
        isFreeAccount: nullableBoolean(body.credentials.isFreeAccount),
      },
    },
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export const BUILDER_STATE_PARAM = "_an_state";
export const BUILDER_CONNECT_PARAM = "_an_connect";
export const BUILDER_CONNECT_STATE_COOKIE = "an_builder_connect_state";
export const BUILDER_CONNECT_OWNER_COOKIE = "an_builder_connect_owner";
export const BUILDER_SIGNUP_SOURCE_PARAM = "signupSource";
export const BUILDER_AGENT_NATIVE_FLOW_PARAM = "agentNativeFlow";
export const BUILDER_AGENT_NATIVE_CONNECT_SOURCE_PARAM =
  "agentNativeConnectSource";
export const BUILDER_AGENT_NATIVE_APP_PARAM = "agentNativeApp";
export const BUILDER_AGENT_NATIVE_TEMPLATE_PARAM = "agentNativeTemplate";
export const BUILDER_CONNECT_MODE_PARAM = "_an_mode";
export const BUILDER_AGENT_NATIVE_PROVISION_MODE = "agent-native";
export const BUILDER_PROVISIONING_TOKEN_PARAM = "_an_provision";
export const BUILDER_CONNECT_ATTEMPT_PARAM = "_an_connect_attempt";

const BUILDER_CONNECT_STATE_COOKIE_MAX_ENTRIES = 4;

export function parseBuilderConnectStateCookie(
  value: string | null | undefined,
): string[] | null {
  if (!value) return [];
  const states = value.split(",");
  if (
    states.length > BUILDER_CONNECT_STATE_COOKIE_MAX_ENTRIES ||
    states.some((state) => !isSignedBuilderConnectState(state))
  ) {
    return null;
  }
  return [...new Set(states)];
}

export function appendBuilderConnectStateCookie(
  value: string | null | undefined,
  state: string,
): string {
  const states = parseBuilderConnectStateCookie(value) ?? [];
  return [...states.filter((candidate) => candidate !== state), state]
    .slice(-BUILDER_CONNECT_STATE_COOKIE_MAX_ENTRIES)
    .join(",");
}

export function removeBuilderConnectStateCookie(
  value: string | null | undefined,
  state: string,
): string {
  return (parseBuilderConnectStateCookie(value) ?? [])
    .filter((candidate) => candidate !== state)
    .join(",");
}

export interface BuilderConnectCallbackStateResolution {
  state: string | null;
  /**
   * Set when the cookie itself is why this attempt cannot resolve a state.
   * Nothing else prunes it on failure, so an unusable cookie would make every
   * later retry unresolvable too — and the restart the error message asks for
   * is what appends the next state and keeps the trap armed.
   */
  resetStateCookie: boolean;
}

export function resolveBuilderConnectCallbackState(
  queryState: string | null,
  cookieState: string | null | undefined,
): BuilderConnectCallbackStateResolution {
  const cookieStates = parseBuilderConnectStateCookie(cookieState);
  if (cookieState && !cookieStates) {
    return { state: null, resetStateCookie: true };
  }
  if (queryState !== null) {
    if (cookieStates?.length && !cookieStates.includes(queryState)) {
      return { state: null, resetStateCookie: false };
    }
    return { state: queryState, resetStateCookie: false };
  }
  if (cookieStates?.length === 1) {
    return { state: cookieStates[0], resetStateCookie: false };
  }
  return { state: null, resetStateCookie: (cookieStates?.length ?? 0) > 1 };
}

const BUILDER_STATE_TTL_MS = 10 * 60 * 1000;
const BUILDER_SIGNUP_SOURCE = "agent-native";

export interface BuilderConnectTrackingParams {
  signupSource?: string;
  agentNativeFlow?: string;
  agentNativeConnectSource?: string;
  agentNativeApp?: string;
  agentNativeTemplate?: string;
}

function cleanTrackingParam(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

export function getBuilderConnectTrackingParams(
  params: URLSearchParams,
): BuilderConnectTrackingParams {
  return {
    signupSource:
      cleanTrackingParam(params.get(BUILDER_SIGNUP_SOURCE_PARAM)) ??
      BUILDER_SIGNUP_SOURCE,
    agentNativeFlow: cleanTrackingParam(
      params.get(BUILDER_AGENT_NATIVE_FLOW_PARAM),
    ),
    agentNativeConnectSource: cleanTrackingParam(
      params.get(BUILDER_AGENT_NATIVE_CONNECT_SOURCE_PARAM),
    ),
    agentNativeApp: cleanTrackingParam(
      params.get(BUILDER_AGENT_NATIVE_APP_PARAM),
    ),
    agentNativeTemplate: cleanTrackingParam(
      params.get(BUILDER_AGENT_NATIVE_TEMPLATE_PARAM),
    ),
  };
}

export function builderConnectTrackingProperties(
  tracking: BuilderConnectTrackingParams,
): Record<string, string> {
  const properties: Record<string, string> = {};
  if (tracking.signupSource) properties.signup_source = tracking.signupSource;
  if (tracking.agentNativeFlow) {
    properties.agent_native_flow = tracking.agentNativeFlow;
  }
  if (tracking.agentNativeConnectSource) {
    properties.agent_native_connect_source = tracking.agentNativeConnectSource;
  }
  if (tracking.agentNativeApp) {
    properties.agent_native_app = tracking.agentNativeApp;
  }
  if (tracking.agentNativeTemplate) {
    properties.agent_native_template = tracking.agentNativeTemplate;
  }
  return properties;
}

function applyBuilderConnectTrackingParams(
  params: URLSearchParams,
  tracking: BuilderConnectTrackingParams,
) {
  params.set(
    BUILDER_SIGNUP_SOURCE_PARAM,
    cleanTrackingParam(tracking.signupSource) ?? BUILDER_SIGNUP_SOURCE,
  );
  const flow = cleanTrackingParam(tracking.agentNativeFlow);
  if (flow) params.set(BUILDER_AGENT_NATIVE_FLOW_PARAM, flow);
  const source = cleanTrackingParam(tracking.agentNativeConnectSource);
  if (source) params.set(BUILDER_AGENT_NATIVE_CONNECT_SOURCE_PARAM, source);
  const app = cleanTrackingParam(tracking.agentNativeApp);
  if (app) params.set(BUILDER_AGENT_NATIVE_APP_PARAM, app);
  const template = cleanTrackingParam(tracking.agentNativeTemplate);
  if (template) params.set(BUILDER_AGENT_NATIVE_TEMPLATE_PARAM, template);
}

export function withBuilderConnectTrackingParams(
  url: string,
  tracking: BuilderConnectTrackingParams,
): string {
  const parsed = new URL(url);
  applyBuilderConnectTrackingParams(parsed.searchParams, tracking);
  return parsed.toString();
}

export interface BuilderBrowserStatus {
  configured: boolean;
  builderEnabled: boolean;
  branchProjectIdConfigured: boolean;
  agentNativeProvisioningEnabled: boolean;
  agentNativeProvisioningToken?: string;
  branchProjectId?: string;
  envManaged: boolean;
  credentialSource?: "user" | "org" | "workspace" | "env";
  canDisconnect?: boolean;
  authError?: { message: string; at: number };
  connectError?: { message: string; at: number; code?: string };
  appHost: string;
  apiHost: string;
  cliAuthUrl?: string;
  connectUrl: string;
  publicKeyConfigured: boolean;
  privateKeyConfigured: boolean;
  userId?: string;
  orgName?: string;
  /**
   * The Builder space(s) the effective credential can reach, with their real
   * display names (derived from the Admin GraphQL API). A `bpk-` key is
   * space-scoped, so today this is one entry; the list shape lets the Sources
   * drill-down grow to multiple spaces without a restructure. Absent/empty when
   * the name can't be derived — UIs fall back to `orgName`.
   */
  spaces?: Array<{ id: string; name: string }>;
  orgKind?: string;
  subscription?: string;
  subscriptionLevel?: string;
  subscriptionName?: string;
  isEnterprise?: boolean;
  isFreeAccount?: boolean;
}

export interface BrowserConnectionArgs {
  sessionId?: string;
  projectId?: string;
  branchName?: string;
  proxyOrigin?: string;
  proxyDefaultOrigin?: string;
  proxyDestination?: string;
}

type BuilderSignedTokenPurpose = "callback" | "connect" | "provision";

function signingKeyForPurpose(purpose: BuilderSignedTokenPurpose): string {
  if (purpose === "callback") return `builder-csrf:${getAuthSecret()}`;
  if (purpose === "connect") return `builder-connect:${getAuthSecret()}`;
  return `builder-provision:${getAuthSecret()}`;
}

function macForParts(
  purpose: BuilderSignedTokenPurpose,
  nonce: string,
  emailEncoded: string,
  ts: number,
): string {
  return createHmac("sha256", signingKeyForPurpose(purpose))
    .update(`${nonce}.${emailEncoded}.${ts}`)
    .digest("base64url");
}

function signEmailBoundBuilderToken(
  ownerEmail: string,
  purpose: BuilderSignedTokenPurpose,
): string {
  const nonce = randomBytes(16).toString("base64url");
  const ts = Date.now();
  const emailEncoded = Buffer.from(ownerEmail, "utf8").toString("base64url");
  const mac = macForParts(purpose, nonce, emailEncoded, ts);
  return `${nonce}.${emailEncoded}.${ts}.${mac}`;
}

function verifyEmailBoundBuilderToken(
  token: string | null | undefined,
  ownerEmail: string,
  purpose: BuilderSignedTokenPurpose,
): boolean {
  if (typeof token !== "string" || token.length === 0) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [nonce, emailEncoded, tsStr, mac] = parts;
  if (!nonce || !emailEncoded || !tsStr || !mac) return false;

  let boundEmail: string;
  try {
    boundEmail = Buffer.from(emailEncoded, "base64url").toString("utf8");
  } catch {
    return false;
  }
  if (boundEmail !== ownerEmail) return false;

  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() - ts) > BUILDER_STATE_TTL_MS) return false;

  const expected = Buffer.from(macForParts(purpose, nonce, emailEncoded, ts));
  const candidate = Buffer.from(mac);
  if (expected.length !== candidate.length) return false;
  return timingSafeEqual(expected, candidate);
}

const BUILDER_PROVISIONING_TOKEN_TTL_MS = 10 * 60 * 1000;

function provisioningSessionDigest(sessionToken: string): string {
  return createHash("sha256").update(sessionToken).digest("base64url");
}

function provisioningMac(
  nonce: string,
  emailEncoded: string,
  sessionDigest: string,
  timestamp: number,
): string {
  return createHmac("sha256", signingKeyForPurpose("provision"))
    .update(`${nonce}.${emailEncoded}.${sessionDigest}.${timestamp}`)
    .digest("base64url");
}

export function signBuilderProvisioningToken(
  ownerEmail: string,
  sessionToken: string,
): string {
  const nonce = randomBytes(16).toString("base64url");
  const emailEncoded = Buffer.from(ownerEmail, "utf8").toString("base64url");
  const sessionDigest = provisioningSessionDigest(sessionToken);
  const timestamp = Date.now();
  const mac = provisioningMac(nonce, emailEncoded, sessionDigest, timestamp);
  return `${nonce}.${emailEncoded}.${sessionDigest}.${timestamp}.${mac}`;
}

export function verifyBuilderProvisioningToken(
  token: string | null | undefined,
  ownerEmail: string,
  sessionToken: string | null | undefined,
): boolean {
  if (typeof token !== "string" || !sessionToken) return false;
  const parts = token.split(".");
  if (parts.length !== 5) return false;
  const [nonce, emailEncoded, sessionDigest, timestampString, mac] = parts;
  if (!nonce || !emailEncoded || !sessionDigest || !timestampString || !mac) {
    return false;
  }

  let boundEmail: string;
  try {
    boundEmail = Buffer.from(emailEncoded, "base64url").toString("utf8");
    // coercion-ok: malformed proof encoding is an invalid token, never success
  } catch {
    return false;
  }
  if (boundEmail !== ownerEmail) return false;

  const timestamp = Number(timestampString);
  if (
    !Number.isFinite(timestamp) ||
    Math.abs(Date.now() - timestamp) > BUILDER_PROVISIONING_TOKEN_TTL_MS
  ) {
    return false;
  }
  if (sessionDigest !== provisioningSessionDigest(sessionToken)) return false;

  const expected = Buffer.from(
    provisioningMac(nonce, emailEncoded, sessionDigest, timestamp),
  );
  const candidate = Buffer.from(mac);
  return (
    expected.length === candidate.length && timingSafeEqual(expected, candidate)
  );
}

export function signBuilderCallbackState(sessionEmail: string): string {
  return signEmailBoundBuilderToken(sessionEmail, "callback");
}

export function verifyBuilderCallbackState(
  token: string | null | undefined,
  sessionEmail: string,
): boolean {
  return verifyEmailBoundBuilderToken(token, sessionEmail, "callback");
}

export function verifyBuilderCallbackStateAndGetOwner(
  token: string | null | undefined,
): string | null {
  if (typeof token !== "string" || token.length === 0) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const emailEncoded = parts[1];
  if (!emailEncoded) return null;

  let ownerEmail: string;
  try {
    ownerEmail = Buffer.from(emailEncoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!ownerEmail) return null;
  return verifyBuilderCallbackState(token, ownerEmail) ? ownerEmail : null;
}

export function signBuilderConnectToken(ownerEmail: string): string {
  return signEmailBoundBuilderToken(ownerEmail, "connect");
}

export function verifyBuilderConnectToken(
  token: string | null | undefined,
  ownerEmail: string,
): boolean {
  return verifyEmailBoundBuilderToken(token, ownerEmail, "connect");
}

export function verifyBuilderConnectTokenAndGetOwner(
  token: string | null | undefined,
): string | null {
  if (typeof token !== "string" || token.length === 0) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const emailEncoded = parts[1];
  if (!emailEncoded) return null;

  let ownerEmail: string;
  try {
    ownerEmail = Buffer.from(emailEncoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!ownerEmail) return null;
  return verifyBuilderConnectToken(token, ownerEmail) ? ownerEmail : null;
}

export function appendBuilderConnectToken(
  connectUrl: string,
  ownerEmail: string,
): string {
  const url = new URL(connectUrl);
  url.searchParams.set(
    BUILDER_CONNECT_PARAM,
    signBuilderConnectToken(ownerEmail),
  );
  return url.toString();
}

function isAllowedBrowserReturnUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();
    const isAllowedProtocol =
      parsed.protocol === "http:" || parsed.protocol === "https:";
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]";
    const isBuilderDomain =
      hostname === "builder.io" ||
      hostname.endsWith(".builder.io") ||
      hostname === "builder.my" ||
      hostname.endsWith(".builder.my") ||
      hostname === "builderio.xyz" ||
      hostname.endsWith(".builderio.xyz") ||
      hostname === "builderio.dev" ||
      hostname.endsWith(".builderio.dev") ||
      hostname === "builder.codes" ||
      hostname.endsWith(".builder.codes");
    const isAgentNativeDomain =
      hostname === "agent-native.com" || hostname.endsWith(".agent-native.com");
    return (
      isAllowedProtocol &&
      (isLocalhost || isBuilderDomain || isAgentNativeDomain)
    );
  } catch {
    return false;
  }
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

export function getBuilderAppHost(): string {
  return (
    process.env.BUILDER_APP_HOST ||
    process.env.BUILDER_PUBLIC_APP_HOST ||
    DEFAULT_BUILDER_APP_HOST
  );
}

export function getBuilderApiHost(): string {
  return (
    process.env.AIR_HOST ||
    process.env.BUILDER_HOST ||
    process.env.BUILDER_API_HOST ||
    DEFAULT_BUILDER_API_HOST
  );
}

function getConfiguredBuilderBranchProjectId(): string | undefined {
  const projectId =
    process.env.DISPATCH_BUILDER_PROJECT_ID ||
    process.env.BUILDER_BRANCH_PROJECT_ID ||
    process.env.BUILDER_PROJECT_ID;
  return projectId?.trim() || undefined;
}

export function getBuilderBranchProjectId(): string {
  return getConfiguredBuilderBranchProjectId() || "";
}

export function isBuilderBranchingEnabled(): boolean {
  return !!getConfiguredBuilderBranchProjectId();
}

type DispatchBuilderProjectResolution =
  | { status: "absent" }
  | { status: "present"; projectId: string | null }
  | { status: "unreadable" };

async function resolveDispatchBuilderProjectId(): Promise<DispatchBuilderProjectResolution> {
  const orgId = getRequestOrgId()?.trim();
  const userEmail = orgId ? undefined : getRequestUserEmail()?.trim();
  const scopedKey = orgId
    ? `${DISPATCH_APP_CREATION_SETTINGS_KEY}:org:${orgId}`
    : userEmail
      ? `${DISPATCH_APP_CREATION_SETTINGS_KEY}:user:${userEmail}`
      : null;

  if (!scopedKey) return { status: "absent" };

  try {
    const setting = await getSetting(scopedKey);
    if (setting === null) return { status: "absent" };
    const projectId =
      typeof setting.builderProjectId === "string"
        ? setting.builderProjectId.trim()
        : "";
    return { status: "present", projectId: projectId || null };
  } catch {
    return { status: "unreadable" };
  }
}

export async function resolveBuilderBranchProjectId(): Promise<string> {
  const dispatchProject = await resolveDispatchBuilderProjectId();
  if (dispatchProject.status === "unreadable") return "";
  if (dispatchProject.status === "present")
    return dispatchProject.projectId ?? "";

  const envProjectId = getConfiguredBuilderBranchProjectId();
  if (envProjectId) return envProjectId;

  try {
    const { resolveSecret } = await import("./credential-provider.js");
    for (const key of [
      "DISPATCH_BUILDER_PROJECT_ID",
      "BUILDER_BRANCH_PROJECT_ID",
      "BUILDER_PROJECT_ID",
    ]) {
      const value = await resolveSecret(key);
      if (value?.trim()) return value.trim();
    }
  } catch {
    // Secrets table or request context not ready — treat as not configured.
  }

  return "";
}

export async function resolveIsBuilderBranchingEnabled(): Promise<boolean> {
  return !!(await resolveBuilderBranchProjectId());
}

function isBuilderCliAuthAllowedOrigin(origin: string | null | undefined) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();
    const isAllowedProtocol =
      parsed.protocol === "http:" || parsed.protocol === "https:";
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]";
    const isBuilderDomain =
      hostname === "builder.io" || hostname.endsWith(".builder.io");
    const isAgentNativeDomain =
      hostname === "agent-native.com" || hostname.endsWith(".agent-native.com");
    return (
      isAllowedProtocol &&
      (isLocalhost || isBuilderDomain || isAgentNativeDomain)
    );
  } catch {
    return false;
  }
}

function firstBuilderCliAuthCallbackOriginFromEnv(): string | null {
  for (const key of [
    "APP_URL",
    "VITE_APP_URL",
    "BETTER_AUTH_URL",
    "VITE_BETTER_AUTH_URL",
    "WORKSPACE_GATEWAY_URL",
    "VITE_WORKSPACE_GATEWAY_URL",
  ]) {
    const raw = process.env[key];
    if (!raw) continue;
    try {
      const origin = new URL(raw).origin;
      if (isBuilderCliAuthAllowedOrigin(origin)) return origin;
    } catch {
      // Ignore malformed environment values.
    }
  }
  return null;
}

export const BUILDER_OPENER_PARAM = "_an_opener";

function isBuilderOpenerOriginSafe(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Build the Builder cli-auth URL for the connect popup. When a signed
 * `state` token is supplied it is embedded inside the `redirect_url` query
 * string. The connect route also stores it in an HttpOnly cookie because
 * Builder may strip the callback query while appending its response params.
 *
 * Status responses can surface this URL directly; the legacy
 * `/_agent-native/builder/connect` trampoline still calls this helper for
 * clients that only know the app-local connect URL.
 */
export function buildBuilderCliAuthUrl(
  callbackOrigin: string,
  state: string | null = null,
  options: {
    previewOrigin?: string;
    relayState?: string;
    tracking?: BuilderConnectTrackingParams;
  } = {},
): string {
  const normalizedCallbackOrigin = normalizeOrigin(callbackOrigin);
  const requestedPreviewOrigin = normalizeOrigin(
    options.previewOrigin || callbackOrigin,
  );
  const normalizedPreviewOrigin = isBuilderCliAuthAllowedOrigin(
    requestedPreviewOrigin,
  )
    ? requestedPreviewOrigin
    : normalizedCallbackOrigin;
  const appBasePath = getAppBasePath();
  const callbackUrl = new URL(
    `${appBasePath}${BUILDER_CALLBACK_PATH}`,
    normalizedCallbackOrigin,
  );
  if (state) {
    callbackUrl.searchParams.set(BUILDER_STATE_PARAM, state);
  }
  if (options.relayState) {
    callbackUrl.searchParams.set(BUILDER_RELAY_STATE_PARAM, options.relayState);
  }
  if (
    requestedPreviewOrigin &&
    requestedPreviewOrigin !== normalizedPreviewOrigin &&
    isBuilderOpenerOriginSafe(requestedPreviewOrigin)
  ) {
    callbackUrl.searchParams.set(BUILDER_OPENER_PARAM, requestedPreviewOrigin);
  }
  const identity = resolveSignupTrackingIdentity();
  const tracking = {
    signupSource: BUILDER_SIGNUP_SOURCE,
    agentNativeApp: identity.app,
    agentNativeTemplate: identity.template,
    ...options.tracking,
  };
  applyBuilderConnectTrackingParams(callbackUrl.searchParams, tracking);
  const url = new URL("/cli-auth", getBuilderAppHost());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("host", BUILDER_BROWSER_HOST);
  url.searchParams.set("client_id", BUILDER_BROWSER_CLIENT_ID);
  url.searchParams.set("redirect_url", callbackUrl.toString());
  url.searchParams.set(
    "preview_url",
    `${normalizedPreviewOrigin}${appBasePath}`,
  );
  url.searchParams.set("cli", "true");
  url.searchParams.set("framework", "agent-native");
  applyBuilderConnectTrackingParams(url.searchParams, tracking);
  applyBuilderUtmTrackingParams(url.searchParams, {
    content: cleanTrackingParam(tracking.agentNativeConnectSource) ?? null,
  });
  return url.toString();
}

export function getBuilderBrowserConnectUrl(origin: string): string {
  return `${normalizeOrigin(origin)}${getAppBasePath()}${publicFrameworkPath("/_agent-native/builder/connect")}`;
}

export function getBuilderBrowserConnectUrlForOwner(
  origin: string,
  ownerEmail: string | null | undefined,
): string {
  const connectUrl = getBuilderBrowserConnectUrl(origin);
  return ownerEmail
    ? appendBuilderConnectToken(connectUrl, ownerEmail)
    : connectUrl;
}

function firstHeaderValue(value: string | undefined): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

function readEventHeader(event: H3Event, name: string): string | undefined {
  try {
    return getHeader(event, name) ?? undefined;
  } catch {
    const headers = (
      event as unknown as {
        node?: {
          req?: { headers?: Record<string, string | string[] | undefined> };
        };
      }
    ).node?.req?.headers;
    const value = headers?.[name.toLowerCase()] ?? headers?.[name];
    if (Array.isArray(value)) return value[0];
    return typeof value === "string" ? value : undefined;
  }
}

function getBuilderRequestHost(event: H3Event): string | undefined {
  const requestHost = firstHeaderValue(readEventHeader(event, "host"));
  const forwardedHost = firstHeaderValue(
    readEventHeader(event, "x-forwarded-host"),
  );
  if (
    forwardedHost &&
    requestHost &&
    isLoopbackBuilderRequestHost(requestHost)
  ) {
    return isLoopbackBuilderProxyPeer(event) ? forwardedHost : undefined;
  }
  if (
    requestHost &&
    isBuilderCloudRequestHost(requestHost) &&
    !isConfiguredBuilderRequestHost(event, requestHost)
  ) {
    return undefined;
  }
  return requestHost;
}

function isLoopbackBuilderProxyPeer(event: H3Event): boolean {
  try {
    const ip = getRequestIP(event, { xForwardedFor: false });
    return (
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip === "::ffff:127.0.0.1" ||
      ip?.startsWith("127.") === true
    );
    // coercion-ok: unavailable peer data is not trusted as a proxy.
  } catch {
    return false;
  }
}

function isTrustedBuilderRequestHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname === "builderio.xyz" ||
      hostname.endsWith(".builderio.xyz") ||
      hostname === "builderio.dev" ||
      hostname.endsWith(".builderio.dev") ||
      hostname === "builder.codes" ||
      hostname.endsWith(".builder.codes") ||
      hostname === "builder.io" ||
      hostname.endsWith(".builder.io") ||
      hostname === "builder.my" ||
      hostname.endsWith(".builder.my") ||
      hostname === "builder.cloud" ||
      hostname.endsWith(".builder.cloud")
    );
  } catch {
    return false;
  }
}

function isBuilderCloudRequestHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase();
    return hostname === "builder.cloud" || hostname.endsWith(".builder.cloud");
  } catch {
    // coercion-ok: malformed hosts cannot be trusted as Builder Cloud origins.
    return false;
  }
}

function isConfiguredBuilderRequestHost(event: H3Event, host: string): boolean {
  const proto =
    firstHeaderValue(readEventHeader(event, "x-forwarded-proto")) ||
    (process.env.NODE_ENV === "production" ? "https" : "http");
  return isConfiguredAppOrigin(`${proto}://${host}`);
}

function getBuilderConnectCallbackOrigin(event: H3Event): string | null {
  const requestHost = firstHeaderValue(readEventHeader(event, "host"));
  const headerHost = getBuilderRequestHost(event);
  if (isRejectedDirectBuilderCloudHost(requestHost, headerHost)) {
    return getConfiguredBuilderFallbackOrigin(event);
  }
  if (isBuilderCloudRequestHost(headerHost)) {
    return getBuilderBrowserOriginForEvent(event);
  }
  const configuredOrigin = getOrigin(event, { useForwardedHost: false });
  if (!isLoopbackOrigin(configuredOrigin)) return configuredOrigin;
  if (
    !isLoopbackBuilderRequestHost(headerHost) &&
    isTrustedBuilderRequestHost(headerHost)
  ) {
    const previewOrigin = getBuilderBrowserOriginForEvent(event);
    if (previewOrigin && !isLoopbackOrigin(previewOrigin)) return previewOrigin;
  }
  return configuredOrigin;
}

function isRejectedDirectBuilderCloudHost(
  requestHost: string | undefined,
  resolvedHost: string | undefined,
): boolean {
  return isBuilderCloudRequestHost(requestHost) && requestHost !== resolvedHost;
}

function getConfiguredBuilderFallbackOrigin(event: H3Event): string | null {
  const origin = getOrigin(event, { useForwardedHost: false });
  return isConfiguredAppOrigin(origin) ? origin : null;
}

function isLoopbackBuilderRequestHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function firstPublicBuilderPreviewOriginFromEnv(): string | null {
  for (const key of [
    "FUSION_ENV_ORIGIN",
    "VITE_FUSION_ENV_ORIGIN",
    "BUILDER_PREVIEW_URL",
    "VITE_BUILDER_PREVIEW_URL",
  ]) {
    const raw = process.env[key];
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (isLoopbackBuilderRequestHost(url.host)) continue;
      if (!isTrustedBuilderRequestHost(url.host)) continue;
      return url.origin;
    } catch {
      // Ignore malformed environment values.
    }
  }
  return null;
}

export function getBuilderBrowserOriginForEvent(event: H3Event): string {
  const requestHost = firstHeaderValue(readEventHeader(event, "host"));
  const headerHost = getBuilderRequestHost(event);
  if (isRejectedDirectBuilderCloudHost(requestHost, headerHost)) {
    return getConfiguredBuilderFallbackOrigin(event) ?? "";
  }
  if (!isTrustedBuilderRequestHost(headerHost)) {
    return getOrigin(event, { useForwardedHost: false });
  }
  if (isLoopbackBuilderRequestHost(headerHost)) {
    const publicPreviewOrigin = firstPublicBuilderPreviewOriginFromEnv();
    if (publicPreviewOrigin) return publicPreviewOrigin;
  }

  const rawProto = firstHeaderValue(
    readEventHeader(event, "x-forwarded-proto"),
  );
  const proto =
    rawProto === "http" || rawProto === "https"
      ? rawProto
      : process.env.NODE_ENV === "production"
        ? "https"
        : "http";
  return `${proto}://${headerHost}`;
}

export function getBuilderCliAuthCallbackOriginForEvent(
  event: H3Event,
): string {
  const previewOrigin = getBuilderBrowserOriginForEvent(event);
  if (isBuilderCliAuthAllowedOrigin(previewOrigin)) return previewOrigin;
  const envOrigin = firstBuilderCliAuthCallbackOriginFromEnv();
  if (envOrigin) return envOrigin;
  return localBuilderCliAuthCallbackOrigin() ?? previewOrigin;
}

function localBuilderCliAuthCallbackOrigin(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  const port = process.env.PORT?.trim();
  if (!port || !/^\d{1,5}$/.test(port)) return null;
  return `http://localhost:${port}`;
}

export function getBuilderBrowserStatus(origin: string): BuilderBrowserStatus {
  const branchProjectId = getConfiguredBuilderBranchProjectId();
  const envManaged = !!process.env.BUILDER_PRIVATE_KEY;
  return {
    configured: !!(
      process.env.BUILDER_PRIVATE_KEY && process.env.BUILDER_PUBLIC_KEY
    ),
    builderEnabled: isBuilderBranchingEnabled(),
    agentNativeProvisioningEnabled: isBuilderAccountProvisioningEnabled(),
    branchProjectIdConfigured: !!branchProjectId,
    branchProjectId: branchProjectId || undefined,
    envManaged,
    credentialSource: envManaged ? "env" : undefined,
    canDisconnect: false,
    appHost: getBuilderAppHost(),
    apiHost: getBuilderApiHost(),
    connectUrl: origin ? getBuilderBrowserConnectUrl(origin) : "",
    publicKeyConfigured: !!process.env.BUILDER_PUBLIC_KEY,
    privateKeyConfigured: !!process.env.BUILDER_PRIVATE_KEY,
    userId: process.env.BUILDER_USER_ID || undefined,
    orgName: process.env.BUILDER_ORG_NAME || undefined,
    orgKind: process.env.BUILDER_ORG_KIND || undefined,
    subscription: process.env.BUILDER_SUBSCRIPTION || undefined,
    subscriptionLevel: process.env.BUILDER_SUBSCRIPTION_LEVEL || undefined,
    subscriptionName: process.env.BUILDER_SUBSCRIPTION_NAME || undefined,
    isEnterprise: parseOptionalEnvBoolean(process.env.BUILDER_IS_ENTERPRISE),
    isFreeAccount: parseOptionalEnvBoolean(process.env.BUILDER_IS_FREE_ACCOUNT),
  };
}

function parseOptionalEnvBoolean(
  value: string | undefined,
): boolean | undefined {
  if (!value) return undefined;
  return /^(1|true)$/i.test(value);
}

export function getBuilderBrowserStatusForEvent(
  event: H3Event,
): BuilderBrowserStatus {
  return getBuilderBrowserStatus(getBuilderBrowserOriginForEvent(event));
}

export const BUILDER_ENV_KEYS = [
  "BUILDER_PRIVATE_KEY",
  "BUILDER_PUBLIC_KEY",
  "BUILDER_USER_ID",
  "BUILDER_ORG_NAME",
  "BUILDER_ORG_KIND",
  "BUILDER_SUBSCRIPTION",
  "BUILDER_SUBSCRIPTION_LEVEL",
  "BUILDER_SUBSCRIPTION_NAME",
  "BUILDER_IS_ENTERPRISE",
  "BUILDER_IS_FREE_ACCOUNT",
] as const;

export type BuilderEnvKey = (typeof BUILDER_ENV_KEYS)[number];

export function getBuilderCallbackEnvVars(params: {
  privateKey?: string | null;
  publicKey?: string | null;
  userId?: string | null;
  orgName?: string | null;
  orgKind?: string | null;
  subscription?: string | null;
  subscriptionLevel?: string | null;
  subscriptionName?: string | null;
  isEnterprise?: boolean | null;
  isFreeAccount?: boolean | null;
}) {
  const values: Record<BuilderEnvKey, string> = {
    BUILDER_PRIVATE_KEY: params.privateKey?.trim() || "",
    BUILDER_PUBLIC_KEY: params.publicKey?.trim() || "",
    BUILDER_USER_ID: params.userId?.trim() || "",
    BUILDER_ORG_NAME: params.orgName?.trim() || "",
    BUILDER_ORG_KIND: params.orgKind?.trim() || "",
    BUILDER_SUBSCRIPTION: params.subscription?.trim() || "",
    BUILDER_SUBSCRIPTION_LEVEL: params.subscriptionLevel?.trim() || "",
    BUILDER_SUBSCRIPTION_NAME: params.subscriptionName?.trim() || "",
    BUILDER_IS_ENTERPRISE:
      typeof params.isEnterprise === "boolean"
        ? String(params.isEnterprise)
        : "",
    BUILDER_IS_FREE_ACCOUNT:
      typeof params.isFreeAccount === "boolean"
        ? String(params.isFreeAccount)
        : "",
  };
  return BUILDER_ENV_KEYS.map((key) => ({ key, value: values[key] }));
}

export function resolveSafePreviewUrl(
  previewUrl: string | null | undefined,
  event: H3Event,
): string {
  if (previewUrl && isAllowedBrowserReturnUrl(previewUrl)) {
    return previewUrl;
  }
  return getBuilderBrowserOriginForEvent(event);
}

export function resolveBuilderPreviewRelayParentOrigin(options: {
  openerOrigin?: string | null;
  targetOrigin: string;
}): string {
  if (!options.openerOrigin) return options.targetOrigin;
  let openerUrl: URL;
  let targetUrl: URL;
  try {
    openerUrl = new URL(options.openerOrigin);
    targetUrl = new URL(options.targetOrigin);
  } catch {
    return options.targetOrigin;
  }
  if (
    openerUrl.origin !== options.openerOrigin ||
    !isSafeBuilderRelayTargetOrigin(openerUrl.origin)
  ) {
    return options.targetOrigin;
  }
  if (openerUrl.origin === targetUrl.origin) return openerUrl.origin;

  const openerMatch = NETLIFY_DEPLOY_PREVIEW_HOST.exec(
    openerUrl.hostname.toLowerCase(),
  );
  const targetMatch = IMMUTABLE_NETLIFY_RELAY_HOST.exec(
    targetUrl.hostname.toLowerCase(),
  );
  return openerMatch?.groups?.site &&
    openerMatch.groups.site === targetMatch?.groups?.site
    ? openerUrl.origin
    : options.targetOrigin;
}

export function resolveBuilderCallbackReturnUrl(options: {
  event: H3Event;
  openerOrigin?: string | null;
  previewUrl?: string | null;
}): string {
  const openerOrigin =
    options.openerOrigin && isAllowedBrowserReturnUrl(options.openerOrigin)
      ? options.openerOrigin
      : null;
  if (openerOrigin) {
    return new URL(getAppBasePath() || "/", openerOrigin).toString();
  }
  return resolveSafePreviewUrl(options.previewUrl, options.event);
}

const BUILDER_CALLBACK_THEME_SCRIPT = `<script>
(function () {
  try {
    var stored = window.localStorage && window.localStorage.getItem("theme");
    var resolved;
    if (stored === "light" || stored === "dark") {
      resolved = stored;
    } else {
      var mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
      resolved = mq && mq.matches ? "dark" : "light";
    }
    document.documentElement.classList.add(resolved);
    document.documentElement.style.colorScheme = resolved;
  } catch (e) {}
})();
</script>`;

const BUILDER_CALLBACK_BASE_CSS = `
  :root {
    --bg: hsl(0 0% 100%);
    --fg: hsl(220 10% 10%);
    --muted-fg: hsl(220 5% 45%);
    --card: hsl(0 0% 100%);
    --border: hsl(220 10% 90%);
    --primary: hsl(220 10% 15%);
    --primary-fg: hsl(0 0% 100%);
    --primary-hover: hsl(220 10% 25%);
    --success-bg: hsl(143 50% 96%);
    --success-fg: hsl(143 60% 32%);
    --error-fg: hsl(0 75% 45%);
    --error-bg: hsl(0 80% 97%);
    --error-border: hsl(0 80% 92%);
  }
  :root.dark {
    --bg: hsl(220 6% 6%);
    --fg: hsl(0 0% 92%);
    --muted-fg: hsl(220 4% 60%);
    --card: hsl(220 5% 8%);
    --border: hsl(220 4% 14%);
    --primary: hsl(0 0% 92%);
    --primary-fg: hsl(220 6% 6%);
    --primary-hover: hsl(0 0% 75%);
    --success-bg: hsl(143 30% 12%);
    --success-fg: hsl(143 50% 70%);
    --error-fg: hsl(0 80% 75%);
    --error-bg: hsl(0 35% 12%);
    --error-border: hsl(0 30% 20%);
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: var(--bg);
    color: var(--fg);
    font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-size: 14px;
    line-height: 1.55;
    font-feature-settings: "cv02", "cv03", "cv04", "cv11";
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    padding: 24px;
  }
  .card {
    width: min(420px, 100%);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 32px 28px;
    background: var(--card);
    text-align: center;
  }
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    margin-bottom: 16px;
  }
  .icon svg { width: 22px; height: 22px; display: block; }
  .icon-success { background: var(--success-bg); color: var(--success-fg); }
  .icon-error { background: var(--error-bg); color: var(--error-fg); }
  h1 {
    margin: 0 0 6px;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--fg);
  }
  p {
    margin: 0 0 4px;
    color: var(--fg);
    font-size: 14px;
  }
  p.muted { color: var(--muted-fg); }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 36px;
    padding: 0 16px;
    margin-top: 20px;
    background: var(--primary);
    color: var(--primary-fg);
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    border: none;
    cursor: pointer;
  }
  .btn:hover { background: var(--primary-hover); }
  pre.error-detail {
    margin: 16px 0 0;
    padding: 10px 12px;
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    border-radius: 8px;
    color: var(--error-fg);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    text-align: left;
    white-space: pre-wrap;
    word-break: break-word;
  }
`;

function safeOriginFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function createBuilderBrowserCallbackPage(
  previewUrl: string,
  opts: { parentOrigin?: string; attemptId?: string } = {},
): string {
  const escapedUrl = JSON.stringify(previewUrl);
  const escapedAttemptId = JSON.stringify(opts.attemptId ?? null);
  const parentOrigin =
    safeOriginFromUrl(opts.parentOrigin) ?? safeOriginFromUrl(previewUrl);
  const escapedTargetOrigin = JSON.stringify(parentOrigin ?? "*");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <title>Builder connected</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
    ${BUILDER_CALLBACK_THEME_SCRIPT}
    <style>${BUILDER_CALLBACK_BASE_CSS}</style>
  </head>
  <body>
    <main class="card" role="status" aria-live="polite">
      <span class="icon icon-success" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      </span>
      <h1>Builder connected</h1>
      <p>Browser access is now available to your app.</p>
      <p class="muted">You can close this tab and return to the workspace.</p>
      <a class="btn" href=${escapedUrl}>Open the workspace</a>
    </main>
    <script>
      // Tell the opener tab the connect succeeded. The parent has two ways
      // to learn this:
      //   1. The popup-based connect flow (window.open + 2s polling on
      //      /builder/status) — picks it up via the next poll within ~2s.
      //   2. The link-based "Use Builder" flow (target="_blank" tab) — the
      //      AgentPanel only fetches /builder/status once on mount, so it
      //      stays stuck on "Use Builder" unless we explicitly signal.
      // BroadcastChannel + postMessage cover both cases. Use the same channel
      // name as the error path (createBuilderBrowserCallbackErrorPage) and
      // mirror the parent-side listener in useBuilderStatus / useBuilderConnectUrl.
      try {
        var bc = new BroadcastChannel("builder-connect:" + window.location.host);
        bc.postMessage({ type: "builder-connect-success", attemptId: ${escapedAttemptId} || undefined });
        bc.close();
      } catch (e) {}
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            { type: "builder-connect-success", attemptId: ${escapedAttemptId} || undefined },
            ${escapedTargetOrigin},
          );
        }
      } catch (e) {}
      // If we're a popup opened by the app, close ourselves and let the
      // parent tab keep polling for connection status. If close() is
      // blocked (e.g. we're the top-level tab because popups were
      // downgraded), fall back to navigating back to the workspace.
      window.setTimeout(function () {
        try { window.close(); } catch (e) {}
        window.setTimeout(function () {
          if (!window.closed) {
            window.location.replace(${escapedUrl});
          }
        }, 200);
      }, 700);
    </script>
  </body>
</html>`;
}

export function createBuilderBrowserCallbackErrorPage(
  message: string,
  opts: {
    title?: string;
    body?: string;
    closeHint?: string;
    parentOrigin?: string;
    code?: string;
    attemptId?: string;
  } = {},
): string {
  const escapedMessage = JSON.stringify(message);
  const escapedCode = JSON.stringify(opts.code ?? null);
  const escapedAttemptId = JSON.stringify(opts.attemptId ?? null);
  const parentOrigin = safeOriginFromUrl(opts.parentOrigin);
  const escapedTargetOrigin = JSON.stringify(parentOrigin ?? "*");
  const title = opts.title ?? "Couldn't save Builder connection";
  const body =
    opts.body ??
    "Builder authorized your account but the server couldn't persist the credentials.";
  const closeHint =
    opts.closeHint ?? "You can close this tab and try again from settings.";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <title>Builder connect failed</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
    ${BUILDER_CALLBACK_THEME_SCRIPT}
    <style>${BUILDER_CALLBACK_BASE_CSS}</style>
  </head>
  <body>
    <main class="card" role="alert" aria-live="assertive">
      <span class="icon icon-error" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
      </span>
      <h1>${escapeHtml(title)}</h1>
      <p class="muted">${escapeHtml(body)}</p>
      <pre class="error-detail" id="msg"></pre>
      <p class="muted" style="margin-top:12px">${escapeHtml(closeHint)}</p>
    </main>
    <script>
      try {
        var msg = ${escapedMessage};
        var code = ${escapedCode};
        document.getElementById("msg").textContent = msg;
        // Notify the parent tab immediately so its polling loop stops
        // without waiting for the next /builder/status tick.
        //
        // BroadcastChannel works across same-origin windows regardless of
        // opener access — it is the only reliable channel here because
        // popups opened with window.open(..., "noopener") or links with
        // rel="noopener" have window.opener === null. The legacy
        // window.opener.postMessage path is kept as a belt-and-suspenders
        // fallback for non-BroadcastChannel environments.
        try {
          var bc = new BroadcastChannel("builder-connect:" + window.location.host);
          bc.postMessage({ type: "builder-connect-error", message: msg, code: code || undefined, attemptId: ${escapedAttemptId} || undefined });
          bc.close();
        } catch (e) {}
        if (window.opener && !window.opener.closed) {
          try {
            window.opener.postMessage(
              { type: "builder-connect-error", message: msg, code: code || undefined, attemptId: ${escapedAttemptId} || undefined },
              ${escapedTargetOrigin},
            );
          } catch (e) {}
        }
      } catch (e) {}
    </script>
  </body>
</html>`;
}

export const BUILDER_UPSTREAM_FAILURE_STATUS = 503;

const CDN_REPLACED_GATEWAY_STATUSES = new Set([502, 504]);

export function cdnSafeOriginStatus(status: number): number {
  return CDN_REPLACED_GATEWAY_STATUSES.has(status)
    ? BUILDER_UPSTREAM_FAILURE_STATUS
    : status;
}

export function sendBuilderPopupErrorPage(
  event: H3Event,
  status: number,
  message: string,
  opts: Parameters<typeof createBuilderBrowserCallbackErrorPage>[1] = {},
): string {
  setResponseStatus(event, cdnSafeOriginStatus(status));
  setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
  return createBuilderBrowserCallbackErrorPage(message, opts);
}

export interface BuilderAgentUploadAttachment {
  type: "upload";
  contentType:
    | "image/webp"
    | "image/png"
    | "image/jpeg"
    | "image/gif"
    | "application/pdf"
    | "application/json"
    | "text/plain";
  name: string;
  dataUrl: string;
  text?: string;
  size: number;
  id: string;
}

export interface BuilderAgentUrlAttachment {
  type: "url";
  value: string;
}

export type BuilderAgentAttachment =
  | BuilderAgentUploadAttachment
  | BuilderAgentUrlAttachment;

export interface RunBuilderAgentArgs {
  prompt: string;
  context?: string;
  attachments?: BuilderAgentAttachment[];
  projectId?: string;
  branchName?: string;
  userEmail?: string;
  userId?: string;
}

export const BUILDER_AGENT_CONTEXT_MAX_CHARS = 32_000;

const BUILDER_AGENT_UPLOAD_CONTENT_TYPES = new Set<
  BuilderAgentUploadAttachment["contentType"]
>([
  "image/webp",
  "image/png",
  "image/jpeg",
  "image/gif",
  "application/pdf",
  "application/json",
  "text/plain",
]);

export function normalizeBuilderAgentAttachments(
  attachments: BuilderAgentAttachment[] | undefined,
): BuilderAgentAttachment[] | undefined {
  if (!attachments || attachments.length === 0) return undefined;

  const normalized = attachments.map((attachment) => {
    if (attachment.type === "url") {
      let url: URL;
      try {
        url = new URL(attachment.value);
      } catch {
        throw new Error("Builder attachment URL is malformed");
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("Builder attachment URL must use http or https");
      }
      return attachment;
    }

    if (!BUILDER_AGENT_UPLOAD_CONTENT_TYPES.has(attachment.contentType)) {
      throw new Error(
        `Unsupported Builder attachment content type: ${attachment.contentType}`,
      );
    }
    if (!attachment.name.trim() || !attachment.id.trim()) {
      throw new Error("Builder upload attachments require a name and id");
    }
    if (!Number.isInteger(attachment.size) || attachment.size < 0) {
      throw new Error("Builder attachment size must be a non-negative integer");
    }
    if (
      attachment.contentType === "text/plain" ||
      attachment.contentType === "application/json"
    ) {
      if (attachment.text === undefined || attachment.dataUrl !== "") {
        throw new Error(
          "Text and JSON Builder attachments require text and an empty dataUrl",
        );
      }
      if (Buffer.byteLength(attachment.text, "utf8") !== attachment.size) {
        throw new Error(
          "Builder attachment size does not match its text content",
        );
      }
    } else if (
      !attachment.dataUrl.startsWith(`data:${attachment.contentType};base64,`)
    ) {
      throw new Error(
        "Image and PDF Builder attachments require a matching base64 dataUrl",
      );
    }

    return attachment;
  });

  return normalized;
}

export function normalizeBuilderAgentContext(
  value: unknown,
): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new Error("context must be a string");
  }
  const context = value.trim();
  if (!context) return undefined;
  if (context.length > BUILDER_AGENT_CONTEXT_MAX_CHARS) {
    throw new Error(
      `context must be ${BUILDER_AGENT_CONTEXT_MAX_CHARS} characters or fewer`,
    );
  }
  return context;
}

export function buildBuilderAgentUserPrompt(
  prompt: string,
  context?: string,
): string {
  const normalizedContext = normalizeBuilderAgentContext(context);
  if (!normalizedContext) return prompt;
  return `${prompt.trim()}\n\n<context>\n${normalizedContext}\n</context>`;
}

export interface RunBuilderAgentResult {
  branchName: string;
  projectId: string;
  url: string;
  status: string;
}

export interface BuilderProjectLookupArgs {
  repoUrl: string;
}

export interface BuilderProjectResult {
  projectId: string;
  name: string;
  repoUrl?: string;
  browserUrl: string;
  created: boolean;
}

function normalizeBuilderApiString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Builder agent run returned a blank ${fieldName}`);
  }
  const trimmed = value.trim();
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error(`Builder agent run returned a malformed ${fieldName}`);
  }
  return trimmed;
}

function normalizeBuilderProjectString(
  value: unknown,
  fieldName: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Builder project response returned a blank ${fieldName}`);
  }
  const trimmed = value.trim();
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error(
      `Builder project response returned a malformed ${fieldName}`,
    );
  }
  return trimmed;
}

function normalizeBuilderRepoUrl(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Builder project repository URL is malformed");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Builder project repository URL must use HTTP or HTTPS");
  }
  return trimmed;
}

function comparableBuilderRepoUrl(value: string): string {
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.replace(/\/+$/, "").replace(/\.git$/, "");
    return `${parsed.hostname.toLowerCase()}${pathname.toLowerCase()}`;
  } catch {
    return value
      .trim()
      .replace(/\/+$/, "")
      .replace(/\.git$/, "")
      .toLowerCase();
  }
}

function builderProjectBrowserUrl(projectId: string): string {
  return `${getBuilderAppHost().replace(/\/$/, "")}/app/projects/${encodeURIComponent(projectId)}`;
}

function builderProjectFromRecord(
  value: unknown,
  created: boolean,
  fallbackRepoUrl?: string,
): BuilderProjectResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const projectId =
    typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
  if (!projectId) return null;
  const name =
    typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : "Agent-Native Workspace";
  const repoUrl =
    typeof record.repoUrl === "string" && record.repoUrl.trim()
      ? record.repoUrl.trim()
      : fallbackRepoUrl;
  return {
    projectId: normalizeBuilderProjectString(projectId, "project id"),
    name: normalizeBuilderProjectString(name, "project name"),
    ...(repoUrl ? { repoUrl } : {}),
    browserUrl: builderProjectBrowserUrl(projectId),
    created,
  };
}

async function resolveBuilderApiAuthorization(
  requiredScope: BuilderOAuthPermissionScope,
): Promise<BuilderRequestAuthorization> {
  const authorization = await resolveBuilderRequestAuthorization({
    requiredScope,
  });
  if (!authorization) {
    throw new ActionContractError(
      "Builder.io is not connected. Connect Builder.io in Settings.",
      { errorCode: "builder_not_connected", statusCode: 400 },
    );
  }
  if (authorization.source === "legacy" && !authorization.legacyPublicKey) {
    throw new ActionContractError(
      "Builder legacy credentials require BUILDER_PUBLIC_KEY for this request.",
      { errorCode: "builder_legacy_public_key_required", statusCode: 400 },
    );
  }
  return authorization;
}

async function fetchBuilderApi(
  input: URL,
  init: RequestInit,
  operation: string,
): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      signal: AbortSignal.timeout(BUILDER_API_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "";
    if (errorName === "AbortError" || errorName === "TimeoutError") {
      throw new Error(
        `Builder ${operation} timed out after ${BUILDER_API_REQUEST_TIMEOUT_MS}ms`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function readBuilderApiObject(
  response: Response,
  operation: string,
): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (error) {
    throw new Error(
      "Builder " +
        operation +
        " returned an invalid JSON response (" +
        response.status +
        ")",
      { cause: error },
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "Builder " +
        operation +
        " returned an invalid JSON response (" +
        response.status +
        ")",
    );
  }
  return parsed as Record<string, unknown>;
}

export function isBuilderAccountProvisioningEnabled(): boolean {
  const secret = readDeployCredentialEnv(
    BUILDER_ACCOUNT_PROVISIONING_SECRET_ENV,
  )?.trim();
  return Boolean(secret && secret.length >= 32);
}

function builderAccountProvisioningSecret(): string {
  const secret = readDeployCredentialEnv(
    BUILDER_ACCOUNT_PROVISIONING_SECRET_ENV,
  )?.trim();
  if (!secret) {
    throw new Error(
      `${BUILDER_ACCOUNT_PROVISIONING_SECRET_ENV} is required for Builder account provisioning.`,
    );
  }
  if (secret.length < 32) {
    throw new Error(
      `${BUILDER_ACCOUNT_PROVISIONING_SECRET_ENV} must be at least 32 characters long.`,
    );
  }
  return secret;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringField(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanField(
  record: Record<string, unknown> | null,
  key: string,
): boolean | null {
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

function parseBuilderAccountProvisioningResponse(
  parsed: Record<string, unknown>,
): BuilderRelayCredentials {
  const envelope = isRecord(parsed.credentials) ? parsed.credentials : parsed;
  const organization = isRecord(envelope.organization)
    ? envelope.organization
    : null;
  const space = isRecord(envelope.space) ? envelope.space : null;
  const user = isRecord(envelope.user) ? envelope.user : null;
  const metadata = space ?? organization;
  const privateKey =
    stringField(envelope, "privateKey") ??
    stringField(space, "privateKey") ??
    stringField(organization, "privateKey");
  const publicKey =
    stringField(envelope, "publicKey") ??
    stringField(space, "id") ??
    stringField(organization, "id");
  if (!privateKey || !publicKey) {
    throw new Error(
      "Builder account provisioning returned incomplete credentials.",
    );
  }

  const subscription =
    stringField(envelope, "subscription") ??
    stringField(metadata, "subscription");
  const subscriptionName =
    stringField(envelope, "subscriptionName") ??
    stringField(metadata, "subscriptionName") ??
    (subscription?.includes(":level1") ? "free" : null);
  return {
    privateKey,
    publicKey,
    userId: stringField(envelope, "userId") ?? stringField(user, "id"),
    orgName:
      stringField(envelope, "orgName") ??
      stringField(space, "name") ??
      stringField(organization, "name"),
    orgKind:
      stringField(envelope, "orgKind") ??
      stringField(space, "kind") ??
      stringField(organization, "kind"),
    subscription,
    subscriptionLevel:
      stringField(envelope, "subscriptionLevel") ??
      stringField(metadata, "subscriptionLevel"),
    subscriptionName,
    isEnterprise:
      booleanField(envelope, "isEnterprise") ??
      (subscription?.includes("enterprise") ? true : null),
    isFreeAccount:
      booleanField(envelope, "isFreeAccount") ??
      (subscriptionName === "free" ? true : null),
  };
}

export async function provisionBuilderAccount(input: {
  email: string;
  name?: string;
}): Promise<BuilderRelayCredentials> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new Error("Builder account provisioning requires a valid email.");
  }
  const name =
    input.name?.trim().slice(0, 120) || email.slice(0, email.indexOf("@"));
  const timestamp = String(Date.now());
  const requestId = randomBytes(32).toString("base64url");
  const signaturePayload = [
    "agent-native-account-v1",
    timestamp,
    requestId,
    email,
    name,
  ].join("\n");
  const signature = createHmac("sha256", builderAccountProvisioningSecret())
    .update(signaturePayload)
    .digest("base64url");
  const response = await fetchBuilderApi(
    new URL("/api/v1/accounts/agent-native", getBuilderApiHost()),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-native-account-version": "agent-native-account-v1",
        "x-agent-native-account-timestamp": timestamp,
        "x-agent-native-account-request-id": requestId,
        "x-agent-native-account-signature": signature,
      },
      body: JSON.stringify({ email, name }),
    },
    "account provisioning",
  );
  const parsed = await readBuilderApiObject(response, "account provisioning");
  if (!response.ok) {
    throw new BuilderAccountProvisioningError(
      builderApiErrorMessage(
        parsed,
        `Builder account provisioning failed (${response.status})`,
      ),
      typeof parsed.code === "string" ? parsed.code : undefined,
    );
  }
  return parseBuilderAccountProvisioningResponse(parsed);
}

function builderApiFailure(status: number, message: string): Error {
  return status === 401
    ? new ActionContractError(message, {
        errorCode: "builder_not_connected",
        statusCode: 400,
      })
    : new Error(message);
}

function builderApiErrorMessage(
  parsed: Record<string, unknown>,
  fallback: string,
): string {
  if (typeof parsed.error === "string" && parsed.error.trim()) {
    return parsed.error.trim();
  }
  if (typeof parsed.message === "string" && parsed.message.trim()) {
    return parsed.message.trim();
  }
  return fallback;
}

/** @deprecated Repository-backed Builder projects are retained for compatibility. */
export async function findBuilderProjectForRepo(
  args: BuilderProjectLookupArgs,
): Promise<BuilderProjectResult | null> {
  const repoUrl = normalizeBuilderRepoUrl(args.repoUrl);
  const authorization = await resolveBuilderApiAuthorization(
    "builder:projects:read",
  );
  const url = new URL("/projects", getBuilderApiHost());
  if (authorization.legacyPublicKey)
    url.searchParams.set("apiKey", authorization.legacyPublicKey);
  url.searchParams.set("includeHidden", "true");

  const response = await fetchBuilderApi(
    url,
    {
      method: "GET",
      headers: { Authorization: authorization.authorization },
    },
    "project lookup",
  );
  const parsed = await readBuilderApiObject(response, "project lookup");
  if (!response.ok) {
    throw builderApiFailure(
      response.status,
      builderApiErrorMessage(
        parsed,
        `Builder project lookup failed (${response.status})`,
      ),
    );
  }
  if (!Array.isArray(parsed.projects)) {
    throw new Error("Builder project lookup returned no projects list");
  }

  const comparableRepoUrl = comparableBuilderRepoUrl(repoUrl);
  for (const project of parsed.projects) {
    const normalized = builderProjectFromRecord(project, false);
    if (
      normalized?.repoUrl &&
      comparableBuilderRepoUrl(normalized.repoUrl) === comparableRepoUrl
    ) {
      return normalized;
    }
  }
  return null;
}

export async function createBuilderProject(args: {
  name: string;
  templateId?: string;
  repoUrl?: string;
}): Promise<BuilderProjectResult> {
  const name = normalizeBuilderProjectString(args.name, "project name");
  const repoUrl = args.repoUrl
    ? normalizeBuilderRepoUrl(args.repoUrl)
    : undefined;
  const templateId = repoUrl
    ? undefined
    : normalizeBuilderProjectString(
        args.templateId ?? DEFAULT_BUILDER_TEMPLATE_ID,
        "template id",
      );
  const authorization = await resolveBuilderApiAuthorization(
    "builder:projects:write",
  );
  const url = new URL("/projects/create", getBuilderApiHost());
  if (authorization.legacyPublicKey)
    url.searchParams.set("apiKey", authorization.legacyPublicKey);

  const response = await fetchBuilderApi(
    url,
    {
      method: "POST",
      headers: {
        Authorization: authorization.authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: repoUrl
          ? { kind: "repo", repoUrl }
          : { kind: "template", templateId },
        name,
      }),
    },
    "project creation",
  );
  const parsed = await readBuilderApiObject(response, "project creation");
  if (!response.ok) {
    throw builderApiFailure(
      response.status,
      builderApiErrorMessage(
        parsed,
        `Builder project creation failed (${response.status})`,
      ),
    );
  }

  const project = builderProjectFromRecord(parsed.project, true, repoUrl);
  if (!project) {
    throw new Error("Builder project creation returned no project id");
  }
  return project;
}

/** @deprecated Repository-backed Builder projects are retained for compatibility. */
export async function ensureBuilderProject(args: {
  name: string;
  repoUrl: string;
}): Promise<BuilderProjectResult> {
  const existing = await findBuilderProjectForRepo({ repoUrl: args.repoUrl });
  return existing ?? createBuilderProject(args);
}

function normalizeBuilderBranchUrl(value: unknown): string {
  const urlString = normalizeBuilderApiString(value, "url");
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error("Builder agent run returned a malformed url");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Builder agent run returned a malformed url");
  }
  if (
    parsed.hostname !== "builder.io" &&
    !parsed.hostname.endsWith(".builder.io")
  ) {
    throw new Error("Builder agent run returned a non-Builder url");
  }
  return parsed.toString();
}

export async function runBuilderAgent(
  args: RunBuilderAgentArgs,
): Promise<RunBuilderAgentResult> {
  const authorization =
    await resolveBuilderApiAuthorization("builder:agents:run");
  if (!args.prompt || !args.prompt.trim()) {
    throw new Error("prompt is required");
  }
  const projectId = args.projectId?.trim();
  if (!projectId) {
    throw new Error(
      "Builder project ID is not configured. Set DISPATCH_BUILDER_PROJECT_ID, BUILDER_BRANCH_PROJECT_ID, or BUILDER_PROJECT_ID.",
    );
  }
  // The requesting user's email must win over any stored BUILDER_USER_ID.
  // The connect flow always persists BUILDER_USER_ID, so preferring it here
  // attributed every branch to whoever connected the credential — at org scope
  // that is the admin, not the person who asked. Builder resolves userEmail
  // against Space membership, so fall back to the credential's user id when
  // there is no session email or the email is not a member.
  const requestedEmail = args.userEmail?.trim() || undefined;
  const fallbackUserId = args.userId || authorization.userId || undefined;
  const builderUserEmail = requestedEmail;
  const builderUserId = requestedEmail ? undefined : fallbackUserId;
  if (!builderUserEmail && !builderUserId) {
    throw new Error("userEmail or userId is required");
  }
  const userPrompt = buildBuilderAgentUserPrompt(args.prompt, args.context);
  const attachments = normalizeBuilderAgentAttachments(args.attachments);

  const url = new URL("/agents/run", getBuilderApiHost());
  if (authorization.legacyPublicKey)
    url.searchParams.set("apiKey", authorization.legacyPublicKey);

  const postRun = async (actor: { userEmail?: string; userId?: string }) => {
    const body: Record<string, unknown> = {
      userMessage: {
        userPrompt,
        ...(attachments ? { attachments } : {}),
      },
      projectId,
    };
    if (args.branchName) body.branchName = args.branchName;
    if (actor.userEmail) body.userEmail = actor.userEmail;
    if (actor.userId) body.userId = actor.userId;
    const serializedBody = JSON.stringify(body);
    const response = await fetchBuilderApi(
      url,
      {
        method: "POST",
        headers: {
          Authorization: authorization.authorization,
          "Content-Type": "application/json",
        },
        body: serializedBody,
      },
      "agent run",
    );
    const parsed = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    return { response, parsed };
  };

  let { response, parsed } = await postRun({
    userEmail: builderUserEmail,
    userId: builderUserId,
  });

  if (
    !response.ok &&
    (response.status === 403 || response.status === 404) &&
    builderUserEmail &&
    fallbackUserId
  ) {
    ({ response, parsed } = await postRun({ userId: fallbackUserId }));
  }

  if (!response.ok) {
    const msg =
      typeof parsed.error === "string"
        ? parsed.error
        : `Builder agent run failed (${response.status})`;
    throw builderApiFailure(response.status, msg);
  }

  return {
    branchName: normalizeBuilderApiString(parsed.branchName, "branchName"),
    projectId:
      typeof parsed.projectId === "string" && parsed.projectId.trim()
        ? parsed.projectId.trim()
        : projectId,
    url: normalizeBuilderBranchUrl(parsed.url),
    status:
      typeof parsed.status === "string" && parsed.status.trim()
        ? parsed.status.trim()
        : "processing",
  };
}

export async function requestBuilderBrowserConnection(
  args: BrowserConnectionArgs,
): Promise<Record<string, unknown>> {
  const authorization = await resolveBuilderApiAuthorization(
    "builder:browser:connect",
  );

  const sessionId = args.sessionId?.trim();
  if (!sessionId) {
    throw new Error("sessionId is required");
  }

  const url = new URL("/codegen/get-browser-connection", getBuilderApiHost());
  if (authorization.legacyPublicKey) {
    url.searchParams.set("apiKey", authorization.legacyPublicKey);
  }
  if (authorization.userId) {
    url.searchParams.set("userId", authorization.userId);
  }

  const response = await fetchBuilderApi(
    url,
    {
      method: "POST",
      headers: {
        Authorization: authorization.authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        projectId: args.projectId || undefined,
        branchName: args.branchName || undefined,
        proxyOrigin: args.proxyOrigin || undefined,
        proxyDefaultOrigin: args.proxyDefaultOrigin || undefined,
        proxyDst: args.proxyDestination || undefined,
      }),
    },
    "browser connection request",
  );

  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const error =
      typeof body.error === "string"
        ? body.error
        : `Builder browser request failed (${response.status})`;
    throw builderApiFailure(response.status, error);
  }

  return body;
}
