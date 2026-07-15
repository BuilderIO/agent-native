import {
  assertBodySize,
  defineEventHandler,
  setResponseStatus,
  setResponseHeader,
  getMethod,
  getHeader,
  getCookie,
  setCookie,
  deleteCookie,
  getRequestURL,
  getRequestIP,
  readRawBody,
} from "h3";
import type { H3Event } from "h3";
import { readMultipartFormData } from "h3";

import { DEFAULT_MODEL } from "../agent/default-model.js";
import { registerBuiltinEngines } from "../agent/engine/builtin.js";
import {
  OPENAI_BASE_URL_ENV_VAR,
  PROVIDER_ENV_META,
} from "../agent/engine/provider-env-vars.js";
import {
  isAgentEngineSettingConfigured,
  getAgentEngineEntry,
  detectEngineFromEnv,
  detectEngineFromUserSecrets,
  isStoredEngineUsableForRequest,
  normalizeModelForEngine,
} from "../agent/engine/registry.js";
import {
  canUpdateAgentLoopSettings,
  readAgentLoopSettings,
  resetAgentLoopSettings,
  validateMaxIterationsInput,
  writeAgentLoopSettings,
} from "../agent/loop-settings.js";
import {
  getState,
  putState,
  deleteState,
  listComposeDrafts,
  getComposeDraft,
  putComposeDraft,
  deleteComposeDraft,
  deleteAllComposeDrafts,
} from "../application-state/handlers.js";
import { mountBrowserSessionRoutes } from "../browser-sessions/routes.js";
import { mountDbAdminRoutes } from "../db-admin/routes.js";
import { getDbExec } from "../db/client.js";
import {
  getDatabaseRuntimeFingerprint,
  getRuntimeDebugFingerprint,
  runDatabaseSchemaHealthCheck,
  type DatabaseSchemaHealthResult,
} from "../db/runtime-diagnostics.js";
import { ssrfSafeFetch } from "../extensions/url-safety.js";
import {
  uploadFile,
  getActiveFileUploadProviderForRequest,
  listFileUploadProviders,
} from "../file-upload/index.js";
import { handleMcpConnect } from "../mcp/connect-route.js";
import {
  handleMcpOAuth,
  handleMcpOAuthAuthorizationServerMetadata,
  handleMcpOAuthProtectedResourceMetadata,
} from "../mcp/oauth-route.js";
import { MCP_ROUTE_PREFIXES } from "../mcp/route-paths.js";
import { registerBuiltinNotificationChannels } from "../notifications/channels.js";
import { createNotificationsHandler } from "../notifications/routes.js";
import { getOrgContext } from "../org/context.js";
import { createProgressHandler } from "../progress/routes.js";
import { registerFrameworkSecrets } from "../secrets/register-framework-secrets.js";
import {
  createListSecretsHandler,
  createWriteSecretHandler,
  createTestSecretHandler,
  createAdHocSecretHandler,
} from "../secrets/routes.js";
import { getSetting, putSetting, deleteSetting } from "../settings/store.js";
import {
  getUserSetting,
  putUserSetting,
  deleteUserSetting,
} from "../settings/user-settings.js";
import {
  DEFAULT_SSR_CACHE_HEADERS,
  EMPTY_SPECULATION_RULES,
} from "../shared/cache-control.js";
import { EMBED_TARGET_HEADER } from "../shared/embed-auth.js";
import { llmConnectionTrackingProperties } from "../shared/llm-connection.js";
import {
  EMBED_TRANSPLANT_HEADER,
  isMcpEmbedCorsOrigin,
  MCP_EMBED_CORS_ALLOW_HEADERS,
  shouldAllowMcpEmbedCredentials,
} from "../shared/mcp-embed-headers.js";
import { track } from "../tracking/index.js";
import { registerBuiltinProviders } from "../tracking/providers.js";
import { validateTrackPayload } from "../tracking/route.js";
import { createAutomationsHandler } from "../triggers/routes.js";
import { createAgentEngineApiKeyHandler } from "./agent-engine-api-key-route.js";
import { getConfiguredAppBasePath, stripAppBasePath } from "./app-base-path.js";
import { getAppName } from "./app-name.js";
import { getSession, type AuthSession } from "./auth.js";
import {
  BUILDER_CONNECT_PARAM,
  BUILDER_CONNECT_OWNER_COOKIE,
  BUILDER_ENV_KEYS,
  BUILDER_OPENER_PARAM,
  BUILDER_RELAY_FLOW_HEADER,
  BUILDER_RELAY_SIGNATURE_HEADER,
  BUILDER_RELAY_STATE_PARAM,
  BUILDER_RELAY_TIMESTAMP_HEADER,
  BUILDER_STATE_PARAM,
  appendBuilderConnectToken,
  builderConnectTrackingProperties,
  buildBuilderCliAuthUrl,
  createBuilderBrowserCallbackErrorPage,
  createBuilderBrowserCallbackPage,
  createBuilderRelayRequest,
  getBuilderConnectTrackingParams,
  getBuilderCliAuthCallbackOriginForEvent,
  getBuilderBrowserOriginForEvent,
  resolveBuilderCallbackReturnUrl,
  getBuilderBrowserStatusForEvent,
  resolveBuilderBranchProjectId,
  resolveSafePreviewUrl,
  runBuilderAgent,
  signBuilderCallbackState,
  signBuilderPreviewRelayState,
  verifyBuilderRelayRequest,
  verifyBuilderPreviewRelayStateForCallback,
  verifyBuilderConnectTokenAndGetOwner,
  verifyBuilderCallbackStateAndGetOwner,
  signBuilderConnectToken,
  type BuilderConnectTrackingParams,
  type BuilderRelayCredentials,
  type BuilderPreviewRelayState,
} from "./builder-browser.js";
import { captureError } from "./capture-error.js";
import {
  getAllowedCorsOrigin,
  readCorsAllowedOrigins,
} from "./cors-origins.js";
import type { EnvKeyConfig } from "./create-server.js";
import {
  canUseDeployCredentialFallbackForRequest,
  readDeployCredentialEnv,
  resolveSecret,
} from "./credential-provider.js";
import { createEmbedStartRouteHandler } from "./embed-route.js";
import {
  getH3App,
  awaitBootstrap,
  markDefaultPluginProvided,
  trackPluginInit,
} from "./framework-request-handler.js";
import { getAppBasePath, getOrigin } from "./google-oauth.js";
import { createGoogleRealtimeSessionHandler } from "./google-realtime-session.js";
import {
  readBody,
  DEFAULT_UPLOAD_MAX_FILE_BYTES,
  isAllowedUploadMimeType,
} from "./h3-helpers.js";
import { createHttpResponseTelemetryMiddleware } from "./http-response-telemetry.js";
import { isIdentitySsoEnabled } from "./identity-sso-store.js";
import { handleIdentitySso } from "./identity-sso.js";
import { createOpenRouteHandler } from "./open-route.js";
import { createPollEventsHandler } from "./poll-events.js";
import { createPollHandler } from "./poll.js";
import { runWithRequestContext } from "./request-context.js";
import {
  findUnsupportedScopedKeyNames,
  saveKeyValuesToScopedSecrets,
  ScopedKeyStorageError,
  type ScopedKeySaveRequestScope,
} from "./scoped-key-storage.js";
import { createTranscribeVoiceHandler } from "./transcribe-voice.js";
import { createVoiceProvidersStatusHandler } from "./voice-providers-status.js";

/**
 * The base path prefix for all framework-level routes.
 * All agent-native core routes live under this namespace to avoid
 * collisions with template-specific `/api/*` routes.
 */
export const FRAMEWORK_ROUTE_PREFIX = "/_agent-native";
export const FRAMEWORK_EVENTS_ROUTE = `${FRAMEWORK_ROUTE_PREFIX}/events`;
export const LEGACY_FRAMEWORK_EVENTS_ROUTE = `${FRAMEWORK_ROUTE_PREFIX}/poll-events`;

export function normalizeAgentEngineStatusModel(
  entry:
    | { name: string; defaultModel: string; supportedModels: readonly string[] }
    | undefined,
  model: string | null | undefined,
): string {
  if (!entry) return model ?? DEFAULT_MODEL;
  return normalizeModelForEngine(entry, model ?? entry.defaultModel);
}

export function getFrameworkEnvKeys(): EnvKeyConfig[] {
  return [
    { key: "ENABLE_BUILDER", label: "Enable Builder.io features" },
    {
      key: "AGENT_ENGINE_PREFER_BYO_KEY",
      label:
        "Prefer BYO LLM key over Builder gateway (default: false — gateway wins)",
    },
    {
      key: "RESEND_API_KEY",
      label: "Resend API key",
      helpText:
        "Enables transactional email, including password resets, invitations, share notifications, and dashboard reports.",
    },
    {
      key: "SENDGRID_API_KEY",
      label: "SendGrid API key",
      helpText:
        "Enables transactional email, including password resets, invitations, share notifications, and dashboard reports.",
    },
    {
      key: "EMAIL_FROM",
      label: "Email from address",
      helpText:
        "Sender address for transactional email. Required when using SendGrid.",
    },
    ...Object.values(PROVIDER_ENV_META).map(({ envVar, label }) => ({
      key: envVar,
      label,
    })),
  ];
}

/** Result of the `/_agent-native/health` liveness + DB-warmup probe. */
export interface DbHealthProbeResult {
  /** The serverless function is live and served the request. */
  ok: true;
  /** Database + optional schema readiness for stricter production monitors. */
  ready: boolean;
  /** A trivial `SELECT 1` reached the database (false = no DB or unreachable). */
  db: boolean;
  /** Round-trip time of the probe in milliseconds. */
  ms: number;
  /** Redacted database routing details useful for deploy/runtime checks. */
  database: {
    configured: boolean;
    source: string;
    dialect: string;
    urlHash?: string;
    appName?: string;
    authTokenConfigured: boolean;
    netlifyDatabaseUrlConfigured: boolean;
  };
  /** Optional metadata-only schema compatibility check. */
  schema?: DatabaseSchemaHealthResult;
}

/**
 * Run a trivial `SELECT 1` to confirm the database is reachable and, as a side
 * effect, keep a scale-to-zero serverless database (e.g. Neon) warm. Touching
 * the DB on a schedule prevents the multi-second cold-start that otherwise
 * stalls the next real user request.
 *
 * Always resolves: an app with no database (or a momentarily unreachable one)
 * is still live, so the probe reports `db: false` rather than throwing. The
 * `exec` parameter is injectable purely for tests.
 */
export async function runDbHealthProbe(
  exec: () => { execute: (sql: string) => Promise<unknown> } = getDbExec,
  options: { schema?: boolean } = {},
): Promise<DbHealthProbeResult> {
  const startedAt = Date.now();
  let db = false;
  let schema: DatabaseSchemaHealthResult | undefined;
  const dbExec = exec();
  try {
    await dbExec.execute("SELECT 1");
    db = true;
  } catch {
    // Live even when the DB is unreachable or the app has no database.
  }
  if (db && options.schema) {
    schema = await runDatabaseSchemaHealthCheck({
      exec: dbExec as ReturnType<typeof getDbExec>,
    });
  }
  const database = getDatabaseRuntimeFingerprint();
  return {
    ok: true,
    ready: db && (!schema || schema.ok),
    db,
    ms: Date.now() - startedAt,
    database: {
      configured: database.configured,
      source: database.source,
      dialect: database.dialect,
      urlHash: database.urlHash,
      appName: database.appName,
      authTokenConfigured: database.authTokenConfigured,
      netlifyDatabaseUrlConfigured: database.netlifyDatabaseUrlConfigured,
    },
    ...(schema ? { schema } : {}),
  };
}
const DEFAULT_BUILDER_WAITLIST_FORM_ID = "DYTHuM0jlV";
const DEFAULT_BUILDER_WAITLIST_FORMS_ORIGIN = "https://forms.agent-native.com";
const BUILDER_WAITLIST_FORM_SOURCE = "connect_builder_card";
const BUILDER_WAITLIST_DEFAULT_USE_CASE = "builder_agent_background_coding";
const BUILDER_WAITLIST_USE_CASES = new Set([
  BUILDER_WAITLIST_DEFAULT_USE_CASE,
  "design_publish_app",
  "docs_build_online_waitlist",
  "docs_edit_online_waitlist",
]);
const BUILDER_WAITLIST_FORM_TIMEOUT_MS = 8000;
const BUILDER_WAITLIST_TEXT_LIMIT = 4000;
const BUILDER_WAITLIST_RATE_LIMIT_WINDOW_MS = 60_000;
const BUILDER_WAITLIST_RATE_LIMIT_MAX = 5;
const builderWaitlistRateLimitHits = new Map<
  string,
  { count: number; resetAt: number }
>();

interface BuilderWaitlistFormTarget {
  formId: string;
  formsOrigin: string;
}

export interface BuilderWaitlistBody {
  email?: unknown;
  prompt?: unknown;
  orgName?: unknown;
  appUrl?: unknown;
  pageUrl?: unknown;
  source?: unknown;
  template?: unknown;
  useCase?: unknown;
}

export function resolveFrameworkSseRoutes(sseRoute?: string): string[] {
  return Array.from(
    new Set([
      sseRoute ?? FRAMEWORK_EVENTS_ROUTE,
      FRAMEWORK_EVENTS_ROUTE,
      LEGACY_FRAMEWORK_EVENTS_ROUTE,
    ]),
  );
}

export const BUILDER_STATUS_ROUTE_SUFFIXES = [
  "/builder/status",
  "/connection-status/builder",
] as const;

export function mountBuilderStatusRouteAliases<T>(
  mount: (path: string, handler: T) => void,
  prefix: string,
  handler: T,
): void {
  for (const routeSuffix of BUILDER_STATUS_ROUTE_SUFFIXES) {
    mount(`${prefix}${routeSuffix}`, handler);
  }
}

registerBuiltinEngines();

