import { createHash } from "node:crypto";

import {
  assertBodySize,
  defineEventHandler,
  setResponseStatus,
  setResponseHeader,
  getMethod,
  getHeader,
  getRequestURL,
  getRequestIP,
  readRawBody,
  getCookie,
  setCookie,
  deleteCookie,
} from "h3";
import type { H3Event } from "h3";
import { readMultipartFormData } from "h3";

import { DEFAULT_MODEL } from "../agent/default-model.js";
import { registerBuiltinEngines } from "../agent/engine/builtin.js";
import {
  OPENAI_BASE_URL_ENV_VAR,
  PROVIDER_ENV_META,
} from "../agent/engine/provider-env-vars.js";
import type { AgentEngineEntry } from "../agent/engine/registry.js";
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
import { getAppConfig } from "../app-config/index.js";
import {
  getState,
  putState,
  deleteState,
  listComposeDrafts,
  getComposeDraft,
  putComposeDraft,
  deleteComposeDraft,
  deleteAllComposeDrafts,
  getStateMany,
} from "../application-state/handlers.js";
import { mountBrowserSessionRoutes } from "../browser-sessions/routes.js";
import { mountDbAdminRoutes } from "../db-admin/routes.js";
import {
  getDbExec,
  isProductionServerlessFunctionRuntime,
  type DbExec,
} from "../db/client.js";
import {
  getDatabaseRuntimeFingerprint,
  getEffectiveDatabaseEnvStatus,
  getRuntimeDebugFingerprint,
  runDatabaseSchemaHealthCheck,
  type DatabaseSchemaHealthResult,
} from "../db/runtime-diagnostics.js";
import { ssrfSafeFetch } from "../extensions/url-safety.js";
import {
  uploadFile,
  getActiveFileUploadProviderForRequest,
  listFileUploadProviders,
  registerFileUploadProvider,
} from "../file-upload/index.js";
import { s3FileUploadProvider } from "../file-upload/s3.js";
import { handleMcpConnect } from "../mcp/connect-route.js";
import {
  handleMcpOAuth,
  handleMcpOAuthAuthorizationServerMetadata,
  handleMcpOAuthProtectedResourceMetadata,
} from "../mcp/oauth-route.js";
import { MCP_ROUTE_PREFIXES } from "../mcp/route-paths.js";
import {
  isSlackWebhookConfigured,
  registerBuiltinNotificationChannels,
} from "../notifications/channels.js";
import { createNotificationsHandler } from "../notifications/routes.js";
import { getOrgContext } from "../org/context.js";
import { createProgressHandler } from "../progress/routes.js";
import { decryptSecretValue, encryptSecretValue } from "../secrets/crypto.js";
import { registerFrameworkSecrets } from "../secrets/register-framework-secrets.js";
import {
  createListSecretsHandler,
  createWriteSecretHandler,
  createTestSecretHandler,
  createAdHocSecretHandler,
} from "../secrets/routes.js";
import {
  getSetting,
  putSetting,
  deleteSetting,
  mutateSetting,
  listSettingsByPrefix,
} from "../settings/store.js";
import {
  getUserSetting,
  putUserSetting,
  deleteUserSetting,
} from "../settings/user-settings.js";
import { ANALYTICS_CLIENT_PLATFORM_PROPERTY } from "../shared/analytics-platform.js";
import {
  EMPTY_SPECULATION_RULES,
  resolveSsrCacheHeaders,
} from "../shared/cache-control.js";
import { EMBED_TARGET_HEADER } from "../shared/embed-auth.js";
import { isGoogleProfileImageUrl } from "../shared/google-profile-image.js";
import { llmConnectionTrackingProperties } from "../shared/llm-connection.js";
import {
  EMBED_TRANSPLANT_HEADER,
  isMcpEmbedCorsOrigin,
  MCP_EMBED_CORS_ALLOW_HEADERS,
  shouldAllowMcpEmbedCredentials,
} from "../shared/mcp-embed-headers.js";
import { getRuntimeConfigReport } from "../shared/runtime-config.js";
import { captureException } from "../tracking/error-capture.js";
import { track } from "../tracking/index.js";
import { registerBuiltinProviders } from "../tracking/providers.js";
import { validateTrackPayload } from "../tracking/route.js";
import { createAutomationsHandler } from "../triggers/routes.js";
import { createAgentEngineApiKeyHandler } from "./agent-engine-api-key-route.js";
import {
  readAnalyticsClientPlatformHeader,
  readBrowserSessionIdHeader,
} from "./agent-run-context.js";
import { getConfiguredAppBasePath, stripAppBasePath } from "./app-base-path.js";
import { getSession, type AuthSession } from "./auth.js";
import {
  getBetterAuthInternalAdapter,
  getBetterAuthSync,
} from "./better-auth-instance.js";
import { resolveBuilderRequestAuthorization } from "./builder-api-auth.js";
import {
  BUILDER_CONNECT_PARAM,
  BUILDER_CONNECT_MODE_PARAM,
  BUILDER_AGENT_NATIVE_PROVISION_MODE,
  BUILDER_PROVISIONING_TOKEN_PARAM,
  BUILDER_CONNECT_ATTEMPT_PARAM,
  BUILDER_CONNECT_STATE_COOKIE,
  BUILDER_ENV_KEYS,
  BUILDER_OPENER_PARAM,
  BUILDER_RELAY_FLOW_HEADER,
  BUILDER_RELAY_SIGNATURE_HEADER,
  BUILDER_RELAY_STATE_PARAM,
  BUILDER_RELAY_TIMESTAMP_HEADER,
  appendBuilderConnectToken,
  appendBuilderConnectStateCookie,
  builderConnectTrackingProperties,
  createBuilderConnectState,
  createBuilderBrowserCallbackErrorPage,
  createBuilderBrowserCallbackPage,
  createBuilderRelayRequest,
  getBuilderConnectTrackingParams,
  getBuilderBrowserOriginForEvent,
  getBuilderBrowserStatusForEvent,
  isBuilderAccountAlreadyExistsError,
  isBuilderAccountProvisioningEnabled,
  isBuilderConnectCallbackUrlAllowed,
  isSignedBuilderConnectState,
  normalizeBuilderAgentContext,
  provisionBuilderAccount,
  resolveBuilderBranchProjectId,
  resolveBuilderConnectCallbackUrl,
  resolveBuilderConnectCallbackState,
  resolveBuilderPreviewRelayParentOrigin,
  removeBuilderConnectStateCookie,
  runBuilderAgent,
  verifyBuilderRelayRequest,
  verifyBuilderPreviewRelayStateForCallback,
  verifyBuilderConnectTokenAndGetOwner,
  signBuilderProvisioningToken,
  verifyBuilderProvisioningToken,
  withBuilderConnectTrackingParams,
  type BuilderConnectTrackingParams,
  type BuilderRelayCredentials,
  type BuilderPreviewRelayState,
} from "./builder-browser.js";
import {
  BUILDER_ASSETS_WRITE_SCOPE,
  BUILDER_OAUTH_SCOPE,
  deleteBuilderOAuthSession,
  exchangeBuilderOAuthAuthorization,
  getBuilderOAuthStoredScope,
  saveBuilderOAuthCredentials,
  startBuilderOAuthAuthorization,
  type BuilderOAuthPendingFlow,
} from "./builder-oauth.js";
import { captureError, registerErrorCaptureProvider } from "./capture-error.js";
import {
  resolveCoreRoutesMcpOptions,
  type CoreRoutesMcpOptions,
} from "./core-routes/mcp-connect-options.js";
import {
  getAllowedCorsOrigin,
  readCorsAllowedOrigins,
} from "./cors-origins.js";
import type { EnvKeyConfig } from "./create-server.js";
import {
  canUseDeployCredentialFallbackForRequest,
  CredentialStoreUnavailableError,
  prefetchSecrets,
  readDeployCredentialEnv,
  resolveSecret,
} from "./credential-provider.js";
import {
  readDatabaseIdentity,
  resolveRunningAppIdentity,
  type DatabaseIdentityReadResult,
} from "./database-identity.js";
import { probeDbPressure, type DbPressure } from "./db-pressure.js";
import {
  resolveDeployEnvironment,
  resolveServerRelease,
} from "./deploy-environment.js";
import { createEmbedStartRouteHandler } from "./embed-route.js";
import { shouldReportError } from "./error-noise-filter.js";
import {
  FRAMEWORK_AUTH_EARLY_PATHS,
  getH3App,
  awaitBootstrap,
  markDefaultPluginProvided,
  markFrameworkRoutesReadyBeforeBootstrap,
  trackPluginInit,
} from "./framework-request-handler.js";
import { createGatewayAccessCheckHandler } from "./gateway-access-check.js";
import {
  checkGoogleManagedCredential,
  checkGoogleSignInCredential,
} from "./google-credential-check.js";
import { getAppBasePath, getOrigin } from "./google-oauth.js";
import { createGoogleRealtimeSessionHandler } from "./google-realtime-session.js";
import {
  readBody,
  DEFAULT_UPLOAD_MAX_FILE_BYTES,
  isAllowedUploadMimeType,
} from "./h3-helpers.js";
import { handleIdentitySso } from "./identity-sso.js";
import { createOpenRouteHandler } from "./open-route.js";
import { createPollEventsHandler } from "./poll-events.js";
import { createPollHandler } from "./poll.js";
import {
  isHostedRealtimeTransport,
  realtimeRegistrationUnavailable,
} from "./realtime-registration.js";
import {
  createRealtimeTokenHandler,
  resolveActiveRealtimeChannel,
} from "./realtime-token.js";
import {
  getRequestContext,
  hasRequestContext,
  runWithRequestContext,
} from "./request-context.js";
import { isSameOriginRequest } from "./request-origin.js";
import {
  findUnsupportedScopedKeyNames,
  saveKeyValuesToScopedSecrets,
  ScopedKeyStorageError,
  type ScopedKeySaveRequestScope,
} from "./scoped-key-storage.js";
import { shouldDisableInProcessSweeps } from "./sweep-runtime.js";
import { createTranscribeVoiceHandler } from "./transcribe-voice.js";
import { createVoiceProvidersStatusHandler } from "./voice-providers-status.js";
import { createWorkspaceProviderOAuthHandler } from "./workspace-provider-oauth.js";

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

type AgentEngineStatusEntry = {
  name: string;
  defaultModel: string;
  supportedModels: readonly string[];
  requiredEnvVars: readonly string[];
};

export interface AgentEngineStatusResult {
  configured: boolean;
  engine?: string;
  model?: string;
  source?: "settings" | "env" | "app_secrets";
  envVar?: string;
  openAiBaseUrlConfigured?: boolean;
}

export interface AgentEngineStatusDeps<
  E extends AgentEngineStatusEntry = AgentEngineStatusEntry,
> {
  readStoredEngine: () => Promise<{ engine?: string; model?: string } | null>;
  readOpenAiBaseUrlConfigured: () => boolean | Promise<boolean>;
  isStoredEngineUsable: (
    stored: unknown,
    entry: E,
  ) => boolean | Promise<boolean>;
  detectFromUserSecrets: () => Promise<E | null>;
  detectFromEnv: () => E | null | Promise<E | null>;
  lookupEntry?: (engine: string) => E | undefined;
}

/**
 * Resolve "does this request have a usable AI provider" for one identity.
 *
 * Every call site pays for these lookups on a user-visible path (the agent
 * composer blocks on the status probe), so the two identity-independent reads
 * start together and the expensive `app_secrets` sweep only runs when the
 * cheaper sources have not already answered.
 */
export async function resolveAgentEngineStatus<
  E extends AgentEngineStatusEntry,
>(deps: AgentEngineStatusDeps<E>): Promise<AgentEngineStatusResult> {
  const lookupEntry = (deps.lookupEntry ?? getAgentEngineEntry) as (
    engine: string,
  ) => E | undefined;
  const [stored, openAiBaseUrlConfigured] = await Promise.all([
    deps.readStoredEngine(),
    deps.readOpenAiBaseUrlConfigured(),
  ]);

  if (isAgentEngineSettingConfigured(stored)) {
    const engine = (stored as { engine: string }).engine;
    const entry = lookupEntry(engine);
    return {
      configured: true,
      engine,
      model: normalizeAgentEngineStatusModel(entry, stored?.model),
      source: "settings",
      openAiBaseUrlConfigured,
    };
  }

  const configuredEngine = getAppConfig().agent.engine;
  const envEntry = configuredEngine ? lookupEntry(configuredEngine) : undefined;
  if (envEntry) {
    if (await deps.isStoredEngineUsable({ engine: envEntry.name }, envEntry)) {
      return {
        configured: true,
        engine: envEntry.name,
        model: envEntry.defaultModel ?? DEFAULT_MODEL,
        source: "env",
        envVar: "AGENT_ENGINE",
        openAiBaseUrlConfigured,
      };
    }
    if (getRequestContext()?.isSyntheticTraffic !== true) {
      return { configured: false, openAiBaseUrlConfigured };
    }
  }

  // Stored provider selections win over an existing Builder connection, so
  // this is checked before the app_secrets sweep — and the sweep is skipped
  // entirely when it answers.
  if (stored && typeof stored.engine === "string") {
    const entry = lookupEntry(stored.engine);
    if (entry && (await deps.isStoredEngineUsable(stored, entry))) {
      return {
        configured: true,
        engine: stored.engine,
        model: normalizeAgentEngineStatusModel(entry, stored.model),
        source: "env",
        envVar: entry.requiredEnvVars[0],
        openAiBaseUrlConfigured,
      };
    }
  }

  // Per-user app_secrets — a user who connected Builder (or pasted their own
  // provider key) may not have any deploy-level env vars set.
  const detectedFromUser = await deps.detectFromUserSecrets();
  if (detectedFromUser) {
    return {
      configured: true,
      engine: detectedFromUser.name,
      model: detectedFromUser.defaultModel ?? DEFAULT_MODEL,
      source: "app_secrets",
      envVar: detectedFromUser.requiredEnvVars[0],
      openAiBaseUrlConfigured,
    };
  }

  const detected = await deps.detectFromEnv();
  if (detected) {
    return {
      configured: true,
      engine: detected.name,
      model: detected.defaultModel ?? DEFAULT_MODEL,
      source: "env",
      envVar: detected.requiredEnvVars[0],
      openAiBaseUrlConfigured,
    };
  }

  return { configured: false, openAiBaseUrlConfigured };
}

function requestAgentEngineStatusDeps(): AgentEngineStatusDeps<AgentEngineEntry> {
  return {
    readStoredEngine: async () =>
      (await getSetting("agent-engine")) as {
        engine?: string;
        model?: string;
      } | null,
    readOpenAiBaseUrlConfigured: async () => {
      try {
        if (await resolveSecret(OPENAI_BASE_URL_ENV_VAR)) return true;
      } catch {
        /* fall through to deployment env when allowed */
      }
      return (
        canUseDeployCredentialFallbackForRequest(OPENAI_BASE_URL_ENV_VAR) &&
        !!readDeployCredentialEnv(OPENAI_BASE_URL_ENV_VAR)
      );
    },
    isStoredEngineUsable: isStoredEngineUsableForRequest,
    detectFromUserSecrets: detectEngineFromUserSecrets,
    detectFromEnv: detectEngineFromEnv,
  };
}

/**
 * Resolve the identity the status answer depends on. Both lookups memoize per
 * request inside their own helpers, so repeating them here stays cheap.
 */
async function resolveAgentEngineStatusIdentity(
  event: H3Event,
): Promise<{ userEmail: string | undefined; orgId: string | undefined }> {
  const session = await getSession(event).catch(() => null);
  const userEmail = session?.email;
  if (!userEmail) return { userEmail: undefined, orgId: undefined };
  try {
    const orgCtx = await getOrgContext(event);
    return { userEmail, orgId: orgCtx.orgId ?? undefined };
  } catch {
    /* org module not present in this template */
    return { userEmail, orgId: undefined };
  }
}

/**
 * Shared Builder grants stay org-scoped, but connect initiation can come from
 * any authenticated member. Revocation still needs owner/admin authority.
 * Capture the org id at connect start so the grant is stored under the org
 * that was authorized, not one re-resolved after the OAuth round trip.
 */