function cleanBuilderWaitlistText(
  value: unknown,
  maxLength = BUILDER_WAITLIST_TEXT_LIMIT,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function normalizeBuilderWaitlistUseCase(value: unknown): string {
  const useCase = cleanBuilderWaitlistText(value, 100);
  return useCase && BUILDER_WAITLIST_USE_CASES.has(useCase)
    ? useCase
    : BUILDER_WAITLIST_DEFAULT_USE_CASE;
}

function normalizeBuilderWaitlistTemplate(value: unknown): string | undefined {
  const template = cleanBuilderWaitlistText(value, 100);
  return template && /^[a-z0-9][a-z0-9-]{0,99}$/.test(template)
    ? template
    : undefined;
}

function isValidWaitlistEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isAnonymousWaitlistSessionEmail(email: string): boolean {
  return email.startsWith("anon-") && email.endsWith("@agent-native.com");
}

export function resolveWaitlistEmail(
  sessionEmail: string | undefined,
  bodyEmail: unknown,
): string | null {
  const provided = cleanBuilderWaitlistText(bodyEmail, 320);
  if (provided && isValidWaitlistEmail(provided)) return provided;
  if (sessionEmail && !isAnonymousWaitlistSessionEmail(sessionEmail)) {
    return sessionEmail;
  }
  return null;
}

function normalizeWaitlistRateLimitPart(value: string): string {
  return value.trim().toLowerCase();
}

function getBuilderWaitlistClientIp(event: H3Event): string | undefined {
  const trusted =
    getHeader(event, "x-nf-client-connection-ip") ??
    getHeader(event, "cf-connecting-ip") ??
    getHeader(event, "true-client-ip") ??
    getHeader(event, "x-real-ip");
  if (trusted && trusted.trim()) return trusted.trim();

  const forwardedFor = getHeader(event, "x-forwarded-for");
  const forwardedClientIp = forwardedFor?.split(",")[0]?.trim();
  if (forwardedClientIp) return forwardedClientIp;

  try {
    return getRequestIP(event) ?? undefined;
  } catch {
    return undefined;
  }
}

function getBuilderWaitlistRateLimitKeys(
  event: H3Event,
  email: string,
): string[] {
  const clientIp = getBuilderWaitlistClientIp(event);
  return [
    `email:${normalizeWaitlistRateLimitPart(email)}`,
    `ip:${normalizeWaitlistRateLimitPart(clientIp ?? "unknown")}`,
  ];
}

export function checkBuilderWaitlistRateLimit(
  event: H3Event,
  email: string,
  now = Date.now(),
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const keys = getBuilderWaitlistRateLimitKeys(event, email);
  let retryAfterMs = 0;

  for (const key of keys) {
    const entry = builderWaitlistRateLimitHits.get(key);
    if (!entry) continue;
    if (entry.resetAt <= now) {
      builderWaitlistRateLimitHits.delete(key);
      continue;
    }
    if (entry.count >= BUILDER_WAITLIST_RATE_LIMIT_MAX) {
      retryAfterMs = Math.max(retryAfterMs, entry.resetAt - now);
    }
  }

  if (retryAfterMs > 0) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  for (const key of keys) {
    const entry = builderWaitlistRateLimitHits.get(key);
    if (!entry || entry.resetAt <= now) {
      builderWaitlistRateLimitHits.set(key, {
        count: 1,
        resetAt: now + BUILDER_WAITLIST_RATE_LIMIT_WINDOW_MS,
      });
    } else {
      entry.count += 1;
    }
  }

  return { ok: true };
}

export function resetBuilderWaitlistRateLimitForTests() {
  builderWaitlistRateLimitHits.clear();
}

function normalizeHttpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isAgentNativeHostedRequest(event: H3Event): boolean {
  const hostname = getRequestURL(event).hostname.toLowerCase();
  return (
    hostname === "agent-native.com" || hostname.endsWith(".agent-native.com")
  );
}

export function resolveBuilderWaitlistFormTargetForRequest(
  event: H3Event,
): BuilderWaitlistFormTarget | null {
  if (process.env.AGENT_NATIVE_DISABLE_BUILDER_WAITLIST_FORM === "1") {
    return null;
  }

  const envFormId = process.env.AGENT_NATIVE_BUILDER_WAITLIST_FORM_ID?.trim();
  const envFormsOrigin =
    process.env.AGENT_NATIVE_BUILDER_WAITLIST_FORMS_ORIGIN?.trim();
  const hasExplicitTarget = Boolean(envFormId || envFormsOrigin);
  if (!hasExplicitTarget && !isAgentNativeHostedRequest(event)) {
    return null;
  }

  const formId = envFormId || DEFAULT_BUILDER_WAITLIST_FORM_ID;
  const formsOrigin = normalizeHttpOrigin(
    envFormsOrigin || DEFAULT_BUILDER_WAITLIST_FORMS_ORIGIN,
  );
  if (!formsOrigin) {
    throw new Error("Invalid Builder waitlist Forms origin");
  }

  return { formId, formsOrigin };
}

export function buildBuilderWaitlistFormPayload(
  event: H3Event,
  sessionEmail: string,
  body: BuilderWaitlistBody,
) {
  const appUrl =
    cleanBuilderWaitlistText(body.pageUrl ?? body.appUrl, 2000) ??
    cleanBuilderWaitlistText(getHeader(event, "referer"), 2000) ??
    getOrigin(event);
  const source =
    cleanBuilderWaitlistText(body.source, 100) ?? BUILDER_WAITLIST_FORM_SOURCE;
  const template = normalizeBuilderWaitlistTemplate(body.template);
  const useCase = normalizeBuilderWaitlistUseCase(body.useCase);

  return {
    data: {
      email: sessionEmail,
      orgName: cleanBuilderWaitlistText(body.orgName, 500),
      appUrl,
      prompt: cleanBuilderWaitlistText(body.prompt),
      source,
      template,
      useCase,
    },
    _hp: "",
    _meta: {
      submitterEmail: sessionEmail,
      pageUrl: appUrl,
      source,
      template,
      useCase,
    },
  };
}

async function submitBuilderWaitlistForm(
  event: H3Event,
  sessionEmail: string,
  body: BuilderWaitlistBody,
): Promise<{ submitted: boolean; formId?: string }> {
  const target = resolveBuilderWaitlistFormTargetForRequest(event);
  if (!target) return { submitted: false };

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    BUILDER_WAITLIST_FORM_TIMEOUT_MS,
  );

  try {
    const res = await fetch(
      `${target.formsOrigin}/api/submit/${encodeURIComponent(target.formId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildBuilderWaitlistFormPayload(event, sessionEmail, body),
        ),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      throw new Error(`Forms waitlist submission failed (${res.status})`);
    }
    return { submitted: true, formId: target.formId };
  } finally {
    clearTimeout(timeout);
  }
}

function parseBuilderCallbackBoolean(
  value: string | null | undefined,
): boolean | null {
  if (value == null || value === "") return null;
  return /^(1|true)$/i.test(value);
}

// Raster-only data-URI allowlist for avatar writes. SVG is deliberately absent:
// data:image/svg+xml payloads can carry inline <script> and event-handler
// attributes that execute when the browser renders them as an <img> src or
// inlines them in the DOM. Mirrors SAFE_DATA_IMAGE in sanitize-html.ts.
export const AVATAR_RASTER_MIME = /^data:image\/(png|jpe?g|gif|webp);/i;

export function resolveAvatarEmailParam(
  pathname: string,
  appBasePath = "",
): string {
  const base = appBasePath.replace(/\/+$/, "");
  const avatarPaths = Array.from(
    new Set([`${base}/_agent-native/avatar/`, "/_agent-native/avatar/"]),
  );

  for (const avatarPath of avatarPaths) {
    const avatarIndex = pathname.indexOf(avatarPath);
    if (avatarIndex >= 0) {
      return pathname
        .slice(avatarIndex + avatarPath.length)
        .replace(/^\/+/, "")
        .split("/")[0];
    }
  }

  const firstSegment = pathname.replace(/^\/+/, "").split("/")[0] ?? "";
  if (!firstSegment || firstSegment === "_agent-native") return "";
  if (base && firstSegment === base.replace(/^\/+/, "")) return "";
  return firstSegment;
}

async function detectUsageEngineName(
  event: H3Event,
  userEmail: string | undefined,
): Promise<string | null> {
  try {
    const stored = (await getSetting("agent-engine")) as {
      engine?: string;
    } | null;
    if (isAgentEngineSettingConfigured(stored)) {
      return (stored as { engine: string }).engine;
    }
    let orgId: string | undefined;
    if (userEmail) {
      try {
        const orgCtx = await getOrgContext(event);
        orgId = orgCtx.orgId ?? undefined;
      } catch {
        /* org module not present in this template */
      }
    }
    const envEntry = process.env.AGENT_ENGINE
      ? getAgentEngineEntry(process.env.AGENT_ENGINE)
      : undefined;
    if (envEntry) {
      return (await runWithRequestContext({ userEmail, orgId }, () =>
        isStoredEngineUsableForRequest({ engine: envEntry.name }, envEntry),
      ))
        ? envEntry.name
        : null;
    }

    const detectedFromUser = await runWithRequestContext(
      { userEmail, orgId },
      () => detectEngineFromUserSecrets(),
    );
    if (stored && typeof stored.engine === "string") {
      const entry = getAgentEngineEntry(stored.engine);
      if (
        entry &&
        (await runWithRequestContext({ userEmail, orgId }, () =>
          isStoredEngineUsableForRequest(stored, entry),
        ))
      ) {
        return stored.engine;
      }
    }
    if (detectedFromUser?.name === "builder") return detectedFromUser.name;
    if (detectedFromUser) return detectedFromUser.name;

    return await runWithRequestContext(
      { userEmail, orgId },
      () => detectEngineFromEnv()?.name ?? null,
    );
  } catch {
    return null;
  }
}

async function trackBuilderLifecycle(
  event: H3Event,
  name: string,
  userEmail: string | undefined | null,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (!userEmail) return;
  const engine = await detectUsageEngineName(event, userEmail);
  track(
    name,
    {
      feature: "builder",
      ...llmConnectionTrackingProperties({
        configured: Boolean(engine),
        engine,
      }),
      ...properties,
    },
    { userId: userEmail },
  );
}

function getBuilderConnectOwnerCookiePath(): string {
  return getAppBasePath() || "/";
}

function readBuilderConnectOwnerCookie(event: H3Event): string | null {
  return verifyBuilderConnectTokenAndGetOwner(
    getCookie(event, BUILDER_CONNECT_OWNER_COOKIE),
  );
}

function setBuilderConnectOwnerCookie(
  event: H3Event,
  ownerEmail: string,
): void {
  setCookie(
    event,
    BUILDER_CONNECT_OWNER_COOKIE,
    signBuilderConnectToken(ownerEmail),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: getOrigin(event).startsWith("https://"),
      path: getBuilderConnectOwnerCookiePath(),
      maxAge: 10 * 60,
    },
  );
}

function clearBuilderConnectOwnerCookie(event: H3Event): void {
  deleteCookie(event, BUILDER_CONNECT_OWNER_COOKIE, {
    path: getBuilderConnectOwnerCookiePath(),
  });
}

function isAgentNativeAnonymousOwner(email: string | undefined): boolean {
  return /^anon-[^@]+@agent-native\.com$/i.test(email ?? "");
}

type BuilderAnonymousOwnerResolver = (
  event: H3Event,
) => string | null | Promise<string | null>;

export type BuilderOwnerContext = {
  email: string | undefined;
  session: AuthSession | null;
  anonymous: boolean;
};

export async function resolveBuilderOwnerContextForRequest(
  event: H3Event,
  options: {
    anonymousOwner?: BuilderAnonymousOwnerResolver;
    getSessionForEvent?: (event: H3Event) => Promise<AuthSession | null>;
  } = {},
  mode?: "connect" | "callback",
): Promise<BuilderOwnerContext> {
  const searchParams = getRequestURL(event).searchParams;
  const signedOwner =
    mode === "connect"
      ? verifyBuilderConnectTokenAndGetOwner(
          searchParams.get(BUILDER_CONNECT_PARAM),
        )
      : mode === "callback"
        ? verifyBuilderCallbackStateAndGetOwner(
            searchParams.get(BUILDER_STATE_PARAM),
          )
        : null;
  const cookieOwner =
    mode === "callback" ? readBuilderConnectOwnerCookie(event) : null;
  const session = await (options.getSessionForEvent ?? getSession)(event).catch(
    () => null,
  );
  if (session?.email) {
    if (
      signedOwner &&
      (signedOwner === session.email ||
        (isAgentNativeAnonymousOwner(signedOwner) &&
          isAgentNativeAnonymousOwner(session.email)))
    ) {
      // Public docs/app surfaces can mint a new anonymous session inside the
      // popup when cookies do not round-trip. Keep the signed flow owner in
      // that anonymous-only case, but do not override a real user session.
      return {
        email: signedOwner,
        session: signedOwner === session.email ? session : null,
        anonymous: isAgentNativeAnonymousOwner(signedOwner),
      };
    }
    return { email: session.email, session, anonymous: false };
  }

  if (signedOwner) {
    return {
      email: signedOwner,
      session: null,
      anonymous: isAgentNativeAnonymousOwner(signedOwner),
    };
  }

  if (cookieOwner) {
    return { email: cookieOwner, session: null, anonymous: false };
  }

  const anonymousOwner = await options.anonymousOwner?.(event);
  if (anonymousOwner) {
    return { email: anonymousOwner, session: null, anonymous: true };
  }

  return { email: undefined, session: null, anonymous: false };
}

/**
 * Resolves the page-level legacy `/tools` → `/extensions` redirect target.
 *
 * Returns the absolute path (with optional query string) to redirect to,
 * or `null` if the request should fall through to the SPA / next handler.
 *
 * Skips:
 *   - Framework API namespace (`/_agent-native/tools/*` is handled separately
 *     as a legacy alias and intentionally stays mounted as `tools`).
 *   - Anything that isn't `/tools` or a `/tools/...` page navigation, after
 *     the configured app base path is stripped off.
 *
 * Exported for tests; the runtime middleware below is a thin wrapper.
 */
export function resolveLegacyToolsRedirect(
  rawPath: string,
  search: string,
): string | null {
  if (rawPath === "/_agent-native" || rawPath.startsWith("/_agent-native/")) {
    return null;
  }
  const pathname = stripAppBasePath(rawPath);
  if (pathname !== "/tools" && !pathname.startsWith("/tools/")) return null;
  const suffix = pathname === "/tools" ? "" : pathname.slice("/tools".length);
  const basePath = getConfiguredAppBasePath();
  return `${basePath}/extensions${suffix}${search}`;
}

export function getFrameworkRouteRequestUrl(event: H3Event): URL {
  const url = getRequestURL(event);
  if (url.search) return url;

  // In some mounted Nitro/H3 paths, `event.url` is normalized while the raw
  // Node request URL still has the query string. Builder callbacks carry the
  // signed `_an_state` there, so preserve it before validating the flow.
  const rawUrl =
    event.node?.req?.url ??
    (typeof event.path === "string" ? event.path : undefined);
  const queryStart = rawUrl?.indexOf("?") ?? -1;
  if (queryStart < 0) return url;
  url.search = rawUrl!.slice(queryStart);
  return url;
}

export interface BuilderRelayPendingRecord {
  ownerEmail: string;
  orgId: string | null;
  role: string | null;
  targetOrigin: string;
  basePath: string;
  expiresAt: number;
  tracking?: BuilderConnectTrackingParams;
}

export interface ConsumeBuilderRelayDependencies {
  getPending: (key: string) => Promise<Record<string, unknown> | null>;
  deletePending: (key: string) => Promise<boolean>;
  writeCredentials: (
    ownerEmail: string,
    credentials: BuilderRelayCredentials,
    scope: { orgId: string | null; role: string | null },
  ) => Promise<unknown>;
}

function builderRelayPendingKey(flowId: string): string {
  return `builder-pending-relay:${flowId}`;
}

function parseBuilderRelayPendingRecord(
  value: Record<string, unknown> | null,
): BuilderRelayPendingRecord | null {
  if (
    !value ||
    typeof value.ownerEmail !== "string" ||
    typeof value.targetOrigin !== "string" ||
    typeof value.basePath !== "string" ||
    typeof value.expiresAt !== "number"
  ) {
    return null;
  }
  return {
    ownerEmail: value.ownerEmail,
    orgId: typeof value.orgId === "string" ? value.orgId : null,
    role: typeof value.role === "string" ? value.role : null,
    targetOrigin: value.targetOrigin,
    basePath: value.basePath,
    expiresAt: value.expiresAt,
    tracking:
      value.tracking && typeof value.tracking === "object"
        ? (value.tracking as BuilderConnectTrackingParams)
        : undefined,
  };
}

/**
 * Authenticated one-shot receiver for the second hop of Builder preview auth.
 * Owner and org scope always come from the preview's pending record; the
 * corporate callback cannot choose them in its POST body.
 */
export async function consumeBuilderRelayRequest(
  input: {
    rawBody: string;
    timestamp: string | null | undefined;
    flowId: string | null | undefined;
    signature: string | null | undefined;
    requestOrigin: string;
    requestBasePath: string;
    now?: number;
  },
  dependencies: ConsumeBuilderRelayDependencies,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (input.rawBody.length > 64 * 1024) {
    return {
      ok: false,
      status: 413,
      error: "Builder relay request is too large",
    };
  }
  let verified: ReturnType<typeof verifyBuilderRelayRequest>;
  try {
    verified = verifyBuilderRelayRequest({
      body: input.rawBody,
      timestamp: input.timestamp,
      flowId: input.flowId,
      signature: input.signature,
      requestOrigin: input.requestOrigin,
      requestBasePath: input.requestBasePath,
      now: input.now,
    });
  } catch {
    return { ok: false, status: 503, error: "Builder relay is not configured" };
  }
  if (!verified) {
    return { ok: false, status: 401, error: "Invalid Builder relay request" };
  }
  const pendingKey = builderRelayPendingKey(verified.payload.flowId);
  const pending = parseBuilderRelayPendingRecord(
    await dependencies.getPending(pendingKey).catch(() => null),
  );
  const now = input.now ?? Date.now();
  if (
    !pending ||
    pending.expiresAt < now ||
    pending.ownerEmail !== verified.payload.ownerEmail ||
    pending.targetOrigin !== verified.payload.targetOrigin ||
    pending.basePath !== verified.payload.basePath
  ) {
    return { ok: false, status: 403, error: "No active Builder relay flow" };
  }

  // A successful delete, not merely a resolved promise, is the one-shot gate.
  // It happens before credential persistence so replay is impossible even if
  // the downstream write fails and the human has to start a fresh flow.
  const consumed = await dependencies
    .deletePending(pendingKey)
    .catch(() => false);
  if (consumed !== true) {
    return {
      ok: false,
      status: 409,
      error: "Builder relay flow was already consumed",
    };
  }

  await dependencies.writeCredentials(
    pending.ownerEmail,
    verified.body.credentials,
    { orgId: pending.orgId, role: pending.role },
  );
  return { ok: true };
}

export async function readBuilderRelayRequestBody(
  event: H3Event,
): Promise<string> {
  await assertBodySize(event, 64 * 1024);
  return (await readRawBody(event, "utf8")) ?? "";
}

function redactValues(text: string, values: Array<string | null | undefined>) {
  let out = text;
  for (const value of values) {
    if (value) out = out.split(value).join("[redacted]");
  }
  return out;
}

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export interface CoreRoutesPluginOptions {
  /** Route path for the SSE endpoint. Default: "/_agent-native/events" */
  sseRoute?: string;
  /** Disable the SSE endpoint entirely. */
  disableSSE?: boolean;
  /** Disable the /_agent-native/ping health check. */
  disablePing?: boolean;
  /** Disable the /_agent-native/health DB liveness + warmup probe. */
  disableHealth?: boolean;
  /** Disable the /_agent-native/application-state routes. */
  disableAppState?: boolean;
  /** Disable the /_agent-native/open deep-link route. */
  disableOpenRoute?: boolean;
  /** Disable the /_agent-native/embed/start iframe session launcher. */
  disableEmbedRoute?: boolean;
  /**
   * Disable the /mcp/connect routes (browser Connect page + CLI device-code
   * flow that mints per-user, revocable MCP tokens) and the standard remote-MCP
   * OAuth endpoints under /mcp/oauth. The legacy /_agent-native/mcp aliases
   * are disabled at the same time.
   * Enabled by default — the routes are session-gated where they approve user
   * access; token endpoints are protected by single-use codes / refresh
   * tokens.
   */
  disableMcpConnect?: boolean;
  /** Canonical app id (e.g. `mail`) for the MCP connect server name. */
  mcpConnectAppId?: string;
  /** Explicit MCP server id for copyable config/device-flow grants. */
  mcpConnectServerName?: string;
  /** Human app name shown on the MCP connect page. */
  mcpConnectAppName?: string;
  /** Per-template override mapping deep-link params → client SPA path.
   *  See `createOpenRouteHandler`. */
  resolveOpenPath?: import("./open-route.js").OpenRouteOptions["resolveOpenPath"];
  /** Per-template allowlist for open-route targets that may redirect without
   *  a browser session. See `createOpenRouteHandler`. */
  allowUnauthenticatedOpen?: import("./open-route.js").OpenRouteOptions["allowUnauthenticatedOpen"];
  /** Env key configuration. Enables env-status and env-vars routes. */
  envKeys?: EnvKeyConfig[];
  /**
   * Optional owner resolver for narrowly-scoped public routes. Used by public
   * pages that let anonymous viewers connect Builder credentials for their
   * own browser-scoped agent session.
   */
  anonymousOwner?: BuilderAnonymousOwnerResolver;
}

/**
 * Creates a Nitro plugin that mounts all standard agent-native framework routes.
 *
 * All routes are mounted under `/_agent-native/` to avoid collisions
 * with template-specific routes.
 *
 * Routes:
 *   GET    /_agent-native/poll                          — polling endpoint for change detection
 *   GET    /_agent-native/events (or custom)            — SSE endpoint for real-time sync
 *   GET    /_agent-native/ping                          — health check
 *   GET    /_agent-native/health                        — DB liveness probe + scale-to-zero warmup
 *   GET    /_agent-native/env-status                    — env key configuration status (when envKeys provided)
 *   POST   /_agent-native/env-vars                      — compatibility route that saves keys to scoped DB secrets
 *   GET    /_agent-native/application-state/:key        — read application state
 *   PUT    /_agent-native/application-state/:key        — write application state
 *   DELETE /_agent-native/application-state/:key        — delete application state
 *   GET    /_agent-native/application-state/compose     — list compose drafts
 *   DELETE /_agent-native/application-state/compose     — delete all compose drafts
 *   GET    /_agent-native/application-state/compose/:id — get compose draft
 *   PUT    /_agent-native/application-state/compose/:id — upsert compose draft
 *   DELETE /_agent-native/application-state/compose/:id — delete compose draft
 */
export function createCoreRoutesPlugin(
  options: CoreRoutesPluginOptions = {},
): NitroPluginDef {
  return async (nitroApp: any) => {
    markDefaultPluginProvided(nitroApp, "core-routes");
    // No-op when called from inside the bootstrap (auto-mount path).
    // Otherwise wait so other default plugins finish mounting first.
    let resolveInit: () => void = () => {};
    let rejectInit: (error: unknown) => void = () => {};
    const initPromise = new Promise<void>((resolve, reject) => {
      resolveInit = resolve;
      rejectInit = reject;
    });
    trackPluginInit(nitroApp, initPromise, {
      paths: [FRAMEWORK_ROUTE_PREFIX, "/mcp", "/.well-known"],
    });
    try {
      await awaitBootstrap(nitroApp);

      // Legacy cleanup: key saves now go to scoped app_secrets rows. Do not
      // rehydrate the old deployment-global `persisted-env-vars` row into
      // process.env; keep only the Builder scrub so stale leaked keys self-heal.
      try {
        const persisted = (await getSetting("persisted-env-vars")) as Record<
          string,
          string
        > | null;
        if (persisted) {
          const builderKeys = new Set<string>(BUILDER_ENV_KEYS);
          let scrubbed = 0;
          for (const k of Object.keys(persisted)) {
            if (builderKeys.has(k)) {
              scrubbed++;
            }
          }
          if (scrubbed > 0) {
            try {
              const cleaned: Record<string, string> = {};
              for (const [k, v] of Object.entries(persisted)) {
                if (!builderKeys.has(k)) cleaned[k] = v;
              }
              await putSetting("persisted-env-vars", cleaned);
              console.warn(
                `[core] Removed ${scrubbed} legacy BUILDER_* key(s) from persisted-env-vars (cross-tenant leak fix).`,
              );
            } catch {
              // Couldn't rewrite the row — the skip-on-rehydrate above
              // is the load-bearing protection. We'll try again next boot.
            }
          }
        }
      } catch {
        // DB not ready yet — skip
      }

      // Honor Builder disconnect. Nitro's dev env-runner preserves
      // `process.env` across `.env` file reloads inside the same worker, so
      // deleting BUILDER_PRIVATE_KEY in the disconnect handler can bleed
      // back through an env-runner restart. We persist a
      // `builder-disconnected` flag in SQL and scrub BUILDER_* on every
      // plugin init while the flag is set. The flag is cleared by the
      // Builder cli-auth callback when the user re-connects.
      try {
        const disconnected = (await getSetting("builder-disconnected")) as {
          at?: number;
        } | null;
        if (disconnected) {
          for (const key of BUILDER_ENV_KEYS) {
            delete process.env[key];
          }
        }
      } catch {
        // DB not ready — skip; the disconnect flag will be enforced on the
        // next plugin boot once the settings table is reachable.
      }

      // Register framework-level secrets (OPENAI_API_KEY for composer voice
      // transcription, etc.). Each registration is guarded so templates that
      // already registered the same key win.
      registerFrameworkSecrets();
      registerBuiltinProviders();
      registerBuiltinNotificationChannels();

      try {
        const { createObservabilityHandler } =
          await import("../observability/routes.js");
        const { ensureObservabilityTables } =
          await import("../observability/store.js");
        ensureObservabilityTables().catch(() => {});
        getH3App(nitroApp).use(
          `${FRAMEWORK_ROUTE_PREFIX}/observability`,
          createObservabilityHandler(),
        );
      } catch {
        // Observability module not available — skip
      }

      // Audit log — durable, append-only record of who mutated what app data,
      // when, and (for the agent) in which run. Capture is automatic at the
      // action seam; here we just ensure the table exists and start the
      // retention purge. Best-effort so a missing DB never crashes boot.
      try {
        const { ensureAuditTables } = await import("../audit/store.js");
        const { startAuditCleanupJob } =
          await import("../audit/cleanup-job.js");
        ensureAuditTables().catch(() => {});
        startAuditCleanupJob();
      } catch {
        // Audit module not available — skip
      }

      const P = FRAMEWORK_ROUTE_PREFIX;

      getH3App(nitroApp).use(createHttpResponseTelemetryMiddleware());

      // Security response headers — emitted on every framework response.
      // Mounted before route handlers so 4xx/5xx error pages also carry the
      // headers. Routes that need to tighten a specific header override via
      // setResponseHeader.
      const { createSecurityHeadersMiddleware } =
        await import("./security-headers.js");
      getH3App(nitroApp).use(createSecurityHeadersMiddleware());

      // CORS for framework routes. Desktop tray apps (Tauri/Electron) run on
      // their own dev origin (e.g. localhost:1420) and make credentialed
      // requests against the template's server at a different port. We echo
      // the exact origin + Allow-Credentials so same-site localhost ports
      // can cross-send cookies.
      const allowlist = readCorsAllowedOrigins();
      getH3App(nitroApp).use(
        defineEventHandler((event) => {
          const pathname = stripAppBasePath(
            event.url?.pathname ??
              String(event.node?.req?.url ?? event.path ?? "/").split("?")[0],
          );
          if (!pathname.startsWith(P) && !pathname.startsWith("/api/")) return;
          const readRequestHeader = (name: string): string | undefined => {
            const lower = name.toLowerCase();
            const raw =
              (event as any).node?.req?.headers?.[lower] ??
              (event as any).node?.req?.headers?.[name];
            if (Array.isArray(raw)) return raw[0];
            if (typeof raw === "string") return raw;
            return getHeader(event, name) ?? undefined;
          };
          const origin = readRequestHeader("origin");
          const method = getMethod(event);
          const requestedHeaders = readRequestHeader(
            "access-control-request-headers",
          );
          const requestedHeaderNames = String(requestedHeaders ?? "")
            .toLowerCase()
            .split(",")
            .map((header) => header.trim());
          const mcpEmbedCorsRequest =
            isMcpEmbedCorsOrigin(origin) &&
            (requestedHeaderNames.includes(EMBED_TARGET_HEADER.toLowerCase()) ||
              requestedHeaderNames.includes(EMBED_TRANSPLANT_HEADER) ||
              Boolean(readRequestHeader(EMBED_TARGET_HEADER)) ||
              Boolean(readRequestHeader(EMBED_TRANSPLANT_HEADER)) ||
              Boolean(readRequestHeader("authorization")));

          // Decide whether this origin is allowed. We never fall back to the
          // first allowlist entry — that previously echoed `Access-Control-
          // Allow-Origin: <unrelated-allowed-origin>` for disallowed callers,
          // which is permissive enough that some clients followed through.
          const allowedOrigin = mcpEmbedCorsRequest
            ? origin
            : getAllowedCorsOrigin(origin, {
                allowedOrigins: allowlist,
                allowAnyOriginWhenNoAllowlist: false,
                allowLocalhostWhenNoAllowlist: true,
              });

          // Reject preflights from disallowed cross-origin callers BEFORE
          // returning 204. Previously the OPTIONS short-circuit returned 204
          // with no ACAO header, which the browser then treats as a CORS
          // failure — but also short-circuited any further checks. Now we
          // explicitly 403 disallowed cross-origin preflights.
          if (method === "OPTIONS") {
            if (origin && !allowedOrigin) {
              setResponseStatus(event, 403);
              return "";
            }
            if (allowedOrigin) {
              setResponseHeader(
                event,
                "Access-Control-Allow-Origin",
                allowedOrigin,
              );
              setResponseHeader(event, "Vary", "Origin");
              if (shouldAllowMcpEmbedCredentials(allowedOrigin)) {
                setResponseHeader(
                  event,
                  "Access-Control-Allow-Credentials",
                  "true",
                );
              }
              setResponseHeader(
                event,
                "Access-Control-Allow-Methods",
                "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
              );
              setResponseHeader(
                event,
                "Access-Control-Allow-Headers",
                MCP_EMBED_CORS_ALLOW_HEADERS,
              );
            }
            setResponseStatus(event, 204);
            return "";
          }

          // Non-preflight requests: only set CORS response headers when we
          // have an allowed origin. Same-origin / no-origin requests fall
          // through without explicit CORS headers (browser treats them as
          // same-origin by default).
          if (!allowedOrigin) return;
          setResponseHeader(
            event,
            "Access-Control-Allow-Origin",
            allowedOrigin,
          );
          setResponseHeader(event, "Vary", "Origin");
          if (shouldAllowMcpEmbedCredentials(allowedOrigin)) {
            setResponseHeader(
              event,
              "Access-Control-Allow-Credentials",
              "true",
            );
          }
          setResponseHeader(
            event,
            "Access-Control-Allow-Methods",
            "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
          );
          setResponseHeader(
            event,
            "Access-Control-Allow-Headers",
            MCP_EMBED_CORS_ALLOW_HEADERS,
          );
        }),
      );

      // Defense-in-depth CSRF check for state-changing /_agent-native/* routes
      // (see `csrf.ts` for the threat model and allowlist) is registered by
      // `getH3App()` itself (framework-request-handler.ts), synchronously, on
      // the very first call to `getH3App(nitroApp)` for this process — NOT
      // here. Registering it inside this plugin's own async init chain would
      // race against agent-chat-plugin's action-route registration (a
      // SEPARATE, independently-async-initialized Nitro plugin file in real
      // deployments): whichever plugin's `getH3App(nitroApp).use(...)` call
      // happened to resolve first would win the position in the middleware
      // array, and CSRF losing that race would let an action route match and
      // run before the CSRF check ever saw the request. Centralizing the
      // registration in `getH3App()`'s one-time bootstrap makes it the first
      // middleware any plugin's route can possibly land behind, regardless of
      // plugin init ordering.

      // Agent discovery primitive — shared by headless CLI/A2A surfaces and
      // UI shells that need to show connected peer apps without depending on
      // the chat route namespace.
      getH3App(nitroApp).use(
        `${P}/agents`,
        defineEventHandler(async (event) => {
          const method = getMethod(event);
          if (method !== "GET") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          const query = getRequestURL(event).searchParams;
          const selfAppId = query.get("selfAppId") ?? undefined;
          const { discoverAgents } = await import("./agent-discovery.js");
          const agents = await discoverAgents(selfAppId);
          return { agents };
        }),
      );

      // Polling
      getH3App(nitroApp).use(`${P}/poll`, createPollHandler());

      // SSE
      if (!options.disableSSE) {
        for (const route of resolveFrameworkSseRoutes(options.sseRoute)) {
          getH3App(nitroApp).use(route, createPollEventsHandler());
        }
      }

      // Ping
      if (!options.disablePing) {
        getH3App(nitroApp).use(
          `${P}/ping`,
          defineEventHandler(() => ({
            message: process.env.PING_MESSAGE ?? "pong",
          })),
        );
      }

      // ─── Durable sandbox execution processor ─────────────────────────
      // Self-fired by run-code's background queue (see
      // coding-tools/sandbox/background.ts): the enqueueing request POSTs here
      // so the code executes in a FRESH invocation with its own budget instead
      // of riding the ~40s agent-loop wall. Authenticity is verified via the
      // shared HMAC internal-token scheme (same as the A2A / integration /
      // agent-teams processors) plus the atomic SQL claim inside
      // processQueuedSandboxExecution, which prevents double execution.
      getH3App(nitroApp).use(
        `${P}/sandbox/_process-execution`,
        defineEventHandler(async (event) => {
          if (getMethod(event) !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          const body = (await readBody(event).catch(() => null)) as {
            executionId?: unknown;
            taskId?: unknown;
          } | null;
          const executionId =
            body && typeof body.executionId === "string" && body.executionId
              ? body.executionId
              : body && typeof body.taskId === "string"
                ? body.taskId
                : "";
          if (!executionId) {
            setResponseStatus(event, 400);
            return { error: "executionId required" };
          }

          const {
            hasConfiguredA2ASecret,
            isLoopbackAddress,
            isTrustedLocalRuntime,
          } = await import("../a2a/auth-policy.js");
          if (hasConfiguredA2ASecret()) {
            const { verifyInternalToken, extractBearerToken } =
              await import("../integrations/internal-token.js");
            const token = extractBearerToken(getHeader(event, "authorization"));
            if (!verifyInternalToken(executionId, token ?? "")) {
              setResponseStatus(event, 401);
              return { error: "Invalid or expired processor token" };
            }
          } else {
            const loopback = isLoopbackAddress(
              getRequestIP(event, { xForwardedFor: false }),
            );
            if (!isTrustedLocalRuntime({ loopback })) {
              setResponseStatus(event, 503);
              return {
                error:
                  "Sandbox execution processor not configured — set A2A_SECRET on this deployment (or A2A_ALLOW_UNSIGNED_INTERNAL=1 for trusted local dev).",
              };
            }
          }

          try {
            const { processQueuedSandboxExecution } =
              await import("../coding-tools/sandbox/background.js");
            const result = await processQueuedSandboxExecution(executionId);
            return { ok: true, ...result };
          } catch (err) {
            console.error("[sandbox] _process-execution failed:", err);
            setResponseStatus(event, 500);
            return { error: "process-execution failed" };
          }
        }),
      );

      // ─── Durable sandbox execution sweep ──────────────────────────────
      // Backstop for lost dispatches and dead executors: re-drives queued rows
      // whose enqueue-time dispatch never landed and reclaims/reaps running
      // rows whose lease expired. Cheap (one indexed query per 2-min window;
      // a missing table short-circuits to a no-op) and best-effort — the
      // poll-time drain in run-code covers deployments where warm-instance
      // timers rarely fire.
      (() => {
        let lastSweep = 0;
        const SWEEP_INTERVAL_MS = 2 * 60 * 1000;

        setTimeout(() => {
          setInterval(() => {
            const now = Date.now();
            if (now - lastSweep < SWEEP_INTERVAL_MS) return;
            lastSweep = now;

            (async () => {
              const { drainDueSandboxExecutions } =
                await import("../coding-tools/sandbox/background.js");
              await drainDueSandboxExecutions({ limit: 5 });
            })().catch(() => {
              // best-effort — never break the server
            });
          }, 30_000); // Check every 30s but only sweep once per 2min
        }, 25_000); // Start 25s after init (after the agent sweeps)
      })();

      // Health + DB warmup — liveness probe that touches the database so
      // uptime monitors and the keep-warm cron prevent a scale-to-zero
      // serverless DB (e.g. Neon) from cold-starting on the next real
      // request. Public, side-effect free, and never cached. Add ?schema=1
      // for metadata-only schema checks, and ?strict=1 to turn a not-ready
      // DB/schema probe into a failing HTTP status for monitors.
      if (!options.disableHealth) {
        getH3App(nitroApp).use(
          `${P}/health`,
          defineEventHandler(async (event) => {
            setResponseHeader(event, "cache-control", "no-store");
            const schema =
              event.url?.searchParams.get("schema") === "1" ||
              event.url?.searchParams.get("schema") === "true";
            const strict =
              event.url?.searchParams.get("strict") === "1" ||
              event.url?.searchParams.get("strict") === "true" ||
              process.env.AGENT_NATIVE_HEALTH_STRICT_SCHEMA === "true";
            const result = await runDbHealthProbe(getDbExec, { schema });
            if (strict && !result.ready) setResponseStatus(event, 503);
            return result;
          }),
        );
      }

      getH3App(nitroApp).use(
        `${P}/debug/runtime`,
        defineEventHandler(async (event) => {
          setResponseHeader(event, "cache-control", "no-store");
          const session = await getSession(event).catch(() => null);
          const productionLike =
            process.env.NODE_ENV === "production" ||
            process.env.NETLIFY === "true" ||
            process.env.VERCEL === "1";
          if (!session?.email && productionLike) {
            setResponseStatus(event, 401);
            return { error: "Authentication required" };
          }
          const schema = await runDatabaseSchemaHealthCheck().catch((err) => ({
            ok: false,
            checked: false,
            dialect: getDatabaseRuntimeFingerprint().dialect,
            missingTables: [],
            missingColumns: [],
            error: err instanceof Error ? err.message : String(err),
          }));
          return {
            ok: true,
            runtime: getRuntimeDebugFingerprint(),
            schema,
          };
        }),
      );

      getH3App(nitroApp).use(
        `${P}/speculation-rules.json`,
        defineEventHandler((event) => {
          // `createH3SSRHandler` points the Speculation-Rules response header
          // here to prevent Cloudflare Speed Brain from injecting its own
          // edge prefetch rules. Keep this route public and side-effect free:
          // browsers may request it while parsing any SSR HTML document.
          setResponseHeader(
            event,
            "content-type",
            "application/speculationrules+json; charset=utf-8",
          );
          for (const [name, value] of Object.entries(
            DEFAULT_SSR_CACHE_HEADERS,
          )) {
            setResponseHeader(event, name, value);
          }
          return EMPTY_SPECULATION_RULES;
        }),
      );

      {
        const { createAgentNativeOgImageHandler } =
          await import("./social-og-image.js");
        getH3App(nitroApp).use(
          `${P}/og-image.png`,
          createAgentNativeOgImageHandler(),
        );
      }

      // Signed, content-only recap PNG images. POST (authenticated with the
      // same `agent-native connect` bearer token the action surface accepts)
      // stores a PNG and returns a public image URL; GET <token>.png serves
      // the opaque bytes anonymously so GitHub's camo proxy can inline a recap
      // screenshot into a private-repo PR comment. Mounted as a prefix so it
      // owns both `/_agent-native/recap-image` (POST) and
      // `/_agent-native/recap-image/<token>.png` (GET).
      {
        const { createRecapImageHandler } =
          await import("./recap-image-route.js");
        getH3App(nitroApp).use(`${P}/recap-image`, createRecapImageHandler());
      }

      mountBrowserSessionRoutes(nitroApp, { routePrefix: P });

      // Dev-mode DB admin (Supabase-Studio-like). Mounted unconditionally; every
      // handler self-gates on dev + localhost (the authoritative gate lives in
      // db-admin/routes.ts), so on a deployed / production app it always 403s.
      mountDbAdminRoutes(nitroApp, { routePrefix: P });

      const resolveBuilderOwnerContext = async (
        event: H3Event,
        mode?: "connect" | "callback",
      ): Promise<BuilderOwnerContext> =>
        resolveBuilderOwnerContextForRequest(
          event,
          { anonymousOwner: options.anonymousOwner },
          mode,
        );

      const builderStatusHandler = defineEventHandler(async (event) => {
        const envStatus = getBuilderBrowserStatusForEvent(event);
        const ownerContext = await resolveBuilderOwnerContext(event);
        const userEmail = ownerContext.email;
        const withConnectToken = <T extends { connectUrl: string }>(
          status: T,
        ): T & { cliAuthUrl?: string } => {
          if (!userEmail) return status;
          const previewOrigin = getBuilderBrowserOriginForEvent(event);
          const callbackOrigin = getBuilderCliAuthCallbackOriginForEvent(event);
          const statusWithConnectToken = {
            ...status,
            connectUrl: appendBuilderConnectToken(status.connectUrl, userEmail),
          } as T & { cliAuthUrl?: string };
          // Direct cli-auth only works when the callback lands on the same
          // deployment that minted the signed state. Builder/Fusion previews
          // often need a gateway callback origin; in that case use the
          // /builder/connect trampoline so it can write the pending-connect
          // row that the gateway callback validates against.
          if (
            previewOrigin.replace(/\/+$/, "") !==
            callbackOrigin.replace(/\/+$/, "")
          ) {
            return statusWithConnectToken;
          }
          const cliAuthUrl = buildBuilderCliAuthUrl(
            callbackOrigin,
            signBuilderCallbackState(userEmail),
            { previewOrigin },
          );
          return {
            ...statusWithConnectToken,
            cliAuthUrl,
          };
        };

        // Pass the user's active orgId so status reads can fall back to
        // org-scoped credentials and branch project IDs. Without it, an
        // admin's org-scope OAuth result is invisible to every other org
        // member's status poller and the UI would show "not connected" forever
        // even though the chat actually resolves the org-shared credential.
        let orgId: string | null = null;
        if (!ownerContext.anonymous) {
          try {
            const { getOrgContext } = await import("../org/context.js");
            const orgCtx = await getOrgContext(event);
            orgId = orgCtx.orgId ?? null;
          } catch {
            /* org module not present in this template — keep userEmail-only */
          }
        }

        return runWithRequestContext(
          { userEmail, orgId: orgId ?? undefined },
          async () => {
            const projectId = await resolveBuilderBranchProjectId();
            const requestStatus = {
              ...envStatus,
              builderEnabled: !!projectId,
              branchProjectIdConfigured: !!projectId,
              branchProjectId: projectId || undefined,
            };

            // Surface a recent OAuth callback failure before reporting a
            // deployment fallback as "connected"; otherwise a failed personal
            // connect attempt on a deploy that also has BUILDER_PRIVATE_KEY set
            // looks successful even though the user's credentials were not saved.
            try {
              if (userEmail) {
                const errKey = `builder-connect-error:${userEmail}`;
                const errRow = await getSetting(errKey);
                if (errRow && typeof errRow.message === "string") {
                  await deleteSetting(errKey).catch(() => {});
                  return withConnectToken({
                    ...requestStatus,
                    configured: false,
                    privateKeyConfigured: false,
                    publicKeyConfigured: false,
                    userId: undefined,
                    orgName: undefined,
                    orgKind: undefined,
                    subscription: undefined,
                    subscriptionLevel: undefined,
                    subscriptionName: undefined,
                    isEnterprise: undefined,
                    isFreeAccount: undefined,
                    connectError: {
                      message: errRow.message as string,
                      at:
                        typeof errRow.at === "number"
                          ? (errRow.at as number)
                          : Date.now(),
                    },
                  });
                }
              }
            } catch {
              // settings store unavailable — fall through
            }

            // Read request-scoped Builder credentials first; deploy env is only
            // the fallback. This keeps a root/local BUILDER_PRIVATE_KEY from
            // blocking a user from connecting their own Builder account.
            try {
              const {
                resolveBuilderCredentials,
                resolveBuilderCredentialSource,
                getBuilderCredentialAuthFailure,
              } = await import("./credential-provider.js");
              const [creds, credentialSource] = await Promise.all([
                resolveBuilderCredentials(),
                resolveBuilderCredentialSource(),
              ]);
              const authFailure = await getBuilderCredentialAuthFailure(creds);
              if (authFailure) {
                return withConnectToken({
                  ...requestStatus,
                  configured: false,
                  privateKeyConfigured: false,
                  publicKeyConfigured: false,
                  userId: undefined,
                  orgName: undefined,
                  orgKind: undefined,
                  subscription: undefined,
                  subscriptionLevel: undefined,
                  subscriptionName: undefined,
                  isEnterprise: undefined,
                  isFreeAccount: undefined,
                  credentialSource: credentialSource ?? undefined,
                  // Surface durable credential rejection separately from
                  // one-shot cli-auth callback failures. The reconnect UI keeps
                  // polling through authError while the user chooses a new
                  // Builder space; connectError means the active callback itself
                  // failed and should stop the flow.
                  authError: {
                    message: authFailure.message,
                    at: authFailure.at,
                  },
                });
              }
              if (creds.privateKey && creds.publicKey) {
                // Best-effort: surface the real space name(s) from Builder's
                // Admin API. Stay NON-BLOCKING — return whatever is cached now
                // and refresh in the background for the next poll. Falls back
                // to orgName until the cache warms.
                let spaces: Array<{ id: string; name: string }> | undefined;
                try {
                  const { getCachedBuilderSpaces, listBuilderSpaces } =
                    await import("./builder-space.js");
                  const privateKey = creds.privateKey;
                  const cachedSpaces = getCachedBuilderSpaces(privateKey);
                  if (cachedSpaces && cachedSpaces.length > 0) {
                    spaces = cachedSpaces;
                  }
                  if (!cachedSpaces) {
                    // Warm the cache without blocking this response.
                    void listBuilderSpaces(privateKey).catch(() => {});
                  }
                } catch {
                  // Admin API helper unavailable — leave spaces undefined.
                }
                return withConnectToken({
                  ...requestStatus,
                  configured: true,
                  privateKeyConfigured: true,
                  publicKeyConfigured: !!creds.publicKey,
                  userId: creds.userId || envStatus.userId,
                  orgName: creds.orgName || envStatus.orgName,
                  spaces,
                  orgKind: creds.orgKind || envStatus.orgKind,
                  subscription:
                    creds.subscription || envStatus.subscription || undefined,
                  subscriptionLevel:
                    creds.subscriptionLevel ||
                    envStatus.subscriptionLevel ||
                    undefined,
                  subscriptionName:
                    creds.subscriptionName ||
                    envStatus.subscriptionName ||
                    undefined,
                  isEnterprise:
                    creds.isEnterprise ?? envStatus.isEnterprise ?? undefined,
                  isFreeAccount:
                    creds.isFreeAccount ?? envStatus.isFreeAccount ?? undefined,
                  credentialSource: credentialSource ?? undefined,
                });
              }
            } catch {
              // Secrets table not ready — fall through to env status
            }

            // Honor legacy disconnect flag for existing deployments.
            try {
              const disconnected = await getSetting("builder-disconnected");
              if (disconnected) {
                return withConnectToken({
                  ...requestStatus,
                  configured: false,
                  privateKeyConfigured: false,
                  publicKeyConfigured: false,
                  userId: undefined,
                  orgName: undefined,
                  orgKind: undefined,
                  subscription: undefined,
                  subscriptionLevel: undefined,
                  subscriptionName: undefined,
                  isEnterprise: undefined,
                  isFreeAccount: undefined,
                });
              }
            } catch {
              // DB not reachable
            }
            // No env, no per-user creds → not configured. Both authenticated
            // and unauthenticated callers see "not connected" so they can
            // run through the OAuth flow.
            return withConnectToken({
              ...requestStatus,
              configured: false,
              privateKeyConfigured: false,
              publicKeyConfigured: false,
              userId: undefined,
              orgName: undefined,
              orgKind: undefined,
              subscription: undefined,
              subscriptionLevel: undefined,
              subscriptionName: undefined,
              isEnterprise: undefined,
              isFreeAccount: undefined,
            });
          },
        );
      });
      mountBuilderStatusRouteAliases(
        (path, handler) => getH3App(nitroApp).use(path, handler),
        P,
        builderStatusHandler,
      );

      // How long a pending-connect row is valid. Must be long enough for
      // the user to complete the Builder CLI-auth flow, but short enough
      // that a stale row from an abandoned attempt doesn't accept a new
      // callback minutes later.
      const BUILDER_CONNECT_PENDING_TTL_MS = 10 * 60 * 1000; // 10 min

      // Decide whether a /builder/connect navigation originated from this
      // app's own UI (allowed) or from a foreign origin (cross-site CSRF
      // attempt — rejected). Sec-Fetch-Site is the modern signal:
      //   - "same-origin": user clicked Connect from our own pages — allow
      //   - "none": typed in URL bar / bookmark / browser extension — allow
      //   - "same-site" / "cross-site" / missing-but-with-foreign-Origin
      //     all map to reject.
      // For older browsers without Sec-Fetch-* we fall back to Origin and
      // then Referer, comparing against the request's resolved origin.
      function isSameOriginConnect(event: H3Event): boolean {
        const fetchSite = getHeader(event, "sec-fetch-site");
        if (fetchSite === "same-origin" || fetchSite === "none") return true;
        if (fetchSite) return false; // browser told us it's cross-site/same-site
        const expected = getBuilderBrowserOriginForEvent(event).replace(
          /\/+$/,
          "",
        );
        const origin = getHeader(event, "origin");
        if (origin) return origin.replace(/\/+$/, "") === expected;
        const referer = getHeader(event, "referer");
        if (referer) {
          try {
            return new URL(referer).origin === expected;
          } catch {
            return false;
          }
        }
        // No Sec-Fetch-Site, no Origin, no Referer — pre-2020 browser
        // making a top-level navigation. Allow; cookies are still
        // session-bound so the worst case degrades to the prior behavior.
        return true;
      }

      // Lightweight 302 to the Builder CLI-auth URL. Lets clients do
      // `window.open('/_agent-native/builder/connect', '_blank')` synchronously
      // inside a click handler, avoiding the popup-blocker downgrade that
      // happens when an await sits before window.open.
      //
      // CSRF protection here is layered because session cookies are
      // SameSite=None;Secure (so the editor iframe can ride along) — that
      // means a session cookie alone does NOT prevent cross-origin
      // window.open from initiating a connect flow on the victim's behalf:
      //   1. Signed connect token from /builder/status — proves the opener
      //      could read same-origin JSON, which cross-site attackers cannot.
      //      This covers local/embedded browsers that conservatively label a
      //      legitimate popup navigation as same-site/cross-site.
      //   2. Sec-Fetch-Site header fallback — modern browsers stamp every
      //      request with the navigation context. We allow `same-origin` or
      //      `none` (typed/bookmark/extension); cross-site / same-site without
      //      a valid connect token are rejected.
      //   3. Pending row keyed by session email + bound nonce — the callback
      //      requires both a valid session and a one-time row that this
      //      handler wrote during the same flow. Without the same-origin
      //      gate or connect token above, an attacker could prime the row from
      //      cross-site and then trick the victim into hitting a callback URL
      //      with attacker-controlled p-key/api-key, hijacking the victim's
      //      account.
      getH3App(nitroApp).use(
        `${P}/builder/connect`,
        defineEventHandler(async (event) => {
          const ownerContext = await resolveBuilderOwnerContext(
            event,
            "connect",
          );
          const ownerEmail = ownerContext.email;
          if (!ownerEmail) {
            setResponseStatus(event, 401);
            return { error: "Authentication required" };
          }

          const requestUrl = getFrameworkRouteRequestUrl(event);
          const connectToken = requestUrl.searchParams.get(
            BUILDER_CONNECT_PARAM,
          );
          const connectTokenOwner =
            verifyBuilderConnectTokenAndGetOwner(connectToken);
          const connectTracking = getBuilderConnectTrackingParams(
            requestUrl.searchParams,
          );
          // The token must both be well-formed AND minted for the current
          // session owner. Without the owner check, an attacker holding any
          // valid signed token could trick a victim into hitting this route
          // with that token to bypass the cross-origin gate.
          const hasValidConnectToken =
            Boolean(connectTokenOwner) && connectTokenOwner === ownerEmail;

          // Same-origin gate. Sec-Fetch-Site remains the fast path; the signed
          // connect token is the compatibility path for legitimate embedded or
          // local desktop popups stamped as same-site/cross-site by the browser.
          if (!isSameOriginConnect(event) && !hasValidConnectToken) {
            const crossOriginMessage = connectToken
              ? "This Builder connect link is expired or belongs to a different deployment. Close this popup and click Connect account again."
              : "Builder connect opened without a fresh signed link. Close this popup and click Connect account again.";
            await trackBuilderLifecycle(
              event,
              "builder connect failed",
              ownerEmail,
              {
                ...builderConnectTrackingProperties(connectTracking),
                reason: "cross_origin",
                stage: "connect",
                has_connect_token: Boolean(connectToken),
                has_valid_connect_token: false,
                connect_token_owner_matches_context: false,
                sec_fetch_site: getHeader(event, "sec-fetch-site") ?? null,
              },
            );
            await putSetting(`builder-connect-error:${ownerEmail}`, {
              message: crossOriginMessage,
              at: Date.now(),
            }).catch(() => {});
            console.warn("[builder-connect] rejected cross-origin connect", {
              hasConnectToken: Boolean(connectToken),
              secFetchSite: getHeader(event, "sec-fetch-site") ?? null,
              origin: getHeader(event, "origin") ?? null,
              referer: getHeader(event, "referer") ?? null,
            });
            setResponseStatus(event, 403);
            setResponseHeader(
              event,
              "Content-Type",
              "text/html; charset=utf-8",
            );
            return createBuilderBrowserCallbackErrorPage(crossOriginMessage, {
              title: "Couldn't start Builder connection",
              body: "The connect popup did not include a valid signed link for this app.",
              closeHint:
                "Close this popup, refresh the app, and try Connect account again.",
              parentOrigin: getBuilderBrowserOriginForEvent(event),
            });
          }

          // Clear any prior failure row from a previous attempt — otherwise
          // useBuilderStatus polling sees the stale error and aborts the
          // new attempt before it can complete.
          try {
            await deleteSetting(`builder-connect-error:${ownerEmail}`);
          } catch {
            // No prior error row — fine
          }

          const previewOrigin = getBuilderBrowserOriginForEvent(event).replace(
            /\/+$/,
            "",
          );
          const callbackOrigin = getBuilderCliAuthCallbackOriginForEvent(
            event,
          ).replace(/\/+$/, "");
          let relay:
            | { state: string; payload: BuilderPreviewRelayState }
            | undefined;
          if (previewOrigin !== callbackOrigin) {
            try {
              relay = signBuilderPreviewRelayState({
                ownerEmail,
                targetOrigin: previewOrigin,
                basePath: getAppBasePath(),
              });
            } catch (err) {
              const msg =
                err instanceof Error
                  ? err.message
                  : "Builder preview relay is not configured.";
              setResponseStatus(event, 503);
              setResponseHeader(
                event,
                "Content-Type",
                "text/html; charset=utf-8",
              );
              return createBuilderBrowserCallbackErrorPage(msg, {
                title: "Builder preview connection isn't configured",
                body: "This preview needs its secure Builder callback relay configured before authorization can start.",
                closeHint:
                  "Close this popup and ask the preview owner to finish Builder relay setup.",
                parentOrigin: previewOrigin,
              });
            }
          }

          let pendingOrgId: string | null = null;
          let pendingRole: string | null = null;
          if (!ownerContext.anonymous) {
            try {
              const orgContext = await getOrgContext(event);
              pendingOrgId = orgContext.orgId ?? null;
              pendingRole = orgContext.role ?? null;
            } catch {
              // The pending owner remains user-scoped when org context is absent.
            }
          }

          // Store a short-lived pending row. If the DB is unavailable we
          // surface a popup-renderable error page that signals the parent
          // via BroadcastChannel, rather than letting the popup show raw
          // JSON and the parent poll for 5 minutes.
          try {
            if (relay) {
              await putSetting(builderRelayPendingKey(relay.payload.flowId), {
                ownerEmail,
                orgId: pendingOrgId,
                role: pendingRole,
                targetOrigin: relay.payload.targetOrigin,
                basePath: relay.payload.basePath,
                expiresAt: relay.payload.exp,
                tracking: connectTracking,
              });
            } else {
              await putSetting(`builder-pending-connect:${ownerEmail}`, {
                expiresAt: Date.now() + BUILDER_CONNECT_PENDING_TTL_MS,
                tracking: connectTracking,
              });
            }
          } catch (err) {
            await trackBuilderLifecycle(
              event,
              "builder connect failed",
              ownerEmail,
              {
                ...builderConnectTrackingProperties(connectTracking),
                reason: "pending_storage_unavailable",
                stage: "connect",
              },
            );
            const msg =
              "Could not initiate Builder connect — storage unavailable. Try again.";
            console.error(
              "[builder] Could not store pending-connect state:",
              (err as Error)?.message ?? err,
            );
            // Best-effort: also write the error row so the parent's
            // /builder/status poll picks it up if BroadcastChannel doesn't.
            await putSetting(`builder-connect-error:${ownerEmail}`, {
              message: msg,
              at: Date.now(),
            }).catch(() => {});
            setResponseStatus(event, 503);
            setResponseHeader(
              event,
              "Content-Type",
              "text/html; charset=utf-8",
            );
            return createBuilderBrowserCallbackErrorPage(msg, {
              parentOrigin: getBuilderBrowserOriginForEvent(event),
            });
          }
          await trackBuilderLifecycle(
            event,
            "builder connect started",
            ownerEmail,
            {
              ...builderConnectTrackingProperties(connectTracking),
              stage: "connect",
              connect_token_owner_matches_context:
                !connectTokenOwner || connectTokenOwner === ownerEmail,
            },
          );
          setBuilderConnectOwnerCookie(event, ownerEmail);
          // The primary UI now opens the signed Builder /cli-auth URL directly
          // from /builder/status. Keep this legacy trampoline working for older
          // clients, but still send it to Builder immediately and include signed
          // callback state so the callback does not depend on popup cookies.
          const cliAuthUrl = buildBuilderCliAuthUrl(
            callbackOrigin,
            signBuilderCallbackState(ownerEmail),
            {
              previewOrigin,
              relayState: relay?.state,
              tracking: connectTracking,
            },
          );
          setResponseStatus(event, 302);
          setResponseHeader(event, "Location", cliAuthUrl);
          return "";
        }),
      );

      getH3App(nitroApp).use(
        `${P}/builder/run`,
        defineEventHandler(async (event: H3Event) => {
          if (getMethod(event) !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          const body = await readBody(event).catch(() => ({}) as any);
          const prompt = typeof body?.prompt === "string" ? body.prompt : "";
          if (!prompt.trim()) {
            setResponseStatus(event, 400);
            return { error: "prompt is required" };
          }
          const session = await getSession(event).catch(() => null);
          if (!session?.email) {
            setResponseStatus(event, 401);
            return { error: "Authentication required" };
          }
          const userEmail = session.email;

          let orgId: string | null = null;
          try {
            const orgCtx = await getOrgContext(event);
            orgId = orgCtx.orgId ?? null;
          } catch {
            /* org module not present in this template — keep userEmail-only */
          }

          // Wrap in runWithRequestContext so resolveBuilderCredential() inside
          // runBuilderAgent() resolves per-user app_secrets rather than falling
          // through to process.env — the same pattern the /builder/status endpoint
          // uses. Without this, per-user Builder keys stored in app_secrets are
          // invisible to the run path and the call throws "Builder keys are not
          // configured" even though the status endpoint correctly reports configured=true.
          return runWithRequestContext(
            { userEmail, orgId: orgId ?? undefined },
            async () => {
              const projectId = await resolveBuilderBranchProjectId();
              if (!projectId) {
                setResponseStatus(event, 403);
                return {
                  error:
                    "Builder branch creation is not available for this organization yet.",
                };
              }

              const { resolveBuilderCredential: resolveBuilderCred } =
                await import("./credential-provider.js");
              const builderUserId =
                (await resolveBuilderCred("BUILDER_USER_ID")) || undefined;
              // Server-controlled projectId — don't let clients target arbitrary
              // Builder projects with our private key. When this feature graduates
              // past the hardcoded preview, the projectId will come from
              // workspace/org config, still resolved server-side.
              try {
                const result = await runBuilderAgent({
                  prompt,
                  projectId,
                  branchName:
                    typeof body?.branchName === "string"
                      ? body.branchName
                      : undefined,
                  userEmail,
                  userId: builderUserId,
                });
                return result;
              } catch (e) {
                setResponseStatus(event, 500);
                return {
                  error: e instanceof Error ? e.message : "Builder run failed",
                };
              }
            },
          );
        }),
      );

      // Branch-creation waitlist signup. Used by ConnectBuilderCard when the
      // current request has no Builder branch project configured. Hosted
      // Agent Native deployments submit into the Builder-org Forms waitlist;
      // local/self-hosted deployments keep the analytics signal without
      // sending private workspace data to Agent Native.
      getH3App(nitroApp).use(
        `${P}/builder/branch-waitlist`,
        defineEventHandler(async (event: H3Event) => {
          if (getMethod(event) !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          const session = await getSession(event).catch(() => null);
          const body = ((await readBody(event).catch(() => ({}))) ??
            {}) as BuilderWaitlistBody;
          const waitlistEmail = resolveWaitlistEmail(
            session?.email,
            body.email,
          );
          if (!waitlistEmail) {
            setResponseStatus(event, 400);
            return { error: "Valid email required" };
          }
          const waitlistRateLimit = checkBuilderWaitlistRateLimit(
            event,
            waitlistEmail,
          );
          if (!waitlistRateLimit.ok) {
            setResponseStatus(event, 429);
            setResponseHeader(
              event,
              "Retry-After",
              String(waitlistRateLimit.retryAfterSeconds),
            );
            return {
              error:
                "Too many waitlist requests. Please try again in a minute.",
            };
          }
          const waitlistPayload = buildBuilderWaitlistFormPayload(
            event,
            waitlistEmail,
            body,
          );
          const waitlistSource = waitlistPayload.data.source;
          const waitlistTemplate = waitlistPayload.data.template;
          const waitlistUseCase = waitlistPayload.data.useCase;
          let formSubmission: { submitted: boolean; formId?: string };
          try {
            formSubmission = await submitBuilderWaitlistForm(
              event,
              waitlistEmail,
              body,
            );
          } catch (err) {
            await trackBuilderLifecycle(
              event,
              "builder branch waitlist form failed",
              waitlistEmail,
              {
                reason:
                  err instanceof Error ? err.message : "unknown_waitlist_error",
                source: waitlistSource,
                stage: "waitlist",
                template: waitlistTemplate ?? null,
                useCase: waitlistUseCase,
              },
            );
            setResponseStatus(event, 502);
            return {
              error:
                "Couldn't join the waitlist. Please try again in a moment.",
            };
          }
          await trackBuilderLifecycle(
            event,
            "builder branch waitlist joined",
            waitlistEmail,
            {
              formId: formSubmission.formId ?? null,
              formSubmitted: formSubmission.submitted,
              source: waitlistSource,
              stage: "waitlist",
              template: waitlistTemplate ?? null,
              useCase: waitlistUseCase,
            },
          );
          return { ok: true, formSubmitted: formSubmission.submitted };
        }),
      );

      getH3App(nitroApp).use(
        `${P}/builder/relay`,
        defineEventHandler(async (event: H3Event) => {
          if (getMethod(event) !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          const rawBody = await readBuilderRelayRequestBody(event);
          const result = await consumeBuilderRelayRequest(
            {
              rawBody,
              timestamp: getHeader(event, BUILDER_RELAY_TIMESTAMP_HEADER),
              flowId: getHeader(event, BUILDER_RELAY_FLOW_HEADER),
              signature: getHeader(event, BUILDER_RELAY_SIGNATURE_HEADER),
              requestOrigin: getFrameworkRouteRequestUrl(event).origin,
              requestBasePath: getAppBasePath(),
            },
            {
              getPending: getSetting,
              deletePending: deleteSetting,
              writeCredentials: async (ownerEmail, credentials, scope) => {
                const { writeBuilderCredentials } =
                  await import("./credential-provider.js");
                await writeBuilderCredentials(ownerEmail, credentials, scope);
                await Promise.all([
                  deleteSetting("builder-disconnected").catch(() => false),
                  deleteSetting(`builder-connect-error:${ownerEmail}`).catch(
                    () => false,
                  ),
                ]);
              },
            },
          ).catch(() => ({
            ok: false as const,
            status: 500,
            error: "Builder relay credential persistence failed",
          }));
          if (!result.ok) {
            setResponseStatus(event, result.status);
            return { error: result.error };
          }
          return { ok: true };
        }),
      );

      getH3App(nitroApp).use(
        `${P}/builder/callback`,
        defineEventHandler(async (event: H3Event) => {
          if (getMethod(event) !== "GET") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          // Builder's provider contract puts credentials on this first-hop
          // URL. Keep the response out of caches and suppress referrer
          // propagation even though the second hop carries secrets only in
          // its authenticated POST body.
          setResponseHeader(event, "Cache-Control", "no-store");
          setResponseHeader(event, "Referrer-Policy", "no-referrer");

          const requestUrl = getFrameworkRouteRequestUrl(event);
          const relayStateRaw = requestUrl.searchParams.get(
            BUILDER_RELAY_STATE_PARAM,
          );
          if (relayStateRaw) {
            let relayPayload: BuilderPreviewRelayState | null = null;
            try {
              relayPayload =
                verifyBuilderPreviewRelayStateForCallback(relayStateRaw);
            } catch {
              // A preview relay must fail closed when its dedicated shared
              // secret is absent on the corporate callback deployment.
            }
            if (!relayPayload) {
              setResponseStatus(event, 403);
              setResponseHeader(
                event,
                "Content-Type",
                "text/html; charset=utf-8",
              );
              return createBuilderBrowserCallbackErrorPage(
                "Builder preview relay state is invalid or expired.",
              );
            }

            const privateKey = requestUrl.searchParams.get("p-key");
            const publicKey = requestUrl.searchParams.get("api-key");
            if (!privateKey || !publicKey) {
              setResponseStatus(event, 400);
              setResponseHeader(
                event,
                "Content-Type",
                "text/html; charset=utf-8",
              );
              return createBuilderBrowserCallbackErrorPage(
                "Builder didn't return credentials. Restart the connect flow from settings.",
                { parentOrigin: relayPayload.targetOrigin },
              );
            }

            const credentials: BuilderRelayCredentials = {
              privateKey,
              publicKey,
              userId: requestUrl.searchParams.get("user-id"),
              orgName: requestUrl.searchParams.get("org-name"),
              orgKind: requestUrl.searchParams.get("kind"),
              subscription: requestUrl.searchParams.get("subscription"),
              subscriptionLevel:
                requestUrl.searchParams.get("subscription-level"),
              subscriptionName:
                requestUrl.searchParams.get("subscription-name"),
              isEnterprise: parseBuilderCallbackBoolean(
                requestUrl.searchParams.get("is-enterprise"),
              ),
              isFreeAccount: parseBuilderCallbackBoolean(
                requestUrl.searchParams.get("is-free-account"),
              ),
            };

            try {
              const relayRequest = createBuilderRelayRequest(
                relayStateRaw,
                credentials,
              );
              const response = await ssrfSafeFetch(
                relayRequest.url,
                {
                  method: "POST",
                  headers: relayRequest.headers,
                  body: relayRequest.body,
                },
                { maxRedirects: 0, httpsOnly: true },
              );
              if (!response.ok) {
                throw new Error(
                  `Preview relay rejected the callback (${response.status}).`,
                );
              }
            } catch (err) {
              const message =
                err instanceof Error
                  ? err.message
                  : "Builder preview relay failed.";
              // Never log the first-hop URL or relay body: both contain
              // credentials. The popup gets a bounded, credential-free error.
              setResponseStatus(event, 502);
              setResponseHeader(
                event,
                "Content-Type",
                "text/html; charset=utf-8",
              );
              return createBuilderBrowserCallbackErrorPage(message, {
                parentOrigin: relayPayload.targetOrigin,
              });
            }

            setResponseHeader(
              event,
              "Content-Type",
              "text/html; charset=utf-8",
            );
            return createBuilderBrowserCallbackPage(
              `${relayPayload.targetOrigin}${relayPayload.basePath || "/"}`,
              { parentOrigin: relayPayload.targetOrigin },
            );
          }

          // A real session or a template-approved anonymous owner is required;
          // the pending-row check below (combined with the same-origin gate on
          // /builder/connect) blocks CSRF and callback replay.
          const ownerContext = await resolveBuilderOwnerContext(
            event,
            "callback",
          );
          const ownerEmail = ownerContext.email;
          // Diagnostic: log the resolver's inputs for debugging "No active
          // connect flow found" reports. Reveals session-vs-state owner
          // mismatches and missing/forged _an_state without leaking the
          // signed token itself.
          try {
            const debugSearch = getFrameworkRouteRequestUrl(event).searchParams;
            const stateRaw = debugSearch.get(BUILDER_STATE_PARAM);
            const stateOwnerProbe =
              verifyBuilderCallbackStateAndGetOwner(stateRaw);
            const session = await getSession(event).catch(() => null);
            console.log(
              `[builder-callback] resolved-owner=${ownerEmail ?? "(none)"} session-email=${session?.email ?? "(none)"} state-owner=${stateOwnerProbe ?? "(none)"} state-present=${Boolean(stateRaw)} anon=${ownerContext.anonymous} host=${getHeader(event, "host") ?? "(none)"} sec-fetch-site=${getHeader(event, "sec-fetch-site") ?? "(none)"} origin=${getHeader(event, "origin") ?? "(none)"} referer=${getHeader(event, "referer") ?? "(none)"}`,
            );
          } catch {
            // Diagnostic logging is best-effort; do not break the callback.
          }
          if (!ownerEmail) {
            setResponseStatus(event, 401);
            return { error: "Authentication required" };
          }
          clearBuilderConnectOwnerCookie(event);

          let connectTracking = getBuilderConnectTrackingParams(
            requestUrl.searchParams,
          );
          // postMessage from the callback success/error pages must target the
          // original preview opener, not the callback server. On the fallback
          // path the callback is served from the env-configured gateway while
          // the opener lives on the preview origin. Three sources of opener
          // origin, in priority order:
          //   1. `_an_opener` — written into the callback URL's query by
          //      buildBuilderCliAuthUrl when cli-auth's allow-list forced
          //      preview_url onto the gateway. Survives Builder's redirect
          //      verbatim (Builder preserves redirect_url's query string).
          //   2. `preview-url` — Builder echoes the top-level preview_url back
          //      as a query param on the callback. Reflects the gateway on
          //      the fallback path, but matches the opener on the happy path.
          //   3. The event's own origin — last-resort fallback.
          const openerOriginFromQuery =
            requestUrl.searchParams.get(BUILDER_OPENER_PARAM);
          const callbackParentOrigin =
            resolveSafePreviewUrl(openerOriginFromQuery, event) ||
            resolveSafePreviewUrl(
              requestUrl.searchParams.get("preview-url"),
              event,
            ) ||
            getBuilderBrowserOriginForEvent(event);
          const callbackStateOwner = verifyBuilderCallbackStateAndGetOwner(
            requestUrl.searchParams.get(BUILDER_STATE_PARAM),
          );
          const hasValidCallbackState = callbackStateOwner === ownerEmail;

          // Verify either:
          //   1. the signed callback state embedded in redirect_url by
          //      /builder/status (primary flow), or
          //   2. the server-side pending-connect row written by the legacy
          //      /builder/connect trampoline.
          //
          // For the pending-row path, delete must succeed before we proceed;
          // otherwise a DB blip
          // leaves the row in place and the same callback URL can be
          // replayed against the same session for up to 10 minutes (the
          // TTL window). Treat a delete failure as a hard failure: the
          // user retries, the next /builder/connect call rewrites the
          // pending row.
          let pendingValid = hasValidCallbackState;
          let pendingError: string | null = null;
          try {
            const pending = (await getSetting(
              `builder-pending-connect:${ownerEmail}`,
            )) as {
              expiresAt?: number;
              tracking?: BuilderConnectTrackingParams;
            } | null;
            if (pending?.tracking) {
              connectTracking = {
                signupSource:
                  connectTracking.signupSource ?? pending.tracking.signupSource,
                agentNativeFlow:
                  connectTracking.agentNativeFlow ??
                  pending.tracking.agentNativeFlow,
                agentNativeConnectSource:
                  connectTracking.agentNativeConnectSource ??
                  pending.tracking.agentNativeConnectSource,
                agentNativeApp:
                  connectTracking.agentNativeApp ??
                  pending.tracking.agentNativeApp,
                agentNativeTemplate:
                  connectTracking.agentNativeTemplate ??
                  pending.tracking.agentNativeTemplate,
              };
            }
            if (
              pending &&
              typeof pending.expiresAt === "number" &&
              Date.now() < pending.expiresAt
            ) {
              try {
                await deleteSetting(`builder-pending-connect:${ownerEmail}`);
                pendingValid = true;
              } catch (err) {
                if (!hasValidCallbackState) {
                  pendingError =
                    "Could not consume pending-connect token (storage error). Please retry.";
                  console.error(
                    "[builder] deleteSetting failed for pending-connect — refusing to proceed (replay risk):",
                    (err as Error)?.message ?? err,
                  );
                }
              }
            }
          } catch {
            // DB temporarily unavailable — treat as missing.
          }

          if (pendingError) {
            await trackBuilderLifecycle(
              event,
              "builder connect failed",
              ownerEmail,
              {
                ...builderConnectTrackingProperties(connectTracking),
                reason: "pending_consume_storage_error",
                stage: "callback",
              },
            );
            // Best-effort signal to the parent's poll loop, then render the
            // popup-friendly error page so the BroadcastChannel notify fires.
            await putSetting(`builder-connect-error:${ownerEmail}`, {
              message: pendingError,
              at: Date.now(),
            }).catch(() => {});
            setResponseStatus(event, 503);
            setResponseHeader(
              event,
              "Content-Type",
              "text/html; charset=utf-8",
            );
            return createBuilderBrowserCallbackErrorPage(pendingError, {
              parentOrigin: callbackParentOrigin,
            });
          }

          if (!pendingValid) {
            // Diagnostic: log the exact reason pendingValid is false so we can
            // distinguish "state didn't validate" from "no pending row" in
            // production "No active connect flow found" reports.
            console.warn(
              `[builder-callback] pending-invalid owner=${ownerEmail} has-state-param=${Boolean(requestUrl.searchParams.get(BUILDER_STATE_PARAM))} state-validated=${hasValidCallbackState} pending-error=${pendingError ?? "(none)"}`,
            );
            await trackBuilderLifecycle(
              event,
              "builder connect failed",
              ownerEmail,
              {
                ...builderConnectTrackingProperties(connectTracking),
                reason: hasValidCallbackState
                  ? "callback_state_unexpectedly_rejected"
                  : "missing_pending_connect",
                stage: "callback",
                has_callback_state: Boolean(
                  requestUrl.searchParams.get(BUILDER_STATE_PARAM),
                ),
              },
            );
            const msg =
              "No active connect flow found. Restart the Builder connect flow from Settings.";
            // Write an error signal so the polling loop in the parent tab
            // terminates quickly instead of waiting 5 minutes for the timeout.
            try {
              await putSetting(`builder-connect-error:${ownerEmail}`, {
                message: msg,
                at: Date.now(),
              });
            } catch {
              // DB unavailable — parent will time out naturally.
            }
            setResponseStatus(event, 403);
            setResponseHeader(
              event,
              "Content-Type",
              "text/html; charset=utf-8",
            );
            return createBuilderBrowserCallbackErrorPage(msg, {
              parentOrigin: callbackParentOrigin,
            });
          }

          const privateKey = requestUrl.searchParams.get("p-key");
          const publicKey = requestUrl.searchParams.get("api-key");

          if (!privateKey || !publicKey) {
            await trackBuilderLifecycle(
              event,
              "builder connect failed",
              ownerEmail,
              {
                ...builderConnectTrackingProperties(connectTracking),
                reason: "missing_credentials",
                stage: "callback",
              },
            );
            // Render the popup-friendly error page (and write a status row)
            // instead of bare JSON, so the parent tab's poll loop terminates
            // immediately via BroadcastChannel rather than hanging until the
            // 5-minute timeout.
            const msg =
              "Builder didn't return credentials. Restart the connect flow from settings.";
            await putSetting(`builder-connect-error:${ownerEmail}`, {
              message: msg,
              at: Date.now(),
            }).catch(() => {});
            setResponseStatus(event, 400);
            setResponseHeader(
              event,
              "Content-Type",
              "text/html; charset=utf-8",
            );
            return createBuilderBrowserCallbackErrorPage(msg, {
              parentOrigin: callbackParentOrigin,
            });
          }

          const userId = requestUrl.searchParams.get("user-id");
          const orgName = requestUrl.searchParams.get("org-name");
          const orgKind = requestUrl.searchParams.get("kind");
          const subscription = requestUrl.searchParams.get("subscription");
          const subscriptionLevel =
            requestUrl.searchParams.get("subscription-level");
          const subscriptionName =
            requestUrl.searchParams.get("subscription-name");
          const isEnterprise = parseBuilderCallbackBoolean(
            requestUrl.searchParams.get("is-enterprise"),
          );
          const isFreeAccount = parseBuilderCallbackBoolean(
            requestUrl.searchParams.get("is-free-account"),
          );

          // Store per-user in app_secrets so each user's Builder connection
          // is independent. No more shared env vars that the last connector
          // overwrites.
          //
          // Failure handling: a silent catch here (returning the success page
          // anyway) was Midhun's bug on 2026-04-28 — popup said "yay", parent
          // window polled `/builder/status` for 5 minutes seeing
          // configured:false, never got a real error. Now we surface the
          // failure two ways: (a) a settings row that the next /builder/status
          // poll picks up, and (b) postMessage from the error page itself,
          // wired into the popup HTML, so the parent stops polling immediately.
          let writeError: string | null = null;
          try {
            const { writeBuilderCredentials } =
              await import("./credential-provider.js");
            // Resolve the user's active org / role so the credentials land
            // at org scope when an owner/admin is connecting (everyone in
            // the org auto-resolves them on next chat call). Members and
            // users with no active org silently fall back to user scope.
            // Failure to read org context is non-fatal — we just keep the
            // legacy per-user behaviour for that connection.
            let orgId: string | null = null;
            let role: string | null = null;
            if (!ownerContext.anonymous) {
              try {
                const { getOrgContext } = await import("../org/context.js");
                const orgCtx = await getOrgContext(event);
                orgId = orgCtx.orgId ?? null;
                role = orgCtx.role ?? null;
              } catch {
                /* org module not present in this template — keep user scope */
              }
            }
            const target = await writeBuilderCredentials(
              ownerEmail,
              {
                privateKey,
                publicKey,
                userId,
                orgName,
                orgKind,
                subscription,
                subscriptionLevel,
                subscriptionName,
                isEnterprise,
                isFreeAccount,
              },
              { orgId, role },
            );
            console.log(
              `[builder-connect] wrote credentials email=${ownerEmail} requestOrgId=${orgId ?? "(none)"} role=${role ?? "(none)"} scope=${target.scope} scopeId=${target.scopeId}`,
            );
          } catch (err) {
            writeError = (err as Error)?.message ?? String(err);
            console.error(
              "[builder] Failed to persist Builder credentials:",
              writeError,
            );
          }

          if (writeError) {
            await trackBuilderLifecycle(
              event,
              "builder connect failed",
              ownerEmail,
              {
                ...builderConnectTrackingProperties(connectTracking),
                reason: "credential_write_failed",
                stage: "callback",
              },
            );
            // Best-effort signal to /builder/status. If putSetting also fails
            // (entire DB unreachable) the popup's postMessage still notifies
            // the parent. If both fail the parent times out at 5min as today.
            try {
              await putSetting(`builder-connect-error:${ownerEmail}`, {
                message: writeError,
                at: Date.now(),
              });
            } catch (settingsErr) {
              console.error(
                "[builder] Couldn't even record connect-error to settings:",
                (settingsErr as Error)?.message ?? settingsErr,
              );
            }
            setResponseStatus(event, 500);
            setResponseHeader(
              event,
              "Content-Type",
              "text/html; charset=utf-8",
            );
            return createBuilderBrowserCallbackErrorPage(writeError, {
              parentOrigin: callbackParentOrigin,
            });
          }

          // Clear any legacy disconnect flag and any prior connect-error row
          // (so a successful retry doesn't surface the previous failure).
          try {
            await deleteSetting("builder-disconnected");
          } catch {
            // DB not ready — proceed
          }
          try {
            await deleteSetting(`builder-connect-error:${ownerEmail}`);
          } catch {
            // No prior error row — fine
          }

          const previewUrl = resolveBuilderCallbackReturnUrl({
            event,
            openerOrigin: openerOriginFromQuery,
            previewUrl: requestUrl.searchParams.get("preview-url"),
          });
          await trackBuilderLifecycle(
            event,
            "builder connect succeeded",
            ownerEmail,
            {
              ...builderConnectTrackingProperties(connectTracking),
              stage: "callback",
              has_preview_url: Boolean(previewUrl),
              org_kind: orgKind || undefined,
              subscription: subscription || undefined,
              subscription_level: subscriptionLevel || undefined,
              subscription_name: subscriptionName || undefined,
              is_enterprise: isEnterprise ?? undefined,
              is_free_account: isFreeAccount ?? undefined,
            },
          );
          setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
          // The parent (opener) is the original preview surface that started the
          // connect flow, NOT the callback server's own origin — when the
          // env-configured gateway is used as the callback fallback (because
          // Builder rejects the preview host), the callback server and the
          // opener live on different origins, and postMessage to the gateway
          // origin would be dropped by the preview opener. callbackParentOrigin
          // is the precomputed best-available opener origin (`_an_opener` →
          // `preview-url` → event origin).
          return createBuilderBrowserCallbackPage(previewUrl, {
            parentOrigin: callbackParentOrigin,
          });
        }),
      );

      // POST /_agent-native/builder/disconnect — revoke the user's per-user
      // or org-scoped Builder credentials in app_secrets. Deploy-level env
      // credentials are never mutated here; if env is configured it remains as
      // the fallback after request-scoped credentials are removed.
      getH3App(nitroApp).use(
        `${P}/builder/disconnect`,
        defineEventHandler(async (event: H3Event) => {
          if (getMethod(event) !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          const session = await getSession(event).catch(() => null);
          if (!session?.email) {
            setResponseStatus(event, 401);
            return { error: "unauthorized" };
          }

          const { deleteBuilderCredentials } =
            await import("./credential-provider.js");

          // Mirror the connect-side scope decision so disconnect undoes
          // exactly what connect wrote: owner/admin connections land at
          // org scope and tear down at org scope; member or no-org
          // connections stay user-scoped on both ends. Symmetric, so a
          // single Disconnect press always reverses what the same user's
          // Connect press did.
          let orgId: string | null = null;
          let role: string | null = null;
          try {
            const { getOrgContext } = await import("../org/context.js");
            const orgCtx = await getOrgContext(event);
            orgId = orgCtx.orgId ?? null;
            role = orgCtx.role ?? null;
          } catch {
            /* org module not present — keep user scope */
          }

          try {
            await deleteBuilderCredentials(session.email, { orgId, role });
          } catch (err) {
            await trackBuilderLifecycle(
              event,
              "builder disconnect failed",
              session.email,
              {
                reason: "credential_delete_failed",
              },
            );
            setResponseStatus(event, 500);
            return {
              ok: false,
              error:
                "Could not remove Builder credentials — your connection is unchanged. Please retry.",
              cause: err instanceof Error ? err.message : String(err),
            };
          }

          await trackBuilderLifecycle(
            event,
            "builder disconnect succeeded",
            session.email,
          );
          return { ok: true };
        }),
      );

      // Proxy to Builder's agents-run API for background code changes.
      getH3App(nitroApp).use(
        `${P}/builder/agents-run`,
        defineEventHandler(async (event: H3Event) => {
          if (getMethod(event) !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }

          const session = await getSession(event).catch(() => null);
          if (!session?.email) {
            setResponseStatus(event, 401);
            return { error: "unauthorized" };
          }

          return runWithRequestContext(
            { userEmail: session.email, orgId: session.orgId ?? undefined },
            async () => {
              const { resolveBuilderCredentials: resolveCreds } =
                await import("./credential-provider.js");
              const creds = await resolveCreds();
              if (!creds.privateKey || !creds.publicKey) {
                setResponseStatus(event, 400);
                return {
                  error:
                    "Builder not connected. Connect Builder in Setup to use background agent.",
                };
              }
              const body = (await readBody(event)) as {
                userMessage?: string;
                branchName?: string;
                projectUrl?: string;
              };
              if (!body?.userMessage) {
                setResponseStatus(event, 400);
                return { error: "userMessage is required" };
              }
              const apiHost =
                process.env.BUILDER_API_HOST || "https://api.builder.io";
              try {
                const res = await fetch(
                  `${apiHost}/agents/run?apiKey=${encodeURIComponent(creds.publicKey)}`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${creds.privateKey}`,
                    },
                    body: JSON.stringify({
                      userMessage: {
                        userPrompt: body.userMessage,
                      },
                      branchName: body.branchName,
                    }),
                  },
                );
                if (!res.ok) {
                  const err = await res.text().catch(() => "Unknown error");
                  setResponseStatus(event, res.status);
                  return {
                    error: redactValues(err, [
                      creds.privateKey,
                      creds.publicKey,
                    ]),
                  };
                }
                return await res.json();
              } catch (err: any) {
                setResponseStatus(event, 500);
                return {
                  error: redactValues(
                    err?.message || "Failed to reach Builder agents-run API",
                    [creds.privateKey, creds.publicKey],
                  ),
                };
              }
            },
          );
        }),
      );

      // Env key management — framework keys are always included
      const frameworkEnvKeys = getFrameworkEnvKeys();
      {
        const envKeys = [...frameworkEnvKeys, ...(options.envKeys ?? [])];
        const allowedEnvKeyNames = envKeys.map(({ key }) => key);

        getH3App(nitroApp).use(
          `${P}/env-status`,
          defineEventHandler(async (event) => {
            const session = await getSession(event).catch(() => null);
            const userEmail = session?.email;
            let orgId: string | undefined;
            if (userEmail) {
              try {
                const orgCtx = await getOrgContext(event);
                orgId = orgCtx.orgId ?? undefined;
              } catch {
                /* org module not present in this template */
              }
            }
            return Promise.all(
              envKeys.map(async (cfg) => {
                const configured = await runWithRequestContext(
                  { userEmail, orgId },
                  () => resolveSecret(cfg.key).then(Boolean),
                );
                return {
                  key: cfg.key,
                  label: cfg.label,
                  required: cfg.required ?? false,
                  configured,
                  ...(cfg.helpText ? { helpText: cfg.helpText } : {}),
                };
              }),
            );
          }),
        );

        getH3App(nitroApp).use(
          `${P}/env-vars`,
          defineEventHandler(async (event: H3Event) => {
            if (getMethod(event) !== "POST") {
              setResponseStatus(event, 405);
              return { error: "Method not allowed" };
            }

            const body = await readBody(event);
            const { vars, scope } = body as {
              vars?: Array<{ key: string; value: string }>;
              scope?: ScopedKeySaveRequestScope;
            };
            const unsupportedKeys = findUnsupportedScopedKeyNames(
              vars,
              allowedEnvKeyNames,
            );
            if (unsupportedKeys.length > 0) {
              setResponseStatus(event, 400);
              return {
                error: `Unsupported env key${unsupportedKeys.length === 1 ? "" : "s"}: ${unsupportedKeys.join(", ")}`,
              };
            }

            try {
              const result = await saveKeyValuesToScopedSecrets(
                event,
                vars,
                scope,
              );
              return { saved: result.saved, storage: "scoped-secrets" };
            } catch (err) {
              if (err instanceof ScopedKeyStorageError) {
                setResponseStatus(event, err.statusCode);
                return { error: err.message };
              }
              setResponseStatus(event, 500);
              return { error: "Failed to save keys" };
            }
          }),
        );
      }

      getH3App(nitroApp).use(
        `${P}/agent-engine/api-key`,
        createAgentEngineApiKeyHandler(),
      );

      // GET /_agent-native/agent-engine/status — reports whether an engine
      // is configured (settings row, settings+env, or auto-detected from env).
      // The agent-chat UI uses this to skip the onboarding gate for providers
      // not in the env-status list (OpenRouter, Groq, Ollama, …).
      getH3App(nitroApp).use(
        `${P}/agent-engine/status`,
        defineEventHandler(async (event) => {
          try {
            const session = await getSession(event).catch(() => null);
            const userEmail = session?.email;
            let orgId: string | undefined;
            if (userEmail) {
              try {
                const orgCtx = await getOrgContext(event);
                orgId = orgCtx.orgId ?? undefined;
              } catch {
                /* org module not present in this template */
              }
            }
            const openAiBaseUrlConfigured = await runWithRequestContext(
              { userEmail, orgId },
              async () => {
                try {
                  if (await resolveSecret(OPENAI_BASE_URL_ENV_VAR)) return true;
                } catch {
                  /* fall through to deployment env when allowed */
                }
                return (
                  canUseDeployCredentialFallbackForRequest(
                    OPENAI_BASE_URL_ENV_VAR,
                  ) && !!readDeployCredentialEnv(OPENAI_BASE_URL_ENV_VAR)
                );
              },
            );
            const stored = (await getSetting("agent-engine")) as {
              engine?: string;
              model?: string;
            } | null;
            if (isAgentEngineSettingConfigured(stored)) {
              const engine = (stored as { engine: string }).engine;
              const entry = getAgentEngineEntry(engine);
              const model = normalizeAgentEngineStatusModel(
                entry,
                stored?.model,
              );
              return {
                configured: true,
                engine,
                model,
                source: "settings" as const,
                openAiBaseUrlConfigured,
              };
            }
            const envEntry = process.env.AGENT_ENGINE
              ? getAgentEngineEntry(process.env.AGENT_ENGINE)
              : undefined;
            if (envEntry) {
              const envUsable = await runWithRequestContext(
                { userEmail, orgId },
                () =>
                  isStoredEngineUsableForRequest(
                    { engine: envEntry.name },
                    envEntry,
                  ),
              );
              if (!envUsable) {
                return { configured: false, openAiBaseUrlConfigured };
              }
              return {
                configured: true,
                engine: envEntry.name,
                model: envEntry.defaultModel ?? DEFAULT_MODEL,
                source: "env" as const,
                envVar: "AGENT_ENGINE",
                openAiBaseUrlConfigured,
              };
            }
            // Per-user app_secrets — a user who connected Builder (or pasted
            // their own provider key) may not have any deploy-level env vars
            // set. Stored provider selections are checked first so saving a
            // BYOK engine can override an existing Builder connection.
            const detectedFromUser = await runWithRequestContext(
              { userEmail, orgId },
              () => detectEngineFromUserSecrets(),
            );
            if (stored && typeof stored.engine === "string") {
              const entry = getAgentEngineEntry(stored.engine);
              if (
                entry &&
                (await runWithRequestContext({ userEmail, orgId }, () =>
                  isStoredEngineUsableForRequest(stored, entry),
                ))
              ) {
                const model = normalizeAgentEngineStatusModel(
                  entry,
                  stored.model,
                );
                return {
                  configured: true,
                  engine: stored.engine,
                  model,
                  source: "env" as const,
                  envVar: entry.requiredEnvVars[0],
                  openAiBaseUrlConfigured,
                };
              }
            }
            if (detectedFromUser?.name === "builder") {
              return {
                configured: true,
                engine: detectedFromUser.name,
                model: detectedFromUser.defaultModel ?? DEFAULT_MODEL,
                source: "app_secrets" as const,
                envVar: detectedFromUser.requiredEnvVars[0],
                openAiBaseUrlConfigured,
              };
            }
            if (detectedFromUser) {
              return {
                configured: true,
                engine: detectedFromUser.name,
                model: detectedFromUser.defaultModel ?? DEFAULT_MODEL,
                source: "app_secrets" as const,
                envVar: detectedFromUser.requiredEnvVars[0],
                openAiBaseUrlConfigured,
              };
            }
            const detected = await runWithRequestContext(
              { userEmail, orgId },
              () => detectEngineFromEnv(),
            );
            if (detected) {
              return {
                configured: true,
                engine: detected.name,
                model: detected.defaultModel ?? DEFAULT_MODEL,
                source: "env" as const,
                envVar: detected.requiredEnvVars[0],
                openAiBaseUrlConfigured,
              };
            }
          } catch {}
          return { configured: false };
        }),
      );

      // POST /_agent-native/track — client-originated analytics events.
      // The browser `track()` helper POSTs `{ name, properties }` here so app
      // code can fan out to the SAME server-side providers (PostHog/Mixpanel/
      // etc.) that server `track()` reaches. Authenticated + first-party only:
      // the CSRF middleware above (mounted before route handlers) already
      // requires the X-Agent-Native-CSRF marker the client helper sends, and we
      // require a resolved session so this can't become an open relay. Events
      // are attributed to the resolved user/org — never a client-supplied id.
      // Best-effort: invalid bodies 400, everything else returns 204 and
      // provider errors are swallowed by the server `track()`.
      getH3App(nitroApp).use(
        `${P}/track`,
        defineEventHandler(async (event: H3Event) => {
          if (getMethod(event) !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          const session = await getSession(event).catch(() => null);
          const userEmail = session?.email;
          if (!userEmail) {
            setResponseStatus(event, 401);
            return { error: "Authentication required" };
          }
          const body = await readBody(event).catch(() => undefined);
          const validation = validateTrackPayload(body);
          if (!validation.ok) {
            setResponseStatus(event, 400);
            return { error: validation.error ?? "Invalid tracking payload." };
          }

          // Attribute to the active org when the template uses orgs. The
          // registry's `track()` only carries `userId` in meta, so org context
          // rides along in properties — every built-in provider forwards
          // `properties` verbatim. Client-supplied properties never override
          // the server-resolved `org_id`.
          let orgId: string | null = null;
          try {
            const orgCtx = await getOrgContext(event);
            orgId = orgCtx.orgId ?? null;
          } catch {
            /* org module not present in this template — keep userEmail-only */
          }

          const properties: Record<string, unknown> = {
            ...(validation.properties ?? {}),
            source: "client",
          };
          if (orgId) properties.org_id = orgId;

          // Best-effort — server `track()` swallows provider errors. We still
          // guard here so an unexpected throw can't surface to the browser.
          try {
            track(validation.name as string, properties, {
              userId: userEmail,
            });
          } catch {
            // best-effort
          }
          setResponseStatus(event, 204);
          return "";
        }),
      );

      // POST /_agent-native/agent-engine/disconnect — clear the agent-engine
      // setting. Env vars are left alone so the next chat turn falls back to
      // resolveEngine's env/default resolution.
      getH3App(nitroApp).use(
        `${P}/agent-engine/disconnect`,
        defineEventHandler(async (event: H3Event) => {
          if (getMethod(event) !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          const session = await getSession(event).catch(() => null);
          if (!session?.email) {
            setResponseStatus(event, 401);
            return { error: "unauthorized" };
          }
          try {
            await deleteSetting("agent-engine");
            return { ok: true };
          } catch (err) {
            setResponseStatus(event, 500);
            return {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );

      // GET/PUT/DELETE /_agent-native/agent-loop-settings — org/user-scoped
      // ceiling for tool-calling loop iterations before the agent asks whether
      // it should keep going.
      getH3App(nitroApp).use(
        `${P}/agent-loop-settings`,
        defineEventHandler(async (event: H3Event) => {
          const session = await getSession(event).catch(() => null);
          if (!session?.email) {
            setResponseStatus(event, 401);
            return { error: "unauthorized" };
          }

          const orgCtx = await getOrgContext(event).catch(() => null);
          const orgId = orgCtx?.orgId ?? session.orgId ?? null;
          const ctx = { userEmail: session.email, orgId };
          const canUpdate = await canUpdateAgentLoopSettings(
            session.email,
            orgId,
          );

          const withContext = async () => ({
            ...(await readAgentLoopSettings(ctx)),
            canUpdate,
            orgId,
            orgName: orgCtx?.orgName ?? null,
            role: orgCtx?.role ?? null,
          });

          const method = getMethod(event);
          if (method === "GET") {
            return withContext();
          }

          if (method === "PUT") {
            if (!canUpdate) {
              setResponseStatus(event, 403);
              return {
                error: orgId
                  ? "Only organization owners and admins can change the agent step limit."
                  : "You cannot change the agent step limit.",
              };
            }
            const body = await readBody(event).catch(() => ({}));
            const validation = validateMaxIterationsInput(
              (body as any)?.maxIterations,
            );
            if (validation.ok === false) {
              setResponseStatus(event, 400);
              return { error: validation.error };
            }
            const updated = await writeAgentLoopSettings(ctx, validation.value);
            return {
              ...updated,
              canUpdate,
              orgId,
              orgName: orgCtx?.orgName ?? null,
              role: orgCtx?.role ?? null,
            };
          }

          if (method === "DELETE") {
            if (!canUpdate) {
              setResponseStatus(event, 403);
              return {
                error: orgId
                  ? "Only organization owners and admins can reset the agent step limit."
                  : "You cannot reset the agent step limit.",
              };
            }
            const updated = await resetAgentLoopSettings(ctx);
            return {
              ...updated,
              canUpdate,
              orgId,
              orgName: orgCtx?.orgName ?? null,
              role: orgCtx?.role ?? null,
            };
          }

          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }),
      );

      // ─── Usage & cost summary ────────────────────────────────────────
      // GET /_agent-native/usage?sinceDays=30
      // Returns spend broken down by label, model, app, and day for the
      // current user. Powers the Usage section in the agent settings panel.
      getH3App(nitroApp).use(
        `${P}/usage`,
        defineEventHandler(async (event: H3Event) => {
          const session = await getSession(event).catch(() => null);
          if (!session?.email) {
            setResponseStatus(event, 401);
            return { error: "unauthorized" };
          }
          const sinceDaysParam = new URL(
            `${event.url?.pathname || "/"}${event.url?.search || ""}`,
            "http://x",
          ).searchParams.get("sinceDays");
          const sinceDays = Math.max(
            1,
            Math.min(365, Number(sinceDaysParam) || 30),
          );
          const { getUsageSummary, usageBillingForEngine } =
            await import("../usage/store.js");
          const [summary, engineName] = await Promise.all([
            getUsageSummary({
              ownerEmail: session.email,
              sinceMs: Date.now() - sinceDays * 86_400_000,
            }),
            detectUsageEngineName(event, session.email),
          ]);
          return {
            ...summary,
            billing: usageBillingForEngine(engineName),
          };
        }),
      );

      // ─── File upload primitive ──────────────────────────────────────
      // GET  /_agent-native/file-upload/status — report active provider
      // POST /_agent-native/file-upload        — upload a file, return { url }
      getH3App(nitroApp).use(
        `${P}/file-upload/status`,
        defineEventHandler(async (event) => {
          // resolveBuilderPrivateKey() reads per-user credentials from app_secrets
          // (DB), which requires request context (AsyncLocalStorage) to know which
          // user to scope by. Without runWithRequestContext() the ALS store is empty
          // and it falls back to process.env only — missing OAuth-connected users.
          const session = await getSession(event).catch(() => null);
          const userEmail = session?.email;
          const resolveStatus = async () => {
            const active = await getActiveFileUploadProviderForRequest();
            let builderConfigured = !!process.env.BUILDER_PRIVATE_KEY;
            try {
              const { resolveBuilderPrivateKey } =
                await import("./credential-provider.js");
              builderConfigured = await resolveBuilderPrivateKey().then(
                (k) => !!k,
              );
            } catch {
              // fall back to env check above
            }

            const providers = await Promise.all(
              listFileUploadProviders().map(async (p) => {
                const scopedConfigured = p.isConfiguredForRequest
                  ? await p.isConfiguredForRequest().catch(() => false)
                  : false;
                return {
                  id: p.id,
                  name: p.name,
                  configured: p.isConfigured() || scopedConfigured,
                };
              }),
            );

            // When the builder builtin is selected via env var, its sync
            // isConfigured() doesn't reflect per-user OAuth credentials. Use
            // builderConfigured so status reflects this specific request.
            const isBuilderEnvActive = active?.id === "builder";
            const configured = isBuilderEnvActive
              ? builderConfigured
              : !!active || builderConfigured;
            const activeProvider = isBuilderEnvActive
              ? builderConfigured
                ? { id: "builder", name: "Builder.io" }
                : null
              : active
                ? { id: active.id, name: active.name }
                : builderConfigured
                  ? { id: "builder", name: "Builder.io" }
                  : null;

            return {
              configured,
              activeProvider,
              providers,
              builderConfigured,
            };
          };

          return userEmail
            ? runWithRequestContext(
                { userEmail, orgId: session?.orgId },
                resolveStatus,
              )
            : resolveStatus();
        }),
      );

      getH3App(nitroApp).use(
        `${P}/file-upload`,
        defineEventHandler(async (event: H3Event) => {
          if (getMethod(event) !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          const parts = await readMultipartFormData(event);
          const filePart = parts?.find((p) => p.name === "file");
          if (!filePart?.data) {
            setResponseStatus(event, 400);
            return { error: "No file uploaded" };
          }

          // Reject files that exceed the upload size ceiling.
          if (filePart.data.length > DEFAULT_UPLOAD_MAX_FILE_BYTES) {
            setResponseStatus(event, 413);
            return {
              error: `File too large (max ${Math.round(DEFAULT_UPLOAD_MAX_FILE_BYTES / 1024 / 1024)} MB)`,
            };
          }

          // Reject executable/script MIME types.
          if (filePart.type && !isAllowedUploadMimeType(filePart.type)) {
            setResponseStatus(event, 415);
            return {
              error: `Unsupported file type: ${filePart.type}`,
            };
          }

          const session = await getSession(event);
          if (!session?.email) {
            setResponseStatus(event, 401);
            return { error: "Unauthorized" };
          }
          const userEmail = session.email;
          const result = await runWithRequestContext(
            { userEmail, orgId: session.orgId },
            () =>
              uploadFile({
                data: filePart.data,
                filename: filePart.filename,
                mimeType: filePart.type,
                ownerEmail: userEmail,
              }),
          );

          if (result) {
            setResponseStatus(event, 201);
            return result;
          }

          setResponseStatus(event, 503);
          return {
            error:
              "No file upload provider configured. Connect Builder.io in Settings → File uploads, or register a provider.",
          };
        }),
      );

      // ─── Voice transcription (Whisper) ───────────────────────────────
      // POST /_agent-native/transcribe-voice — multipart audio → text
      getH3App(nitroApp).use(
        `${P}/transcribe-voice`,
        createTranscribeVoiceHandler(),
      );

      // ─── Google realtime transcription session bridge ───────────────
      // POST /_agent-native/transcribe-stream/session — resolve the user's
      // Google service-account credential server-side, mint an opaque managed
      // streaming session in ai-services, and return the websocket URL.
      getH3App(nitroApp).use(
        `${P}/transcribe-stream/session`,
        createGoogleRealtimeSessionHandler(),
      );

      // ─── Voice provider status ───────────────────────────────────────
      // GET /_agent-native/voice-providers/status — which providers are
      // configured for the current user (powers the Settings UI pills).
      getH3App(nitroApp).use(
        `${P}/voice-providers/status`,
        createVoiceProvidersStatusHandler(),
      );

      // ─── Ad-hoc secrets (user-created keys) ────────────────────────────
      // Must mount before the generic /secrets handler to avoid shadowing.
      const adHocSecretHandler = createAdHocSecretHandler();
      getH3App(nitroApp).use(`${P}/secrets/adhoc`, adHocSecretHandler);

      // ─── Secrets registry ────────────────────────────────────────────
      // GET    /_agent-native/secrets              — list registered secrets + status
      // POST   /_agent-native/secrets/:key         — write a secret value
      // DELETE /_agent-native/secrets/:key         — remove a secret value
      // POST   /_agent-native/secrets/:key/test    — re-run the validator
      const listSecretsHandler = createListSecretsHandler();
      const writeSecretHandler = createWriteSecretHandler();
      const testSecretHandler = createTestSecretHandler();

      getH3App(nitroApp).use(
        `${P}/secrets`,
        defineEventHandler(async (event: H3Event) => {
          const pathname = (event.url?.pathname || "")
            .replace(/^\/+/, "")
            .replace(/\/+$/, "");
          const parts = pathname ? pathname.split("/") : [];

          // Collection root — list handler.
          if (parts.length === 0) {
            return listSecretsHandler(event);
          }

          // /:key/test — re-validate stored value.
          if (parts.length === 2 && parts[1] === "test") {
            return testSecretHandler(event);
          }

          // /:key — write / delete a specific secret.
          if (parts.length === 1) {
            return writeSecretHandler(event);
          }

          setResponseStatus(event, 404);
          return { error: "Not found" };
        }),
      );

      // ─── Notifications inbox ──────────────────────────────────────────
      // GET    /_agent-native/notifications[?unread&limit&before]
      // GET    /_agent-native/notifications/count
      // POST   /_agent-native/notifications/:id/read
      // POST   /_agent-native/notifications/read-all
      // DELETE /_agent-native/notifications/:id
      getH3App(nitroApp).use(
        `${P}/notifications`,
        createNotificationsHandler(),
      );

      // ─── Extensions (sandboxed mini-app runtime + proxy) ────────────────
      try {
        const { ensureExtensionsTables, registerExtensionsShareable } =
          await import("../extensions/store.js");
        const { createExtensionsHandler } =
          await import("../extensions/routes.js");
        ensureExtensionsTables().catch(() => {});
        registerExtensionsShareable();
        const extensionsHandler = createExtensionsHandler();
        getH3App(nitroApp).use(`${P}/extensions`, extensionsHandler);
        // Legacy alias — the previous public API was /_agent-native/tools/*.
        // Mounted in addition to /extensions/* so any deployed iframes mid-flight
        // (or external integrations bookmarked the old path) keep working.
        getH3App(nitroApp).use(`${P}/tools`, extensionsHandler);

        // Extension-point slots — sub-system of extensions.
        const { ensureSlotTables } =
          await import("../extensions/slots/store.js");
        const { createSlotsHandler } =
          await import("../extensions/slots/routes.js");
        ensureSlotTables().catch(() => {});
        getH3App(nitroApp).use(`${P}/slots`, createSlotsHandler());
      } catch {
        // Extensions module not available — skip
      }

      // ─── Data programs (stored server-side JS scripts + run cache) ─────
      try {
        const { ensureDataProgramTables, registerDataProgramsShareable } =
          await import("../data-programs/store.js");
        ensureDataProgramTables().catch(() => {});
        registerDataProgramsShareable();
      } catch {
        // Data programs module not available — skip
      }

      // ─── Page-level legacy redirect: /tools → /extensions ──────────────
      // Catches direct browser navigation / bookmarks for the old page route
      // (`/tools`, `/tools/:id`) and 302s to the renamed equivalent under
      // `/extensions`. The framework API alias above (`/_agent-native/tools/*`)
      // is intentionally untouched — it stays mounted in parallel.
      //
      // Mounted with no path so the helper can do its own base-path stripping
      // (h3 mount-matching only allows base-path stripping for `/_agent-native`
      // and `/.well-known`). Returns undefined to fall through for anything
      // that isn't a `/tools` page navigation.
      getH3App(nitroApp).use(
        defineEventHandler((event) => {
          const method = getMethod(event);
          if (method !== "GET" && method !== "HEAD") return;
          const rawPath =
            event.url?.pathname ??
            String(event.node?.req?.url ?? event.path ?? "/").split("?")[0];
          const search = event.url?.search ?? "";
          const target = resolveLegacyToolsRedirect(rawPath, search);
          if (!target) return;
          setResponseStatus(event, 302);
          setResponseHeader(event, "Location", target);
          return "";
        }),
      );

      // ─── Agent run progress ───────────────────────────────────────────
      // GET    /_agent-native/runs[?active&limit]
      // GET    /_agent-native/runs/:id
      // DELETE /_agent-native/runs/:id
      getH3App(nitroApp).use(`${P}/runs`, createProgressHandler());

      // ─── Automations API ──────────────────────────────────────────────
      // GET  /_agent-native/automations — list all automations (parsed triggers)
      // PATCH /_agent-native/automations — enable/disable a jobs/*.md automation
      // POST /_agent-native/automations/fire-test — emit test.event.fired
      getH3App(nitroApp).use(`${P}/automations`, createAutomationsHandler());

      // ─── Application State CRUD ──────────────────────────────────────
      // Auto-mounted so templates don't need boilerplate route files.

      // ─── User-scoped settings store ────────────────────────────────────
      // GET    /_agent-native/settings/:key   — read current user's value
      // PUT    /_agent-native/settings/:key   — write current user's value
      // DELETE /_agent-native/settings/:key   — clear current user's value
      //
      // Keys are auto-prefixed with `u:<email>:` so each user gets their
      // own row — no leakage between sessions sharing the same DB.
      getH3App(nitroApp).use(
        `${P}/settings`,
        defineEventHandler(async (event: H3Event) => {
          const rawKey =
            (event.url?.pathname || "").replace(/^\/+/, "").split("/")[0] || "";
          const key = rawKey.replace(/[^a-zA-Z0-9_-]/g, "");
          if (!key) {
            setResponseStatus(event, 404);
            return { error: "Settings key required" };
          }

          const session = await getSession(event);
          if (!session?.email) {
            setResponseStatus(event, 401);
            return { error: "unauthorized" };
          }

          const method = getMethod(event);
          const requestSource =
            (event.node?.req?.headers?.["x-request-source"] as
              | string
              | undefined) || undefined;

          if (method === "GET") {
            const value = await getUserSetting(session.email, key);
            if (!value) {
              setResponseStatus(event, 404);
              return { error: `No setting for ${key}` };
            }
            return value;
          }

          if (method === "PUT") {
            const body = await readBody(event);
            await putUserSetting(session.email, key, body, { requestSource });
            return body;
          }

          if (method === "DELETE") {
            await deleteUserSetting(session.email, key, { requestSource });
            return { ok: true };
          }

          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }),
      );

      // ─── Avatar routes ──────────────────────────────────────────────────
      // GET /_agent-native/avatar/:email — fetch any user's avatar (public)
      // PUT /_agent-native/avatar       — update current user's avatar (auth required)
      //
      // Only raster MIME types are accepted on write; SVG carries scripting risk
      // (data:image/svg+xml payloads can execute JS when rendered by browsers),
      // so it is explicitly excluded. Mirrors the SAFE_DATA_IMAGE allowlist in
      // packages/core/src/client/blocks/library/sanitize-html.ts.
      getH3App(nitroApp).use(
        `${P}/avatar`,
        defineEventHandler(async (event: H3Event) => {
          const method = getMethod(event);
          const emailParam = resolveAvatarEmailParam(
            event.url?.pathname || "",
            getConfiguredAppBasePath(),
          );

          if (method === "GET") {
            if (!emailParam) {
              setResponseStatus(event, 400);
              return { error: "email required" };
            }
            const data = await getSetting(
              `avatar:${decodeURIComponent(emailParam)}`,
            );
            return { image: (data as any)?.image ?? null };
          }

          if (method === "PUT") {
            const session = await getSession(event);
            if (!session?.email) {
              setResponseStatus(event, 401);
              return { error: "unauthorized" };
            }
            const body = await readBody(event);
            const { image } = body as { image?: string };
            if (!image || !AVATAR_RASTER_MIME.test(image)) {
              setResponseStatus(event, 400);
              return {
                error:
                  "image must be a data URI with a raster MIME type (png, jpeg, gif, or webp)",
              };
            }
            await putSetting(`avatar:${session.email}`, { image });
            return { ok: true };
          }

          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }),
      );

      if (!options.disableMcpConnect) {
        getH3App(nitroApp).use(
          "/.well-known/oauth-protected-resource",
          defineEventHandler((event: H3Event) =>
            handleMcpOAuthProtectedResourceMetadata(event),
          ),
        );
        getH3App(nitroApp).use(
          "/.well-known/oauth-authorization-server",
          defineEventHandler((event: H3Event) =>
            handleMcpOAuthAuthorizationServerMetadata(event),
          ),
        );
        getH3App(nitroApp).use(
          "/.well-known/openid-configuration",
          defineEventHandler((event: H3Event) =>
            handleMcpOAuthAuthorizationServerMetadata(event),
          ),
        );
        for (const mcpRoutePrefix of MCP_ROUTE_PREFIXES) {
          getH3App(nitroApp).use(
            `${mcpRoutePrefix}/oauth`,
            defineEventHandler(async (event: H3Event) => {
              const subpath = event.url?.pathname || "";
              return handleMcpOAuth(event, subpath, {
                appId: options.mcpConnectAppId,
                appName: options.mcpConnectAppName ?? getAppName(),
              });
            }),
          );
        }

        // Frictionless external-agent connection. A logged-in user mints a
        // per-user, scoped, revocable MCP bearer token here — via the browser
        // Connect page or the OAuth-style device-code flow a CLI drives — so
        // they never copy a shared deployment secret. The handler resolves the
        // browser session itself and serves its own login form (like /open)
        // for the page + unauth device endpoints; the /token, /device/authorize,
        // /tokens, /tokens/revoke subpaths require a session and 401 without it.
        // The auth guard bypasses ONLY the page + device/start + device/poll
        // (see createAuthGuardFn in auth.ts).
        const mcpConnectOpts = {
          appId: options.mcpConnectAppId,
          appName: options.mcpConnectAppName ?? getAppName(),
          serverName: options.mcpConnectServerName,
        };
        for (const mcpRoutePrefix of MCP_ROUTE_PREFIXES) {
          getH3App(nitroApp).use(
            `${mcpRoutePrefix}/connect`,
            defineEventHandler(async (event: H3Event) => {
              // The framework strips the mount prefix from event.url.pathname,
              // so what remains is the subpath after `/connect` (e.g. `/token`,
              // `/device/start`, or `` for the page itself).
              const subpath = event.url?.pathname || "";
              return handleMcpConnect(event, subpath, mcpConnectOpts);
            }),
          );
        }
      }

      // Cross-app SSO ("Sign in with Agent-Native") — CLIENT side. Mounted
      // ONLY when `AGENT_NATIVE_IDENTITY_HUB_URL` is set, so an unset env var
      // means the route is never even registered: zero new surface, existing
      // auth byte-for-byte unchanged. `/login` 302s to the identity hub;
      // `/callback` verifies the hub-issued A2A-signed identity JWT and JIT-
      // links the verified email into this app's local Better Auth store. The
      // handler 404s if disabled (defence in depth). The auth guard bypasses
      // these two exact paths under the same env gate.
      if (isIdentitySsoEnabled()) {
        getH3App(nitroApp).use(
          `${P}/identity`,
          defineEventHandler(async (event: H3Event) => {
            // Framework strips the mount prefix; what remains is the subpath
            // after `/identity` (e.g. `/login`, `/callback`).
            const subpath = event.url?.pathname || "";
            return handleIdentitySso(event, subpath);
          }),
        );
      }

      if (!options.disableOpenRoute) {
        // Stable deep-link route. External agents (MCP/A2A) surface
        // `/_agent-native/open?app=…&view=…&<recordId>=…` links; this resolves
        // the browser session, writes the one-shot `navigate` app-state command
        // the UI already drains, and 302s to the rendered SPA view. The auth
        // guard bypasses this exact path so it can serve its own login form.
        getH3App(nitroApp).use(
          `${P}/open`,
          createOpenRouteHandler({
            resolveOpenPath: options.resolveOpenPath,
            allowUnauthenticatedOpen: options.allowUnauthenticatedOpen,
          }),
        );
      }

      if (!options.disableEmbedRoute) {
        // One-time ticket launcher for MCP Apps that embed the full React app.
        // The ticket is minted by an authenticated MCP tool call and exchanged
        // here for a short-lived browser session cookie + bearer fallback.
        getH3App(nitroApp).use(
          `${P}/embed/start`,
          createEmbedStartRouteHandler({ getExistingSession: getSession }),
        );

        // POST /_agent-native/mcp/embed-error — telemetry sink for MCP App
        // embed shells. The shell runs in a sandboxed, opaque-origin iframe
        // (Codex, Cursor, ChatGPT, Claude) with no session cookie or CSRF
        // token, so this endpoint is intentionally unauthenticated and
        // CORS-open to the SAME sandbox origins as /embed/start. It forwards a
        // small, bounded diagnostic payload to Sentry via captureError so we
        // can see *why* an inline embed failed (handshake timeout, transplant
        // fetch status/CORS, auth, CSP) per host. Best-effort: always 204,
        // never throws, body capped, no client-trusted identity.
        getH3App(nitroApp).use(
          `${P}/mcp/embed-error`,
          defineEventHandler(async (event: H3Event) => {
            const origin = getHeader(event, "origin");
            if (origin && isMcpEmbedCorsOrigin(origin)) {
              setResponseHeader(event, "Access-Control-Allow-Origin", origin);
              setResponseHeader(event, "Vary", "Origin");
              setResponseHeader(
                event,
                "Access-Control-Allow-Methods",
                "POST,OPTIONS",
              );
              setResponseHeader(
                event,
                "Access-Control-Allow-Headers",
                MCP_EMBED_CORS_ALLOW_HEADERS,
              );
            }
            const method = getMethod(event);
            if (method === "OPTIONS") {
              setResponseStatus(event, 204);
              return "";
            }
            if (method !== "POST") {
              setResponseStatus(event, 405);
              return { error: "Method not allowed" };
            }
            const body = await readBody(event).catch(() => undefined);
            const rec =
              body && typeof body === "object" && !Array.isArray(body)
                ? (body as Record<string, unknown>)
                : {};
            const str = (value: unknown, max: number): string | undefined =>
              typeof value === "string" && value
                ? value.slice(0, max)
                : undefined;
            const message = str(rec.message, 500) ?? "MCP embed failed";
            try {
              captureError(new Error(message), {
                route: `${P}/mcp/embed-error`,
                method: "POST",
                userAgent:
                  str(rec.userAgent, 300) ?? getHeader(event, "user-agent"),
                tags: {
                  source: "mcp-embed-shell",
                  embed_stage: str(rec.stage, 60),
                  embed_render_mode: str(rec.renderMode, 40),
                  embed_host: str(rec.host, 160),
                  embed_bridge: str(rec.bridge, 40),
                },
                extra: {
                  embedUrl: str(rec.url, 600),
                  httpStatus:
                    typeof rec.status === "number"
                      ? rec.status
                      : str(rec.status, 40),
                  detail: str(rec.detail, 1200),
                  origin,
                },
              });
            } catch {
              // Observability must never throw back into the request path.
            }
            setResponseStatus(event, 204);
            return "";
          }),
        );
      }

      if (!options.disableAppState) {
        // Compose draft routes (more specific path, mounted first so the
        // generic app-state matcher below doesn't shadow them). The framework
        // strips the mount prefix from event.url.pathname before calling us,
        // so we just see e.g. `/abc-123` (id) or `/` (collection root).
        getH3App(nitroApp).use(
          `${P}/application-state/compose`,
          defineEventHandler(async (event: H3Event) => {
            const id =
              (event.url?.pathname || "").replace(/^\/+/, "").split("/")[0] ||
              "";
            if (event.context) {
              event.context.params = { ...event.context.params, id };
            }
            const method = getMethod(event);
            if (!id) {
              if (method === "GET") return listComposeDrafts(event);
              if (method === "DELETE") return deleteAllComposeDrafts(event);
            } else {
              if (method === "GET") return getComposeDraft(event);
              if (method === "PUT") return putComposeDraft(event);
              if (method === "DELETE") return deleteComposeDraft(event);
            }
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }),
        );

        // Generic application state — match `/application-state/:key` only
        // (NOT `/application-state/compose/...` which the handler above owns).
        getH3App(nitroApp).use(
          `${P}/application-state`,
          defineEventHandler(async (event: H3Event) => {
            const key =
              (event.url?.pathname || "").replace(/^\/+/, "").split("/")[0] ||
              "";
            // Skip — compose handler above already handled it
            if (key === "compose" || key === "") return;
            if (event.context) {
              event.context.params = { ...event.context.params, key };
            }
            const method = getMethod(event);
            if (method === "GET") return getState(event);
            if (method === "PUT") return putState(event);
            if (method === "DELETE") return deleteState(event);
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }),
        );
      }
      resolveInit();
    } catch (error) {
      rejectInit(error);
      throw error;
    }
  };
}

/**
 * Default core routes plugin — mount with no configuration needed.
 *
 * Usage in templates:
 * ```ts
 * // server/plugins/core-routes.ts
 * export { defaultCoreRoutesPlugin as default } from "@agent-native/core/server";
 * ```
 */
export const defaultCoreRoutesPlugin: NitroPluginDef = createCoreRoutesPlugin();