export async function resolveBuilderOrgMutation(
  event: H3Event,
  options: { allowMemberInitiation?: boolean } = {},
): Promise<{
  orgId: string | null;
  role: string | null;
  deny: string | null;
}> {
  let orgId: string | null = null;
  let role: string | null = null;
  try {
    const orgCtx = await getOrgContext(event);
    orgId = orgCtx.orgId ?? null;
    role = orgCtx.role ?? null;
  } catch {
    // coercion-ok: org is missing, it will fail closed
  }
  if (options.allowMemberInitiation) {
    if (orgId) return { orgId, role, deny: null };
    return {
      orgId,
      role,
      deny: "Only signed-in organization members can connect Builder.",
    };
  }
  if (role !== "owner" && role !== "admin") {
    return {
      orgId,
      role,
      deny: "Only an organization owner or admin can change the shared Builder connection.",
    };
  }
  return { orgId, role, deny: null };
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
/**
 * Deliberately generous: a genuinely cold Neon compute can take seconds to
 * accept its first connection, and reporting a slow-but-working database as
 * timed out would flap. This is a ceiling on hanging, not a latency budget.
 */
const DB_HEALTH_PROBE_DEADLINE_MS = 5_000;

export interface DbHealthProbeResult {
  /** The serverless function is live and served the request. */
  ok: true;
  /** Database + optional schema readiness for stricter production monitors. */
  ready: boolean;
  /** A trivial `SELECT 1` reached the database (false = no DB or unreachable). */
  db: boolean;
  /**
   * The probe hit its deadline instead of answering. Reported SEPARATELY from
   * `db: false`, because "the database said no" and "the database never
   * replied" are different failures and folding them together is exactly the
   * coercion this repo bans — a monitor cannot tell an app with no database
   * from one whose database is hanging.
   */
  dbTimedOut?: boolean;
  /** Round-trip time of the probe in milliseconds. */
  ms: number;
  /** Redacted database routing details useful for deploy/runtime checks. */
  database: {
    configured: boolean;
    source: string;
    urlHash?: string;
    /** Pooler-agnostic identity of the physical database — see getDatabaseRuntimeFingerprint(). */
    fingerprint?: string;
    appName?: string;
    netlifyDatabaseUrlConfigured: boolean;
    /**
     * Which app first recorded owning this database (the `beta.<app>`/`<app>`
     * pair share one). Present only when `db` is true — the read reuses the
     * connection the `SELECT 1` above just confirmed. `"timeout"` is its own
     * state distinct from `"unreadable"`: a hung read must never be reported
     * as "nothing recorded".
     */
    identity?: DatabaseIdentityReadResult | { state: "timeout" };
    /**
     * True only when `identity.state === "recorded"` and the recorded app
     * differs from the app running this probe. Every other identity state
     * reports `false` — "not confirmed mismatched", never "confirmed
     * matching".
     */
    identityMismatch?: boolean;
    /**
     * What this runtime believes its own app is (`app.slug ?? app.id`), or
     * `null` when the bundle cannot derive one. A null here is why a
     * mismatch cannot be claimed, and is itself a finding worth reading.
     */
    runningApp?: string | null;
  };
  /**
   * Hosted-realtime wiring, so a deploy can be verified without signing in.
   *
   * Registration is otherwise lazy behind the session-gated token mint, which
   * made "is this deploy actually on the gateway?" unanswerable until a real
   * user showed up. Resolving it here answers that with a curl — and, because
   * resolution registers on a miss, performs the registration too, the same way
   * this probe already warms a cold database.
   */
  realtime: {
    /** `"hosted"` only when the transport env var is set. */
    transport: "hosted" | "local";
    /** A channel resolved — injected by the pipeline, or self-registered. */
    registered: boolean;
    /**
     * First 8 chars of a SHA-256 of the channel id. This endpoint is public and
     * the channel id is half the gateway's auth story, so it is fingerprinted
     * rather than published — enough to tell two deploys apart or confirm a
     * rotation, useless for connecting. Mirrors `database.urlHash`.
     */
    channelHash?: string;
    /**
     * Resolution FAILED, reported separately from `registered: false`. On a
     * diagnostic endpoint the difference is the whole point: "this deploy has
     * no channel" and "we could not find out" send you to different places.
     * Same split as `dbTimedOut` above.
     */
    unavailable?: true;
  };
  /** Optional metadata-only schema compatibility check. */
  schema?: DatabaseSchemaHealthResult;
  /**
   * Optional `pg_stat_activity` pressure counters. Present only when asked for,
   * and shaped so "could not measure" cannot be read as "nothing wrong".
   */
  pressure?: DbPressure;
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
/**
 * Never throws and never blocks the probe: a gateway that is slow or refusing
 * must not make an app look unhealthy.
 *
 * `resolveActiveRealtimeChannel` is the one shared discriminator (see its
 * doc). Using anything looser here is not a cosmetic difference — resolution
 * REGISTERS on a miss, so a probe that fell back on half the rule would have
 * one anonymous curl of this public endpoint POST a pipeline app's database
 * credential to the gateway and start a duplicate channel tailing a database
 * Builder already tails.
 *
 * The network call bounds itself (4s abort, memo, single-flight, failure
 * backoff), but the DB reads on the way to it do not — hence the deadline the
 * caller wraps this in.
 */
async function resolveRealtimeHealth(): Promise<
  DbHealthProbeResult["realtime"]
> {
  const transport = isHostedRealtimeTransport() ? "hosted" : "local";
  if (transport === "local") return { transport, registered: false };
  let channelId: string | undefined;
  try {
    channelId = (await resolveActiveRealtimeChannel())?.projectId;
  } catch {
    return { transport, registered: false, unavailable: true };
  }
  if (!channelId) {
    // Self-registration fails soft to `null`, so the absence of a channel does
    // not say which kind of absence it is. Ask: a gateway we could not reach
    // is `unavailable`, an org that is not in the rollout is simply not
    // registered, and this endpoint exists to tell an operator which.
    return realtimeRegistrationUnavailable()
      ? { transport, registered: false, unavailable: true }
      : { transport, registered: false };
  }
  return {
    transport,
    registered: true,
    channelHash: createHash("sha256")
      .update(channelId)
      .digest("hex")
      .slice(0, 8),
  };
}

/**
 * Resolve `promise`, or `onTimeout` if it has not settled by the probe
 * deadline. The timer is always cleared: a pending one keeps a serverless
 * function alive past its response.
 */
async function withHealthDeadline<T>(
  promise: Promise<T>,
  onTimeout: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.catch(() => onTimeout),
      new Promise<T>((resolve) => {
        timer = setTimeout(
          () => resolve(onTimeout),
          DB_HEALTH_PROBE_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runDbHealthProbe(
  exec: () => { execute: (sql: string) => Promise<unknown> } = getDbExec,
  options: { schema?: boolean; pressure?: boolean } = {},
): Promise<DbHealthProbeResult> {
  const startedAt = Date.now();
  let db = false;
  let trivialQueryMs: number | undefined;
  let schema: DatabaseSchemaHealthResult | undefined;
  const dbExec = exec();
  let dbTimedOut = false;
  // Started BEFORE the DB probe, not awaited after it. Both read the database,
  // so running them in series charged every health check the realtime path's
  // whole latency — up to a 4s gateway POST on a cold isolate — for nothing.
  const realtimeProbe = resolveRealtimeHealth();
  try {
    // An UNBOUNDED await here is what took the docs site down: the health route
    // hung for 20-40s until the CDN returned 502, the keep-warm cron failed
    // every minute, and the function stayed permanently cold — a ~10x penalty
    // on every cache miss. This function's own contract says "Always
    // resolves"; without a deadline it did not.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("db probe deadline")),
        DB_HEALTH_PROBE_DEADLINE_MS,
      );
    });
    try {
      const trivialQueryStartedAt = Date.now();
      await Promise.race([dbExec.execute("SELECT 1"), deadline]);
      db = true;
      trivialQueryMs = Date.now() - trivialQueryStartedAt;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (err) {
    // Live even when the DB is unreachable or the app has no database.
    dbTimedOut = (err as Error)?.message === "db probe deadline";
  }
  if (db && options.schema) {
    schema = await runDatabaseSchemaHealthCheck({
      exec: dbExec as ReturnType<typeof getDbExec>,
    });
  }
  // Same bounded-read pattern as the `SELECT 1` above, and reuses this exact
  // connection rather than letting the settings store open its own — the
  // whole reason a mispointed database went unnoticed for 12 days is that
  // nothing reads this on the hot path. `"timeout"` is its own state,
  // returned distinctly from `withHealthDeadline`'s fallback below: a hung
  // read must never be reported as "nothing recorded".
  let identity: DatabaseIdentityReadResult | { state: "timeout" } | undefined;
  let identityMismatch: boolean | undefined;
  let runningApp: string | null | undefined;
  if (db) {
    identity = await withHealthDeadline<
      DatabaseIdentityReadResult | { state: "timeout" }
    >(
      readDatabaseIdentity(dbExec as DbExec).catch(
        (err): DatabaseIdentityReadResult => ({
          state: "unreadable",
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
      { state: "timeout" as const },
    );
    // Only "recorded" can ever prove a mismatch — the other three states mean
    // the check couldn't confirm one, not that it confirmed there wasn't.
    // And only a KNOWN running identity can disagree with the recorded one:
    // a hosted bundle that cannot derive its own slug/id must report the gap
    // (`runningApp: null`), not a mismatch that blocks every production
    // cutover — which is exactly what the first crm promotion did.
    runningApp = resolveRunningAppIdentity();
    identityMismatch =
      identity.state === "recorded" &&
      runningApp !== null &&
      identity.app !== runningApp;
  }
  const database = getDatabaseRuntimeFingerprint();
  // Measured on the connection `SELECT 1` just warmed, so the number reflects
  // the database's own load rather than a serverless cold start.
  let pressure: DbPressure | undefined;
  if (options.pressure) {
    pressure = db
      ? await probeDbPressure(dbExec, { trivialQueryMs })
      : { measured: false, reason: "database unreachable" };
  }
  // Same deadline, same reason as the `SELECT 1` above. `resolveRealtimeHealth`
  // reaches the gateway through the app's own database (the project-id lookup
  // and the stored-registration read), and those reads have no bound of their
  // own: against a black-holed Postgres the probe would time out on SELECT 1
  // and then hang here on the same dead pool — reintroducing the unbounded
  // /health await documented above, one layer down.
  const realtime = await withHealthDeadline(realtimeProbe, {
    transport: isHostedRealtimeTransport() ? "hosted" : "local",
    registered: false,
    unavailable: true,
  });
  return {
    ok: true,
    ready: db && (!schema || schema.ok),
    db,
    ...(dbTimedOut ? { dbTimedOut: true } : {}),
    ms: Date.now() - startedAt,
    realtime,
    database: {
      configured: database.configured,
      source: database.source,
      urlHash: database.urlHash,
      fingerprint: database.fingerprint,
      appName: database.appName,
      netlifyDatabaseUrlConfigured: database.netlifyDatabaseUrlConfigured,
      ...(identity ? { identity, identityMismatch, runningApp } : {}),
    },
    ...(schema ? { schema } : {}),
    ...(pressure ? { pressure } : {}),
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

export const BUILDER_STATUS_LEGACY_CREDENTIAL_KEYS = [
  "BUILDER_PRIVATE_KEY",
  "BUILDER_CMS_PRIVATE_KEY",
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
    const orgId = userEmail
      ? (await resolveAgentEngineStatusIdentity(event)).orgId
      : undefined;
    const status = await runWithRequestContext({ userEmail, orgId }, () =>
      resolveAgentEngineStatus({
        ...requestAgentEngineStatusDeps(),
        // Tracking only needs the engine name; skip the base-URL secret read.
        readOpenAiBaseUrlConfigured: () => false,
      }),
    );
    return status.engine ?? null;
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

function isAgentNativeAnonymousOwner(email: string | undefined): boolean {
  return /^anon-[^@]+@agent-native\.com$/i.test(email ?? "");
}

export function isBuilderConnectCallbackOwner(
  pendingOwner: string,
  sessionOwner: string | undefined,
): boolean {
  return Boolean(sessionOwner && sessionOwner === pendingOwner);
}

export async function consumeBuilderConnectPendingState(
  state: string,
  dependencies: {
    mutate: typeof mutateSetting;
    remove: typeof deleteSetting;
  } = { mutate: mutateSetting, remove: deleteSetting },
): Promise<Record<string, unknown> | null> {
  if (!isSignedBuilderConnectState(state)) return null;
  const pendingKey = `builder-connect-pending:${state}`;
  try {
    const pending = await dependencies.mutate(pendingKey, (current) => {
      if (!current || current.consumed === true) {
        throw new Error("Builder connect flow is missing or consumed.");
      }
      return { ...current, consumed: true, consumedAt: Date.now() };
    });
    await dependencies.remove(pendingKey).catch(() => false); // coercion-ok: row already marked consumed; delete is cleanup
    return pending;
  } catch {
    // coercion-ok: missing, consumed, or unreadable pending rows all deny the
    // callback the same way so attackers cannot probe storage errors.
    return null;
  }
}

export async function readBuilderConnectPendingState(
  state: string,
  read: typeof getSetting = getSetting,
): Promise<Record<string, unknown> | null> {
  if (!isSignedBuilderConnectState(state)) return null;
  try {
    const pending = await read(`builder-connect-pending:${state}`);
    if (!pending || pending.consumed === true) return null;
    return pending;
  } catch {
    // coercion-ok: missing, consumed, or unreadable pending rows all deny the
    // callback the same way so attackers cannot probe storage errors.
    return null;
  }
}

const BUILDER_CONNECT_PENDING_PREFIX = "builder-connect-pending:";

export async function purgeExpiredBuilderConnectPendingStates(
  now = Date.now(),
  dependencies: {
    list: typeof listSettingsByPrefix;
    remove: typeof deleteSetting;
  } = { list: listSettingsByPrefix, remove: deleteSetting },
): Promise<number> {
  const rows = await dependencies.list(BUILDER_CONNECT_PENDING_PREFIX);
  let deleted = 0;
  for (const row of rows) {
    const expiresAt = row.value.expiresAt;
    if (typeof expiresAt === "number" && expiresAt > now) continue;
    const removed = await dependencies.remove(row.key).catch(() => false); // coercion-ok: expired pending cleanup is best-effort; a failed delete is retried on the next connect
    if (removed) deleted += 1;
  }
  return deleted;
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
  const searchParams = getFrameworkRouteRequestUrl(event).searchParams;
  // OAuth callback is session-bound; only the connect trampoline still uses a
  // signed connect token for anonymous docs/app popup ownership.
  const signedOwner =
    mode === "connect"
      ? verifyBuilderConnectTokenAndGetOwner(
          searchParams.get(BUILDER_CONNECT_PARAM),
        )
      : null;
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
  /**
   * Allow authenticated extension creation through
   * POST /_agent-native/extensions (and the legacy /tools alias).
   * Existing extension runtime, read, edit, and deep-link routes stay mounted
   * when this is false. Default: false.
   */
  extensionTools?: boolean;
  /** Route path for the SSE endpoint. Default: "/_agent-native/events" */
  sseRoute?: string;
  /** Disable the SSE endpoint entirely. */
  disableSSE?: boolean;
  /** Disable the /_agent-native/ping health check. */
  disablePing?: boolean;
  /** Disable the /_agent-native/health DB liveness + warmup probe. */
  disableHealth?: boolean;
  /**
   * Callback paths emitted by this app's Google OAuth health contract. The
   * default is the shared framework callback; app-owned callbacks must opt in
   * so fleet probes read the deployed app instead of guessing from a hostname.
   */
  googleOAuthCallbackPaths?: string[];
  /** Whether the managed Google client is deployment- or user-scoped. */
  googleOAuthCredentialMode?: "managed" | "user";
  /**
   * Whether this app exposes deployment-level Google workspace OAuth. Custom
   * core-route plugins must declare this; the framework default declares that
   * managed OAuth is not applicable.
   */
  googleOAuthManagedConnection?: "required" | "not_applicable";
  /** Disable the /_agent-native/application-state routes. */
  disableAppState?: boolean;
  /** Disable the /_agent-native/open deep-link route. */
  disableOpenRoute?: boolean;
  /** Disable the /_agent-native/embed/start iframe session launcher. */
  disableEmbedRoute?: boolean;
  /**
   * Everything about this app's MCP connect surface — whether the Connect page
   * and OAuth endpoints are mounted, and the server id clients key it by.
   * See `CoreRoutesMcpOptions`.
   *
   * Replaces the top-level `disableMcpConnect`, `mcpConnectServerName`,
   * `mcpConnectAppId`, and `mcpConnectAppName`, which stay accepted for one
   * minor. Setting both forms to disagreeing values throws at plugin init
   * rather than silently picking one.
   */
  mcp?: CoreRoutesMcpOptions;

  /** @deprecated Use `mcp.connect: false`. */
  disableMcpConnect?: boolean;
  /** @deprecated Use `mcp.serverName`. */
  mcpConnectServerName?: string;
  /** @deprecated Set `app.id` in `defineAppConfig()`. */
  mcpConnectAppId?: string;
  /** @deprecated Set `app.name` in `defineAppConfig()`. */
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

const DEFAULT_GOOGLE_OAUTH_CALLBACK_PATH = "/_agent-native/google/callback";
const GOOGLE_OAUTH_CALLBACK_PATH_PATTERN =
  /^\/_agent-native\/[A-Za-z0-9._/-]+\/callback$/;

function normalizeGoogleOAuthCallbackPaths(paths?: string[]): string[] {
  const values = [...new Set(paths ?? [DEFAULT_GOOGLE_OAUTH_CALLBACK_PATH])];
  if (
    values.length === 0 ||
    values.some((value) => !GOOGLE_OAUTH_CALLBACK_PATH_PATTERN.test(value))
  ) {
    throw new Error(
      "googleOAuthCallbackPaths must contain /_agent-native/*/callback paths.",
    );
  }
  return values;
}

interface LegacyCoreRouteInitSettings {
  persistedEnvVars: Record<string, string> | null;
  builderDisconnected: { at?: number } | null;
}

type CoreRouteSettingReader = (
  key: string,
) => Promise<Record<string, unknown> | null>;

export async function readLegacyCoreRouteInitSettings(
  readSetting: CoreRouteSettingReader = getSetting,
): Promise<LegacyCoreRouteInitSettings> {
  const readOrNull = async (key: string) => {
    try {
      return await readSetting(key);
    } catch {
      return null;
    }
  };
  const [persistedEnvVars, builderDisconnected] = await Promise.all([
    readOrNull("persisted-env-vars"),
    readOrNull("builder-disconnected"),
  ]);
  return {
    persistedEnvVars: persistedEnvVars as Record<string, string> | null,
    builderDisconnected: builderDisconnected as { at?: number } | null,
  };
}

/**
 * Production release jobs own schema setup. Request functions must not spend
 * their cold-start budget on legacy cleanup or best-effort table warmups.
 */
export function shouldRunCoreRouteBootDatabaseWork(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !isProductionServerlessFunctionRuntime(env);
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
 *   GET    /_agent-native/ping                          — health check; add ?configuration=1 for redacted deploy diagnostics
 *   GET    /_agent-native/health                        — DB liveness probe + scale-to-zero warmup
 *   GET    /_agent-native/env-status                    — env key configuration status (when envKeys provided)
 *   POST   /_agent-native/env-vars                      — compatibility route that saves keys to scoped DB secrets
 *   GET    /_agent-native/application-state?keys=a,b,c  — batched read of many keys
 *   GET    /_agent-native/application-state/:key        — read application state
 *   PUT    /_agent-native/application-state/:key        — write application state
 *   DELETE /_agent-native/application-state/:key        — delete application state
 *   GET    /_agent-native/application-state/compose     — list compose drafts
 *   DELETE /_agent-native/application-state/compose     — delete all compose drafts
 *   GET    /_agent-native/application-state/compose/:id — get compose draft
 *   PUT    /_agent-native/application-state/compose/:id — upsert compose draft
 *   DELETE /_agent-native/application-state/compose/:id — delete compose draft
 */
/**
 * Route every Nitro route error through the provider-agnostic `captureError()`
 * registry, filtered by the shared noise rules.
 *
 * This lives here rather than in `sentry-plugin.ts` because that plugin bails
 * out when no `SENTRY_DSN` is configured — wiring the hook there meant an app
 * running PostHog (or any other backend) with no Sentry project reported no
 * route errors at all, while still looking configured.
 */
function wireRouteErrorCapture(nitroApp: any): void {
  nitroApp.hooks?.hook?.(
    "error",
    (error: unknown, ctx?: { event?: H3Event }) => {
      try {
        const event = ctx?.event;
        const route = (() => {
          try {
            return event?.url?.pathname;
            // coercion-ok: a missing route tag must not suppress the error
          } catch {
            return undefined;
          }
        })();
        const userAgent = (() => {
          try {
            return event ? getHeader(event, "user-agent") : undefined;
            // coercion-ok: a missing UA tag must not suppress the error
          } catch {
            return undefined;
          }
        })();

        if (!shouldReportError(error, { tags: { route } })) return;

        captureError(error, {
          route,
          method: event ? getMethod(event) : undefined,
          userAgent,
        });
        // coercion-ok: rethrowing here would replace the app's real error
      } catch {
        // Error reporting must never escape into Nitro's error path.
      }
    },
  );
}

export function ensureS3FileUploadProvider(): void {
  if (
    listFileUploadProviders().some(
      (provider) => provider.id === s3FileUploadProvider.id,
    )
  ) {
    return;
  }
  registerFileUploadProvider(s3FileUploadProvider);
}

export interface OAuthCustodyBuilderKeyStatus {
  privateKeyConfigured: boolean;
  publicKeyConfigured: boolean;
  orgName: string;
  /**
   * True when the key-pair lookup itself failed (credential store
   * unreadable, org lookup error, a thrown import) rather than confirming
   * no keys exist. privateKeyConfigured/publicKeyConfigured stay `false` in
   * both cases — this is the only signal that tells "never configured"
   * apart from "couldn't check right now", so a transient store blip can't
   * read downstream as "the user never connected Builder keys".
   */
  keyLookupFailed: boolean;
}

/**
 * Resolves the classic Builder key-pair status for a request that already
 * has Builder MCP OAuth custody (the connection-status handler's `configured`
 * is already `true` by the time this runs — OAuth alone proves the chat
 * gateway). Exported so the connection-status route's OAuth-custody branch is
 * unit-testable without standing up the full plugin.
 */
export async function resolveOAuthCustodyBuilderKeyStatus(
  dependencies: {
    resolveCredentialsDetailed: () => Promise<{
      privateKey: string | null;
      publicKey: string | null;
      orgName: string | null;
      lookupFailed: boolean;
    }>;
  } = {
    resolveCredentialsDetailed: async () => {
      const { resolveBuilderCredentialsDetailed } =
        await import("./credential-provider.js");
      return resolveBuilderCredentialsDetailed();
    },
  },
): Promise<OAuthCustodyBuilderKeyStatus> {
  try {
    const creds = await dependencies.resolveCredentialsDetailed();
    return {
      privateKeyConfigured: !!creds.privateKey,
      publicKeyConfigured: !!creds.publicKey,
      orgName:
        typeof creds.orgName === "string" && creds.orgName
          ? creds.orgName
          : "Builder OAuth",
      keyLookupFailed: creds.lookupFailed,
    };
  } catch {
    // OAuth already proves the chat gateway, so a thrown key-pair lookup
    // here must not abort the response — but it is unreadable, not
    // confirmed-absent, so keyLookupFailed has to say so (see the field doc
    // above) instead of silently landing on the same `false`s as a real miss.
    return {
      privateKeyConfigured: false,
      publicKeyConfigured: false,
      orgName: "Builder OAuth",
      keyLookupFailed: true,
    };
  }
}

export function createCoreRoutesPlugin(
  options: CoreRoutesPluginOptions = {},
): NitroPluginDef {
  const googleOAuthCallbackPaths = normalizeGoogleOAuthCallbackPaths(
    options.googleOAuthCallbackPaths,
  );
  const googleOAuthCredentialMode =
    options.googleOAuthCredentialMode ?? "managed";
  const googleOAuthManagedConnection =
    options.googleOAuthManagedConnection ?? "unknown";
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
      // Liveness and BYOA auth routes are mounted before the DB-dependent
      // bootstrap below. The broad core entry must not hold those routes while
      // an unrelated migration or connection pool is unavailable.
      excludedPaths: [
        `${FRAMEWORK_ROUTE_PREFIX}/ping`,
        `${FRAMEWORK_ROUTE_PREFIX}/health`,
        `${FRAMEWORK_ROUTE_PREFIX}/identity`,
        `${FRAMEWORK_ROUTE_PREFIX}/embed/start`,
        ...FRAMEWORK_AUTH_EARLY_PATHS,
      ],
    });
    try {
      const P = FRAMEWORK_ROUTE_PREFIX;
      markFrameworkRoutesReadyBeforeBootstrap(nitroApp, [
        ...(!options.disablePing ? [`${P}/ping`] : []),
        ...(!options.disableHealth ? [`${P}/health`] : []),
        `${P}/identity`,
        ...(!options.disableEmbedRoute ? [`${P}/embed/start`] : []),
      ]);

      // Keep the framework-owned S3-compatible provider available even when an
      // app does not mount the optional onboarding plugin. The settings CTA and
      // the upload route share this registry. An app may register its own
      // provider under the conventional `s3` id, so preserve that explicit
      // registration instead of replacing it during core bootstrap.
      ensureS3FileUploadProvider();

      // This response is a side-effect-free static contract used by the SSR
      // shell. Mount it before optional default-plugin/bootstrap work so a
      // browser's automatic rules fetch cannot inherit the cold-start wait.
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
            resolveSsrCacheHeaders(),
          )) {
            setResponseHeader(event, name, value);
          }
          return EMPTY_SPECULATION_RULES;
        }),
      );

      // Keep liveness independent from the rest of framework bootstrap. A
      // cold-start database failure must report a useful ping/health result,
      // not prevent these handlers from being registered at all.
      if (!options.disablePing) {
        getH3App(nitroApp).use(
          `${P}/ping`,
          defineEventHandler((event) => {
            const message = getAppConfig().app.pingMessage;
            const configuration =
              event.url?.searchParams.get("configuration") === "1" ||
              event.url?.searchParams.get("configuration") === "true";
            if (!configuration) return { message };

            const requirements = {
              ...(event.url?.searchParams.get("auth") === "0"
                ? { authEnabled: false }
                : {}),
              ...(event.url?.searchParams.get("database") === "0"
                ? { databaseRequired: false }
                : {}),
            };
            return {
              message,
              configuration: getRuntimeConfigReport(process.env, requirements, {
                phase: "runtime",
                appName: getAppConfig().app.name,
              }),
            };
          }),
        );
      }

      if (!options.disableHealth) {
        // Registered before `/health` because h3 matches by prefix, and the
        // health handler would otherwise swallow this path.
        // Resolved once per process — the deployment's own CONFIGURED
        // canonical origin (never the current request's), so a probe result
        // can't be spoofed via a Host header, and matches what the callback
        // route itself builds (resolveOAuthRedirectUri / getAppUrl) for the
        // default sign-in callback path.
        const googleHealthOrigin = await (async () => {
          try {
            const { getAppProductionUrl } = await import("./app-url.js");
            return getAppProductionUrl();
          } catch (err) {
            console.warn(
              "[health] could not resolve configured origin for Google redirect URI probe:",
              err,
            );
            return undefined;
          }
        })();
        getH3App(nitroApp).use(
          `${P}/health/google`,
          defineEventHandler(async (event) => {
            setResponseHeader(event, "cache-control", "no-store");
            const googleRedirectUri = googleHealthOrigin
              ? `${googleHealthOrigin}${googleOAuthCallbackPaths[0]}`
              : undefined;
            const isManaged =
              event.url?.searchParams.get("client") === "managed";
            const result = isManaged
              ? googleOAuthManagedConnection === "not_applicable"
                ? {
                    status: "unconfigured" as const,
                    clientId: null,
                    mismatchedPairs: false,
                    credentialSource: "none" as const,
                    reason:
                      "this app does not expose deployment-level Google OAuth",
                    redirectUriStatus: "unknown" as const,
                    redirectUri: null,
                    checkedAt: Date.now(),
                  }
                : googleOAuthCredentialMode === "user"
                  ? {
                      status: "unconfigured" as const,
                      clientId: null,
                      mismatchedPairs: false,
                      credentialSource: "user" as const,
                      reason:
                        "user-scoped OAuth credentials are checked after authentication",
                      redirectUriStatus: "unknown" as const,
                      redirectUri: null,
                      checkedAt: Date.now(),
                    }
                  : await checkGoogleManagedCredential({
                      redirectUri: googleRedirectUri,
                    })
              : await checkGoogleSignInCredential({
                  redirectUri: googleRedirectUri,
                });
            // `invalid` is the fleet-wide outage shape: the deploy is up and
            // healthy while nobody can sign in. Page on it. A registered
            // client/secret with a mismatched redirect URI is the same
            // outage from the browser's side — Google rejects the callback
            // before this app ever sees a code — so page on that too. Gate
            // the managed pair's mismatch on managedConnection === "required":
            // an app that only declares managed OAuth as optional/unknown may
            // legitimately have no redirect URI registered for it yet.
            //
            // NOTE: mismatchedPairs:true together with
            // redirectUriStatus:"registered" is the EXPECTED shape for
            // managedConnection:"required" apps that intentionally run
            // sign-in and managed workspace OAuth as two different Google
            // clients — never page on mismatchedPairs alone.
            const shouldPage =
              result.status === "invalid" ||
              (result.redirectUriStatus === "mismatched" &&
                (!isManaged || googleOAuthManagedConnection === "required"));
            if (shouldPage) setResponseStatus(event, 503);
            return {
              ...result,
              callbackPaths: googleOAuthCallbackPaths,
              credentialMode: googleOAuthCredentialMode,
              managedConnection: googleOAuthManagedConnection,
            };
          }),
        );
        // Resolved once per process, not per request — this is the
        // deployment's own CONFIGURED canonical host (env var / first-party
        // template prodUrl / platform-injected URL), never the current
        // request's origin, or a mismatch could never be observed.
        const healthBaseUrlHost = await (async () => {
          try {
            const { getAppProductionUrl } = await import("./app-url.js");
            return (
              new URL(getAppProductionUrl()).hostname.toLowerCase() || undefined
            );
          } catch (err) {
            console.warn(
              "[health] could not resolve configured base URL host:",
              err,
            );
            return undefined;
          }
        })();
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
              getAppConfig().app.healthStrictSchema;
            const pressure =
              event.url?.searchParams.get("pressure") === "1" ||
              event.url?.searchParams.get("pressure") === "true";
            const result = await runDbHealthProbe(getDbExec, {
              schema,
              pressure,
            });
            if (strict && !result.ready) setResponseStatus(event, 503);
            const requestHost =
              getRequestURL(event).hostname.toLowerCase() || undefined;
            return {
              ...result,
              auth: {
                baseUrlHost: healthBaseUrlHost,
                requestHost,
                hostMismatch: Boolean(
                  healthBaseUrlHost &&
                  requestHost &&
                  healthBaseUrlHost !== requestHost,
                ),
              },
              // Informational only — an unconfigured webhook never fails
              // health. It answers "would the next chat outage page anyone",
              // since chat-health-alert.ts silently no-ops without it.
              alerts: {
                chatHealthSlackWebhookConfigured: isSlackWebhookConfigured(),
              },
            };
          }),
        );
      }

      // Security headers, CORS, and the workspace-app handshake routes
      // (`/identity`, `/embed/start`) are registered here, before
      // `awaitBootstrap`, on the same precedent as `/ping` and `/health`
      // above: a cold function makes the desktop/mobile shell's embed
      // handshake wait on the whole DB-dependent bootstrap chain below for
      // no reason, when nothing here needs it — only lazy singletons
      // (getDbExec, getBetterAuth, getAppConfig, readCorsAllowedOrigins)
      // that initialize on first use. h3 dispatches middleware in
      // registration order, so security headers and CORS must be mounted
      // before these routes, not after.

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

      // Cross-app SSO ("Sign in with Agent-Native") — CLIENT side. `/login`
      // 302s to the identity hub;
      // `/callback` verifies the hub-issued A2A-signed identity JWT and JIT-
      // links the verified email into this app's local Better Auth store. The
      // handler fails closed unless direct web SSO is configured or the
      // packaged Desktop SSO Canary requests a canonical Agent-Native app.
      // Mounting the handler unconditionally lets that request-scoped decision
      // work.
      getH3App(nitroApp).use(
        `${P}/identity`,
        defineEventHandler(async (event: H3Event) => {
          // Framework strips the mount prefix; what remains is the subpath
          // after `/identity` (e.g. `/login`, `/callback`).
          const subpath = event.url?.pathname || "";
          return handleIdentitySso(event, subpath);
        }),
      );

      if (!options.disableEmbedRoute) {
        // One-time ticket launcher for MCP Apps that embed the full React app.
        // The ticket is minted by an authenticated MCP tool call and exchanged
        // here for a short-lived browser session cookie + bearer fallback.
        getH3App(nitroApp).use(
          `${P}/embed/start`,
          createEmbedStartRouteHandler({ getExistingSession: getSession }),
        );
      }

      await awaitBootstrap(nitroApp);

      const runBootDatabaseWork = shouldRunCoreRouteBootDatabaseWork();
      const { persistedEnvVars, builderDisconnected } = runBootDatabaseWork
        ? await readLegacyCoreRouteInitSettings()
        : { persistedEnvVars: null, builderDisconnected: null };

      // Legacy cleanup: key saves now go to scoped app_secrets rows. Do not
      // rehydrate the old deployment-global `persisted-env-vars` row into
      // process.env; keep only the Builder scrub so stale leaked keys self-heal.
      try {
        if (persistedEnvVars) {
          const builderKeys = new Set<string>(BUILDER_ENV_KEYS);
          let scrubbed = 0;
          for (const k of Object.keys(persistedEnvVars)) {
            if (builderKeys.has(k)) {
              scrubbed++;
            }
          }
          if (scrubbed > 0) {
            try {
              const cleaned: Record<string, string> = {};
              for (const [k, v] of Object.entries(persistedEnvVars)) {
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
        if (builderDisconnected) {
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
      // Named for the destination it actually reaches: every configured
      // tracking provider (PostHog, Mixpanel, Amplitude, Agent-Native
      // Analytics, webhook), not just one of them.
      registerErrorCaptureProvider("tracking", (error, context) => {
        // Attribute to the in-flight request's user so server exceptions and
        // that same person's browser events share one `distinct_id`.
        const requestContext = hasRequestContext()
          ? getRequestContext()
          : undefined;
        captureException(error, {
          ...context,
          handled: false,
          runtime: "node",
          source: "server",
          release: resolveServerRelease(),
          environment: resolveDeployEnvironment(),
          ...(requestContext?.userEmail
            ? { userId: requestContext.userEmail }
            : {}),
          ...(requestContext?.orgId ? { orgId: requestContext.orgId } : {}),
        });
      });
      wireRouteErrorCapture(nitroApp);
      registerBuiltinNotificationChannels();

      try {
        const { createObservabilityHandler } =
          await import("../observability/routes.js");
        const { ensureObservabilityTables } =
          await import("../observability/store.js");
        if (runBootDatabaseWork) ensureObservabilityTables().catch(() => {});
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
        if (runBootDatabaseWork) {
          ensureAuditTables().catch(() => {});
          startAuditCleanupJob();
        }
      } catch {
        // Audit module not available — skip
      }

      for (const provider of [
        "figma",
        "gmail",
        "google_calendar",
        "google_docs",
        "google_drive",
        "google_sheets",
        "google_slides",
        "github",
        "hubspot",
        "salesforce",
        "jira",
        "sentry",
        "notion",
      ] as const) {
        getH3App(nitroApp).use(
          `${P}/connections/oauth/${provider}/start`,
          createWorkspaceProviderOAuthHandler(provider, "start"),
        );
        getH3App(nitroApp).use(
          `${P}/connections/oauth/${provider}/callback`,
          createWorkspaceProviderOAuthHandler(provider, "callback"),
        );
      }

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

      // Peer reachability + auth probe for the settings UI. Deliberately
      // separate from `${P}/agents` (discovery) — this route makes live
      // network calls to the peer, so it is session-gated and answers one
      // peer (`?url=`) or every registered peer (no query) via `discoverAgents`.
      //
      // MUST be mounted BEFORE `${P}/agents` below: h3's `.use()` matches by
      // path prefix, and that handler always returns a value (never calls
      // `next()`), so it would swallow `/agents/probe` requests before they
      // ever reached this route if registered second (same hazard as the A2A
      // `_process-task` route vs. its `/a2a` catch-all — see a2a/server.ts).
      getH3App(nitroApp).use(
        `${P}/agents/probe`,
        defineEventHandler(async (event) => {
          if (getMethod(event) !== "GET") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          const session = await getSession(event).catch(() => null);
          if (!session?.email) {
            setResponseStatus(event, 401);
            return { error: "Authentication required" };
          }

          return runWithRequestContext(
            { userEmail: session.email, orgId: session.orgId ?? undefined },
            async () => {
              const { probePeerAgent, probeAllPeerAgents } =
                await import("./agent-peer-probe.js");
              const query = getRequestURL(event).searchParams;
              const urlParam = query.get("url");

              if (urlParam === null) {
                const selfAppId = query.get("selfAppId") ?? undefined;
                const { discoverAgents } = await import("./agent-discovery.js");
                const agents = await discoverAgents(selfAppId);
                const results = await probeAllPeerAgents(agents);
                return { results };
              }

              if (!urlParam.trim()) {
                setResponseStatus(event, 400);
                return { error: "url is required" };
              }

              const result = await probePeerAgent({
                id: "probe",
                name: urlParam,
                description: "",
                url: urlParam,
                color: "",
              });

              // Reachability and auth are independent, but a malformed/SSRF-blocked
              // URL is a caller input error, not a peer that failed to answer — the
              // one case where the probe's "unreachable" result is reclassified into
              // a 400 instead of a 200 with `reachable: false`.
              if (result.error?.startsWith("SSRF blocked:")) {
                setResponseStatus(event, 400);
                return { url: urlParam, error: result.error };
              }

              return result;
            },
          );
        }),
      );

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

      // Realtime subscribe-token mint (hosted gateway path)
      getH3App(nitroApp).use(
        `${P}/realtime-token`,
        createRealtimeTokenHandler(),
      );
      // Sharee visibility check for the hosted gateway
      getH3App(nitroApp).use(`${P}/can-see`, createGatewayAccessCheckHandler());

      // SSE
      if (!options.disableSSE) {
        for (const route of resolveFrameworkSseRoutes(options.sseRoute)) {
          getH3App(nitroApp).use(route, createPollEventsHandler());
        }
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
        if (shouldDisableInProcessSweeps()) return;
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
        setResponseHeader(event, "Cache-Control", "no-store");
        const envStatus = getBuilderBrowserStatusForEvent(event);
        const ownerContext = await resolveBuilderOwnerContext(event);
        const userEmail = ownerContext.email;
        const provisioningToken =
          userEmail &&
          ownerContext.session?.token &&
          isBuilderAccountProvisioningEnabled()
            ? signBuilderProvisioningToken(
                userEmail,
                ownerContext.session.token,
              )
            : undefined;
        const withConnectToken = <
          T extends {
            connectUrl: string;
            agentNativeProvisioningEnabled?: boolean;
          },
        >(
          status: T,
        ): T => {
          if (!userEmail) return status;
          return {
            ...status,
            agentNativeProvisioningEnabled:
              status.agentNativeProvisioningEnabled &&
              Boolean(provisioningToken),
            agentNativeProvisioningToken: provisioningToken,
            connectUrl: appendBuilderConnectToken(status.connectUrl, userEmail),
          };
        };

        // Pass the user's active orgId so status reads can fall back to
        // org-scoped credentials and branch project IDs. Without it, an
        // admin's org-scope OAuth result is invisible to every other org
        // member's status poller and the UI would show "not connected" forever
        // even though the chat actually resolves the org-shared credential.
        let orgId: string | null = null;
        let orgRole: string | null = null;
        if (!ownerContext.anonymous) {
          try {
            const { getOrgContext } = await import("../org/context.js");
            const orgCtx = await getOrgContext(event);
            orgId = orgCtx.orgId ?? null;
            orgRole = orgCtx.role ?? null;
          } catch {
            /* org module not present in this template — keep userEmail-only */
          }
        }

        return runWithRequestContext(
          { userEmail, orgId: orgId ?? undefined },
          async () => {
            const requestUrl = getFrameworkRouteRequestUrl(event);
            const connectAttemptId = requestUrl.searchParams.get(
              BUILDER_CONNECT_ATTEMPT_PARAM,
            );
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
                const isCorrelatedProvisioningError =
                  errRow?.code === "account_exists" &&
                  typeof connectAttemptId === "string" &&
                  errRow.attemptId === connectAttemptId;
                const isLegacyConnectError = errRow?.code !== "account_exists";
                if (
                  errRow &&
                  typeof errRow.message === "string" &&
                  (isCorrelatedProvisioningError || isLegacyConnectError)
                ) {
                  if (isLegacyConnectError) {
                    await deleteSetting(errKey).catch(() => {});
                  }
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
                      ...(typeof errRow.code === "string"
                        ? { code: errRow.code }
                        : {}),
                    },
                  });
                }
              }
            } catch {
              // settings store unavailable — fall through
            }

            if (userEmail) {
              try {
                const requestAuthorization =
                  await resolveBuilderRequestAuthorization({
                    requiredScope: BUILDER_OAUTH_SCOPE,
                    legacyCredentialKeys: BUILDER_STATUS_LEGACY_CREDENTIAL_KEYS,
                  });
                if (requestAuthorization?.source === "oauth") {
                  const keyStatus = await resolveOAuthCustodyBuilderKeyStatus();
                  return withConnectToken({
                    ...requestStatus,
                    configured: true,
                    credentialSource: "user" as const,
                    canDisconnect:
                      requestAuthorization.oauthScope === "user" ||
                      (requestAuthorization.oauthScope === "org" &&
                        (orgRole === "owner" || orgRole === "admin")),
                    privateKeyConfigured: keyStatus.privateKeyConfigured,
                    publicKeyConfigured: keyStatus.publicKeyConfigured,
                    keyLookupFailed: keyStatus.keyLookupFailed,
                    orgName: keyStatus.orgName,
                    spaces: [],
                  });
                }
                if (
                  requestAuthorization?.legacyCredentialKey ===
                  "BUILDER_CMS_PRIVATE_KEY"
                ) {
                  return withConnectToken({
                    ...requestStatus,
                    configured: true,
                    credentialSource: "user" as const,
                    privateKeyConfigured: true,
                    publicKeyConfigured: false,
                    spaces: [],
                  });
                }
              } catch (error) {
                return withConnectToken({
                  ...requestStatus,
                  configured: false,
                  credentialSource: "user" as const,
                  canDisconnect: false,
                  privateKeyConfigured: false,
                  publicKeyConfigured: false,
                  connectError: {
                    message:
                      error instanceof CredentialStoreUnavailableError
                        ? "Builder connection status could not be read. Retry in a moment."
                        : error instanceof Error
                          ? error.message
                          : "Builder access expired. Reconnect Builder.io.",
                    at: Date.now(),
                  },
                });
              }
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
                  canDisconnect: false,
                  // Surface durable credential rejection separately from
                  // one-shot OAuth callback failures. The reconnect UI keeps
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
                  canDisconnect:
                    credentialSource === "user" ||
                    (credentialSource === "org" &&
                      (orgRole === "owner" || orgRole === "admin")),
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
      // the user to complete the Builder OAuth flow, but short enough
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

      // Lightweight 302 to Builder's authorization endpoint. Lets clients do
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
      //   3. Pending row keyed by signed OAuth state plus a host-only cookie —
      //      Builder can omit the callback query, but it cannot read or forge
      //      the cookie. The callback still requires the matching session,
      //      pending row, and a successful PKCE exchange before persistence.
      getH3App(nitroApp).use(
        `${P}/builder/connect`,
        defineEventHandler(async (event) => {
          const requestUrl = getFrameworkRouteRequestUrl(event);
          const connectAttemptId = requestUrl.searchParams.get(
            BUILDER_CONNECT_ATTEMPT_PARAM,
          );
          const ownerContext = await resolveBuilderOwnerContext(
            event,
            "connect",
          );
          const ownerEmail = ownerContext.email;
          if (!ownerEmail) {
            setResponseStatus(event, 401);
            return { error: "Authentication required" };
          }
          if (
            ownerContext.anonymous ||
            isAgentNativeAnonymousOwner(ownerEmail)
          ) {
            setResponseStatus(event, 401);
            setResponseHeader(
              event,
              "Content-Type",
              "text/html; charset=utf-8",
            );
            return createBuilderBrowserCallbackErrorPage(
              "Sign in to connect Builder.",
              {
                title: "Sign in required",
                body: "Builder OAuth is tied to a signed-in account. Sign in, then try Connect Builder again.",
                parentOrigin: getBuilderBrowserOriginForEvent(event),
                ...(connectAttemptId ? { attemptId: connectAttemptId } : {}),
              },
            );
          }

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
              ...(connectAttemptId ? { attemptId: connectAttemptId } : {}),
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
              ...(connectAttemptId ? { attemptId: connectAttemptId } : {}),
            });
          }

          const shouldProvisionAgentNativeAccount =
            requestUrl.searchParams.get(BUILDER_CONNECT_MODE_PARAM) ===
            BUILDER_AGENT_NATIVE_PROVISION_MODE;
          if (shouldProvisionAgentNativeAccount) {
            const failProvisioning = async (
              status: number,
              message: string,
              reason: string,
              code?: string,
            ) => {
              await putSetting(`builder-connect-error:${ownerEmail}`, {
                message,
                at: Date.now(),
                ...(code ? { code } : {}),
                ...(connectAttemptId ? { attemptId: connectAttemptId } : {}),
              }).catch(() => {});
              await trackBuilderLifecycle(
                event,
                "builder connect failed",
                ownerEmail,
                {
                  ...builderConnectTrackingProperties(connectTracking),
                  reason,
                  stage: "provision",
                },
              );
              setResponseStatus(event, status);
              setResponseHeader(
                event,
                "Content-Type",
                "text/html; charset=utf-8",
              );
              return createBuilderBrowserCallbackErrorPage(message, {
                parentOrigin: getBuilderBrowserOriginForEvent(event),
                ...(connectAttemptId ? { attemptId: connectAttemptId } : {}),
                ...(code ? { code } : {}),
              });
            };

            if (!isBuilderAccountProvisioningEnabled()) {
              return failProvisioning(
                503,
                "Builder account activation is not available.",
                "provision_not_configured",
              );
            }

            if (
              !ownerContext.session?.token ||
              !verifyBuilderProvisioningToken(
                requestUrl.searchParams.get(BUILDER_PROVISIONING_TOKEN_PARAM),
                ownerEmail,
                ownerContext.session.token,
              )
            ) {
              return failProvisioning(
                403,
                "This activation link is expired. Close this popup and click Activate again.",
                "provision_token_invalid",
              );
            }

            if (ownerContext.session?.emailVerified !== true) {
              return failProvisioning(
                403,
                "Verify your email before connecting Builder.",
                "email_not_verified",
              );
            }

            try {
              const credentials = await provisionBuilderAccount({
                email: ownerEmail,
                name: ownerContext.session.name,
              });
              const { writeBuilderCredentials } =
                await import("./credential-provider.js");
              await writeBuilderCredentials(ownerEmail, credentials);
              await Promise.all([
                deleteSetting("builder-disconnected").catch(
                  () => false, // coercion-ok: best-effort cleanup after successful provisioning
                ),
                deleteSetting(`builder-connect-error:${ownerEmail}`).catch(
                  () => false, // coercion-ok: best-effort cleanup after successful provisioning
                ),
              ]);
              await trackBuilderLifecycle(
                event,
                "builder connect succeeded",
                ownerEmail,
                {
                  ...builderConnectTrackingProperties(connectTracking),
                  stage: "provision",
                  credential_scope: "user",
                  account_provisioned: true,
                },
              );
              const parentOrigin = getBuilderBrowserOriginForEvent(event);
              setResponseHeader(event, "Cache-Control", "no-store");
              setResponseHeader(
                event,
                "Content-Type",
                "text/html; charset=utf-8",
              );
              return createBuilderBrowserCallbackPage(
                `${parentOrigin}${getAppBasePath() || "/"}`,
                {
                  parentOrigin,
                  ...(connectAttemptId ? { attemptId: connectAttemptId } : {}),
                },
              );
            } catch (error) {
              console.error(
                "[builder] Agent-Native account provisioning failed:",
                error instanceof Error ? error.message : error,
              );
              if (isBuilderAccountAlreadyExistsError(error)) {
                return failProvisioning(
                  409,
                  "A Builder account already exists for this email. Log in to connect it.",
                  "account_exists",
                  "account_exists",
                );
              }
              return failProvisioning(
                502,
                "Couldn't create your Builder account. Try again or connect an existing account.",
                "provision_failed",
              );
            }
          }

          // Clear any prior failure row from a previous attempt — otherwise
          // useBuilderStatus polling sees the stale error and aborts the
          // new attempt before it can complete.
          try {
            await deleteSetting(`builder-connect-error:${ownerEmail}`);
          } catch {
            // No prior error row — fine
          }

          const state = createBuilderConnectState();
          const callbackUrl = resolveBuilderConnectCallbackUrl(event, state);
          if (
            !callbackUrl ||
            !isBuilderConnectCallbackUrlAllowed(callbackUrl, event)
          ) {
            const msg =
              "This deployment cannot start Builder OAuth from the current origin.";
            setResponseStatus(event, 400);
            setResponseHeader(
              event,
              "Content-Type",
              "text/html; charset=utf-8",
            );
            return createBuilderBrowserCallbackErrorPage(msg, {
              title: "Builder connection is unavailable here",
              body: "Open this app on its public HTTPS URL, then try again.",
              parentOrigin: getBuilderBrowserOriginForEvent(event),
              ...(connectAttemptId ? { attemptId: connectAttemptId } : {}),
            });
          }
          const {
            orgId: connectOrgId,
            role: connectRole,
            deny: orgConnectDenied,
          } = await resolveBuilderOrgMutation(event, {
            allowMemberInitiation: true,
          });
          if (orgConnectDenied) {
            await trackBuilderLifecycle(
              event,
              "builder connect failed",
              ownerEmail,
              {
                ...builderConnectTrackingProperties(connectTracking),
                reason: "org_authorization_required",
                stage: "connect",
              },
            );
            setResponseStatus(event, 403);
            setResponseHeader(
              event,
              "Content-Type",
              "text/html; charset=utf-8",
            );
            return createBuilderBrowserCallbackErrorPage(orgConnectDenied, {
              title: "Not allowed to connect Builder for this organization",
              body: orgConnectDenied,
              parentOrigin: getBuilderBrowserOriginForEvent(event),
              ...(connectAttemptId ? { attemptId: connectAttemptId } : {}),
            });
          }
          // The standard OAuth client discovers Builder's protected-resource
          // metadata, dynamically registers, and creates its S256 verifier.
          // Persist that opaque protocol state encrypted and consume it once.
          let oauthFlow: BuilderOAuthPendingFlow;
          let authorizationUrl: string;
          try {
            const started = await startBuilderOAuthAuthorization({
              ownerEmail,
              redirectUri: callbackUrl,
              state,
            });
            oauthFlow = started.pending;
            authorizationUrl = withBuilderConnectTrackingParams(
              started.authorizationUrl,
              connectTracking,
            );
            await putSetting(`builder-connect-pending:${state}`, {
              ownerEmail,
              orgId: connectOrgId,
              role: connectRole,
              encryptedOAuthFlow: encryptSecretValue(JSON.stringify(oauthFlow)),
              redirectUri: callbackUrl,
              expiresAt: Date.now() + BUILDER_CONNECT_PENDING_TTL_MS,
              tracking: connectTracking,
              ...(connectAttemptId ? { attemptId: connectAttemptId } : {}),
            });
            await purgeExpiredBuilderConnectPendingStates().catch(() => 0); // coercion-ok: connect already persisted the new pending row; purge of abandoned rows must not fail OAuth start
            setCookie(
              event,
              BUILDER_CONNECT_STATE_COOKIE,
              appendBuilderConnectStateCookie(
                getCookie(event, BUILDER_CONNECT_STATE_COOKIE),
                state,
              ),
              {
                httpOnly: true,
                secure: callbackUrl.startsWith("https://"),
                sameSite: "lax",
                path: "/",
                maxAge: Math.ceil(BUILDER_CONNECT_PENDING_TTL_MS / 1_000),
              },
            );
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
              ...(connectAttemptId ? { attemptId: connectAttemptId } : {}),
            }).catch(() => {});
            setResponseStatus(event, 503);
            setResponseHeader(
              event,
              "Content-Type",
              "text/html; charset=utf-8",
            );
            return createBuilderBrowserCallbackErrorPage(msg, {
              parentOrigin: getBuilderBrowserOriginForEvent(event),
              ...(connectAttemptId ? { attemptId: connectAttemptId } : {}),
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
          setResponseStatus(event, 302);
          setResponseHeader(event, "Cache-Control", "no-store");
          setResponseHeader(event, "Location", authorizationUrl);
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
          await assertBodySize(event, 64 * 1024);
          const body = await readBody(event).catch(() => ({}) as any);
          const prompt = typeof body?.prompt === "string" ? body.prompt : "";
          if (!prompt.trim()) {
            setResponseStatus(event, 400);
            return { error: "prompt is required" };
          }
          let context: string | undefined;
          try {
            context = normalizeBuilderAgentContext(body?.context);
          } catch (error) {
            setResponseStatus(event, 400);
            return {
              error: error instanceof Error ? error.message : "Invalid context",
            };
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
                  context,
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
      // Agent-Native deployments submit into the Builder-org Forms waitlist;
      // local/self-hosted deployments keep the analytics signal without
      // sending private workspace data to Agent-Native.
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
              requestOrigin: getBuilderBrowserOriginForEvent(event),
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
          setResponseHeader(event, "Pragma", "no-cache");
          setResponseHeader(event, "Referrer-Policy", "no-referrer");

          const requestUrl = getFrameworkRouteRequestUrl(event);
          const requestConnectAttemptId = requestUrl.searchParams.get(
            BUILDER_CONNECT_ATTEMPT_PARAM,
          );
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
                requestConnectAttemptId
                  ? { attemptId: requestConnectAttemptId }
                  : undefined,
              );
            }

            const relayOpenerOrigin =
              requestUrl.searchParams.get(BUILDER_OPENER_PARAM);
            const relayParentOrigin = resolveBuilderPreviewRelayParentOrigin({
              openerOrigin: relayOpenerOrigin,
              targetOrigin: relayPayload.targetOrigin,
            });

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
                {
                  parentOrigin: relayParentOrigin,
                  ...(requestConnectAttemptId
                    ? { attemptId: requestConnectAttemptId }
                    : {}),
                },
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
                parentOrigin: relayParentOrigin,
                ...(requestConnectAttemptId
                  ? { attemptId: requestConnectAttemptId }
                  : {}),
              });
            }

            setResponseHeader(
              event,
              "Content-Type",
              "text/html; charset=utf-8",
            );
            return createBuilderBrowserCallbackPage(
              `${relayParentOrigin}${relayPayload.basePath || "/"}`,
              {
                parentOrigin: relayParentOrigin,
                ...(requestConnectAttemptId
                  ? { attemptId: requestConnectAttemptId }
                  : {}),
              },
            );
          }

          // Builder sometimes drops the top-level OAuth state. Recover it
          // from the host-only cookie set by /builder/connect; the pending row
          // and authenticated session still bind it to this account.
          const queryState = requestUrl.searchParams.get("state");
          const state = resolveBuilderConnectCallbackState(
            queryState,
            getCookie(event, BUILDER_CONNECT_STATE_COOKIE),
          );
          const parentOrigin = getBuilderBrowserOriginForEvent(event);
          let callbackAttemptId = requestConnectAttemptId;
          const fail = async (
            status: number,
            message: string,
            ownerEmail?: string,
            reason?: string,
            tracking: BuilderConnectTrackingParams = {},
          ) => {
            if (ownerEmail) {
              await putSetting(`builder-connect-error:${ownerEmail}`, {
                message,
                at: Date.now(),
                ...(callbackAttemptId ? { attemptId: callbackAttemptId } : {}),
              }).catch(() => {});
              await trackBuilderLifecycle(
                event,
                "builder connect failed",
                ownerEmail,
                {
                  ...builderConnectTrackingProperties(tracking),
                  reason: reason ?? "callback_failed",
                  stage: "callback",
                },
              );
            }
            setResponseStatus(event, status);
            setResponseHeader(
              event,
              "Content-Type",
              "text/html; charset=utf-8",
            );
            return createBuilderBrowserCallbackErrorPage(message, {
              parentOrigin,
              ...(callbackAttemptId ? { attemptId: callbackAttemptId } : {}),
            });
          };

          if (!state || !isSignedBuilderConnectState(state)) {
            return fail(
              403,
              "No active Builder connect flow found. Restart the connection from Settings.",
            );
          }

          const pending = await readBuilderConnectPendingState(state);
          if (!pending) {
            return fail(
              403,
              "No active Builder connect flow found. Restart the connection from Settings.",
            );
          }

          callbackAttemptId =
            typeof pending.attemptId === "string"
              ? pending.attemptId
              : callbackAttemptId;

          const ownerEmail =
            typeof pending.ownerEmail === "string" ? pending.ownerEmail : null;
          const tracking =
            pending.tracking && typeof pending.tracking === "object"
              ? (pending.tracking as BuilderConnectTrackingParams)
              : {};
          const session = await getSession(event).catch(() => null); // coercion-ok: callback treats session read failure as unauthenticated
          const expiresAt =
            typeof pending.expiresAt === "number" ? pending.expiresAt : 0;
          const encryptedOAuthFlow =
            typeof pending.encryptedOAuthFlow === "string"
              ? pending.encryptedOAuthFlow
              : null;
          const redirectUri =
            typeof pending.redirectUri === "string"
              ? pending.redirectUri
              : null;
          const expectedRedirectUri = resolveBuilderConnectCallbackUrl(
            event,
            state,
          );

          if (
            !ownerEmail ||
            !isBuilderConnectCallbackOwner(ownerEmail, session?.email) ||
            Date.now() >= expiresAt ||
            !encryptedOAuthFlow ||
            !redirectUri ||
            !expectedRedirectUri ||
            redirectUri !== expectedRedirectUri ||
            !isBuilderConnectCallbackUrlAllowed(redirectUri, event)
          ) {
            if (Date.now() >= expiresAt) {
              await deleteSetting(`builder-connect-pending:${state}`).catch(
                () => false,
              ); // coercion-ok: expired pending cleanup is best-effort; callback already failed verification
            }
            return fail(
              403,
              "Builder connect callback could not be verified. Restart the connection.",
              ownerEmail ?? undefined,
              "callback_verification_failed",
              tracking,
            );
          }

          const denied = requestUrl.searchParams.get("error");
          const code = requestUrl.searchParams.get("code");
          const iss = requestUrl.searchParams.get("iss") ?? undefined;
          if (denied || !code) {
            return fail(
              400,
              denied
                ? "Builder connection was cancelled."
                : "Builder did not return an authorization code.",
              ownerEmail,
              denied ? "authorization_denied" : "missing_code",
              tracking,
            );
          }

          let credentials: Awaited<
            ReturnType<typeof exchangeBuilderOAuthAuthorization>
          >;
          try {
            const oauthFlow = JSON.parse(
              decryptSecretValue(encryptedOAuthFlow),
            ) as BuilderOAuthPendingFlow;
            credentials = await exchangeBuilderOAuthAuthorization({
              ownerEmail,
              code,
              iss,
              pending: oauthFlow,
            });
          } catch {
            return fail(
              502,
              "Builder could not exchange the authorization code. Restart the connection.",
              ownerEmail,
              "code_exchange_failed",
              tracking,
            );
          }

          // PKCE proves the callback belongs to this flow before its pending
          // row is consumed. Persist first so a transient credential-store
          // failure does not strand an otherwise valid pending flow.
          let callbackRole: string | null = null;
          if (pending.role === "owner" || pending.role === "admin") {
            // Re-check authority after the external OAuth round trip. A role
            // captured at connect start must not authorize a later org write.
            const currentOrg = await resolveBuilderOrgMutation(event, {
              allowMemberInitiation: true,
            });
            if (
              currentOrg.orgId === pending.orgId &&
              (currentOrg.role === "owner" || currentOrg.role === "admin")
            ) {
              callbackRole = currentOrg.role;
            }
          }
          let credentialScope: "user" | "org" = "user";
          try {
            credentialScope = await saveBuilderOAuthCredentials({
              ownerEmail,
              orgId:
                typeof pending.orgId === "string" ? pending.orgId : undefined,
              role: callbackRole,
              credentials,
            });
          } catch {
            return fail(
              500,
              "Builder credentials could not be saved. Restart the connection.",
              ownerEmail,
              "credential_write_failed",
              tracking,
            );
          }

          const consumed = await consumeBuilderConnectPendingState(state);
          if (!consumed) {
            return fail(
              403,
              "No active Builder connect flow found. Restart the connection from Settings.",
              ownerEmail,
              "callback_verification_failed",
              tracking,
            );
          }

          const remainingStates = removeBuilderConnectStateCookie(
            getCookie(event, BUILDER_CONNECT_STATE_COOKIE),
            state,
          );
          if (remainingStates) {
            setCookie(event, BUILDER_CONNECT_STATE_COOKIE, remainingStates, {
              httpOnly: true,
              secure: expectedRedirectUri.startsWith("https://"),
              sameSite: "lax",
              path: "/",
              maxAge: Math.ceil(BUILDER_CONNECT_PENDING_TTL_MS / 1_000),
            });
          } else {
            deleteCookie(event, BUILDER_CONNECT_STATE_COOKIE, { path: "/" });
          }

          try {
            await Promise.all([
              deleteSetting("builder-disconnected").catch(() => false), // coercion-ok: best-effort cleanup after successful OAuth save
              deleteSetting(`builder-connect-error:${ownerEmail}`).catch(
                () => false, // coercion-ok: best-effort cleanup after successful OAuth save
              ),
            ]);
          } catch {
            return fail(
              500,
              "Builder credentials could not be saved. Restart the connection.",
              ownerEmail,
              "credential_write_failed",
              tracking,
            );
          }

          await trackBuilderLifecycle(
            event,
            "builder connect succeeded",
            ownerEmail,
            {
              ...builderConnectTrackingProperties(tracking),
              stage: "callback",
              credential_scope: credentialScope,
            },
          );
          setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
          return createBuilderBrowserCallbackPage(
            `${parentOrigin}${getAppBasePath() || "/"}`,
            {
              parentOrigin,
              ...(callbackAttemptId ? { attemptId: callbackAttemptId } : {}),
            },
          );
        }),
      );

      // POST /_agent-native/builder/disconnect — remove this user's OAuth
      // custody. Legacy BUILDER_* secrets are cleared only at their resolved
      // scope, so an admin disconnect cannot accidentally delete org-wide keys
      // for a user-scoped connection. Workspace and env-managed connections
      // are not disconnectable from this endpoint.
      getH3App(nitroApp).use(
        `${P}/builder/disconnect`,
        defineEventHandler(async (event: H3Event) => {
          if (getMethod(event) !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          if (!isSameOriginRequest(event)) {
            setResponseStatus(event, 403);
            return { error: "Cross-origin request rejected" };
          }
          const session = await getSession(event).catch(() => null);
          if (!session?.email) {
            setResponseStatus(event, 401);
            return { error: "unauthorized" };
          }

          try {
            const {
              deleteBuilderCredentials,
              resolveBuilderCredentialsDetailed,
            } = await import("./credential-provider.js");
            let orgId: string | null = null;
            let role: string | null = null;
            try {
              const { getOrgContext } = await import("../org/context.js");
              const orgCtx = await getOrgContext(event);
              orgId = orgCtx.orgId ?? null;
              role = orgCtx.role ?? null;
            } catch {
              // coercion-ok: org module is optional; disconnect still clears user-scoped custody.
            }
            const oauthScope = await getBuilderOAuthStoredScope(
              session.email,
              orgId,
            );
            const hadOAuth = oauthScope !== null;
            // Revoking an org-scoped grant takes the connection offline for
            // every member, so require org owner/admin before doing so.
            if (oauthScope === "org") {
              const { deny } = await resolveBuilderOrgMutation(event);
              if (deny) {
                setResponseStatus(event, 403);
                return { error: deny };
              }
            }
            let legacyDeleteOptions:
              | { orgId?: string | null; role?: string | null }
              | undefined;
            if (!oauthScope) {
              const legacySource = (
                await resolveBuilderCredentialsDetailed({
                  userEmail: session.email,
                  orgId,
                })
              ).source;
              if (legacySource === "workspace") {
                setResponseStatus(event, 409);
                return {
                  error:
                    "This Builder connection is managed by the workspace and cannot be disconnected here.",
                };
              }
              if (legacySource === "env" || !legacySource) {
                setResponseStatus(event, 409);
                return {
                  error: "No disconnectable Builder connection was found.",
                };
              }
              if (legacySource === "org") {
                const { deny } = await resolveBuilderOrgMutation(event);
                if (deny) {
                  setResponseStatus(event, 403);
                  return { error: deny };
                }
                legacyDeleteOptions = { orgId, role };
              }
            }
            const oauthResult = oauthScope
              ? await deleteBuilderOAuthSession(
                  session.email,
                  oauthScope,
                  orgId,
                )
              : { localDeleted: false, remoteRevoked: false };
            await deleteBuilderCredentials(
              session.email,
              oauthScope ? undefined : legacyDeleteOptions,
            );
            await trackBuilderLifecycle(
              event,
              "builder disconnect succeeded",
              session.email,
              {
                oauth_present: hadOAuth,
                remote_revoked: hadOAuth
                  ? oauthResult.remoteRevoked
                  : undefined,
              },
            );
            return {
              ok: true,
              remoteRevoked: hadOAuth ? oauthResult.remoteRevoked : undefined,
              warning:
                hadOAuth && !oauthResult.remoteRevoked
                  ? "Local Builder access was removed, but remote revocation could not be confirmed."
                  : undefined,
            };
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
                "Could not fully remove Builder credentials. Please retry.",
              cause: err instanceof Error ? err.message : String(err),
            };
          }
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
                    "Builder not connected. Connect Builder (free tier available) in Setup to use background agent.",
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
            // One context for the whole sweep so the per-request secret memo is
            // shared, and one batched read per scope to fill it. Without this
            // every key pays its own four-scope waterfall.
            const requestContext = { userEmail, orgId };
            await runWithRequestContext(requestContext, () =>
              prefetchSecrets(allowedEnvKeyNames),
            );
            return Promise.all(
              envKeys.map(async (cfg) => {
                const effectiveDatabaseStatus = getEffectiveDatabaseEnvStatus(
                  cfg.key,
                );
                const configured =
                  effectiveDatabaseStatus ??
                  (await runWithRequestContext(requestContext, () =>
                    resolveSecret(cfg.key).then(Boolean),
                  ));
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
            const { userEmail, orgId } =
              await resolveAgentEngineStatusIdentity(event);
            return await runWithRequestContext({ userEmail, orgId }, () =>
              resolveAgentEngineStatus(requestAgentEngineStatusDeps()),
            );
          } catch (err) {
            // NOT `{ configured: false }`. A 200 saying "not configured" is an
            // authoritative answer to the client, so a DB blip here renders as
            // "connect an AI provider" and gates the composer. 503 is the only
            // response the client can tell apart from a real answer — it maps
            // to `unavailable`, which keeps the composer usable and retries.
            console.error("[agent-engine/status] lookup failed", err);
            setResponseStatus(event, 503);
            return { error: "Could not read the agent engine configuration." };
          }
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

          const clientPlatform = readAnalyticsClientPlatformHeader(event);
          const properties: Record<string, unknown> = {
            ...(validation.properties ?? {}),
            ...(clientPlatform
              ? {
                  [ANALYTICS_CLIENT_PLATFORM_PROPERTY]: clientPlatform,
                }
              : {}),
            source: "client",
          };
          if (orgId) properties.org_id = orgId;

          // Best-effort — server `track()` swallows provider errors. We still
          // guard here so an unexpected throw can't surface to the browser.
          try {
            track(validation.name as string, properties, {
              userId: userEmail,
              sessionId: readBrowserSessionIdHeader(event),
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
            let builderConfigured = false;
            let builderUploadConfigured = false;
            try {
              const {
                canAuthorizeBuilderApiRequest,
                hasBuilderApiCredentialCustody,
              } = await import("./builder-api-auth.js");
              builderConfigured = await hasBuilderApiCredentialCustody();
              builderUploadConfigured = await canAuthorizeBuilderApiRequest(
                BUILDER_ASSETS_WRITE_SCOPE,
              );
            } catch {
              builderConfigured = false;
              builderUploadConfigured = false;
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
              ? builderUploadConfigured
              : !!active || builderUploadConfigured;
            const activeProvider = isBuilderEnvActive
              ? builderUploadConfigured
                ? { id: "builder", name: "Builder.io" }
                : null
              : active
                ? active.id === "builder" && !builderUploadConfigured
                  ? null
                  : { id: active.id, name: active.name }
                : builderUploadConfigured
                  ? { id: "builder", name: "Builder.io" }
                  : null;

            return {
              configured,
              activeProvider,
              providers,
              builderConfigured,
              builderUploadConfigured,
              builderReauthorizationRequired:
                builderConfigured && !builderUploadConfigured,
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
              "No file upload provider configured. Connect Builder.io (free tier available) in Settings → File uploads, or register a provider.",
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
        if (runBootDatabaseWork) ensureExtensionsTables().catch(() => {});
        registerExtensionsShareable();
        const extensionsHandler = createExtensionsHandler({
          extensionTools: options.extensionTools,
        });
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
        if (runBootDatabaseWork) ensureSlotTables().catch(() => {});
        getH3App(nitroApp).use(`${P}/slots`, createSlotsHandler());
      } catch {
        // Extensions module not available — skip
      }

      // ─── Data programs (stored server-side JS scripts + run cache) ─────
      try {
        const { ensureDataProgramTables, registerDataProgramsShareable } =
          await import("../data-programs/store.js");
        if (runBootDatabaseWork) ensureDataProgramTables().catch(() => {});
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
            const storedImage = (data as any)?.image;
            if (typeof storedImage === "string" && storedImage.trim()) {
              return { image: storedImage };
            }
            if (getBetterAuthSync()) {
              const adapter = await getBetterAuthInternalAdapter().catch(
                () => undefined,
              );
              const user = await adapter
                ?.findUserByEmail(decodeURIComponent(emailParam), {
                  includeAccounts: false,
                })
                // coercion-ok: an avatar miss must not turn a valid settings request into a 500.
                .catch(() => null);
              return {
                image: isGoogleProfileImageUrl(user?.user.image)
                  ? (user?.user.image ?? null)
                  : null,
              };
            }
            return { image: null };
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

      const mcpConnect = resolveCoreRoutesMcpOptions(options);
      if (mcpConnect.connect) {
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
                appId: mcpConnect.appId,
                appName: mcpConnect.appName,
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
          appId: mcpConnect.appId,
          appName: mcpConnect.appName,
          serverName: mcpConnect.serverName,
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
            if (key === "compose") return;
            // Collection root: `GET ?keys=a,b,c` batches many single-key reads
            // into one request (and one identity resolution) — the chat rail
            // alone reads ~6 keys on every mount.
            if (key === "") {
              if (getMethod(event) === "GET") return getStateMany(event);
              return;
            }
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
      // Do NOT rethrow. Nitro invokes plugins as `try { plugin(app) } catch`,
      // which cannot catch an async rejection, so rethrowing here surfaces as
      // an unhandledRejection: Node exits, the serverless container dies, and
      // every in-flight request on it returns a bare 502. `rejectInit` already
      // routes this failure to the readiness gate, which answers the affected
      // paths with a retryable 503 instead.
      rejectInit(error);
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
export const defaultCoreRoutesPlugin: NitroPluginDef = createCoreRoutesPlugin({
  googleOAuthManagedConnection: "not_applicable",
});
