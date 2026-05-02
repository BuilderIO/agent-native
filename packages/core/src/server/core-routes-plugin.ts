import { getH3App, awaitBootstrap } from "./framework-request-handler.js";
import {
  defineEventHandler,
  setResponseStatus,
  setResponseHeader,
  getMethod,
  getHeader,
} from "h3";
import type { H3Event } from "h3";
import path from "node:path";
import { createPollHandler } from "./poll.js";
import { createSSEHandler } from "./sse.js";
import { upsertEnvFile } from "./create-server.js";
import type { EnvKeyConfig } from "./create-server.js";
import { readBody } from "./h3-helpers.js";
import {
  BUILDER_ENV_KEYS,
  buildBuilderCliAuthUrl,
  createBuilderBrowserCallbackErrorPage,
  createBuilderBrowserCallbackPage,
  getBuilderBranchProjectId,
  getBuilderBrowserStatusForEvent,
  isBuilderBranchingEnabled,
  resolveSafePreviewUrl,
  runBuilderAgent,
} from "./builder-browser.js";
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
import { getSetting, putSetting, deleteSetting } from "../settings/store.js";
import {
  getUserSetting,
  putUserSetting,
  deleteUserSetting,
} from "../settings/user-settings.js";
import { getSession, isDevEnvironment, DEV_MODE_USER_EMAIL } from "./auth.js";
import { isLocalDatabase } from "../db/client.js";
import { getOrigin } from "./google-oauth.js";
import { findWorkspaceRoot } from "../scripts/utils.js";
import { listOnboardingSteps } from "../onboarding/registry.js";
import {
  uploadFile,
  getActiveFileUploadProvider,
  listFileUploadProviders,
} from "../file-upload/index.js";
import { readMultipartFormData } from "h3";
import {
  createListSecretsHandler,
  createWriteSecretHandler,
  createTestSecretHandler,
  createAdHocSecretHandler,
} from "../secrets/routes.js";
import { registerFrameworkSecrets } from "../secrets/register-framework-secrets.js";
import { registerBuiltinProviders } from "../tracking/providers.js";
import { track } from "../tracking/index.js";
import { registerBuiltinNotificationChannels } from "../notifications/channels.js";
import { createNotificationsHandler } from "../notifications/routes.js";
import { createProgressHandler } from "../progress/routes.js";
import { createTranscribeVoiceHandler } from "./transcribe-voice.js";
import { runWithRequestContext } from "./request-context.js";
import { createVoiceProvidersStatusHandler } from "./voice-providers-status.js";
import { PROVIDER_ENV_META } from "../agent/engine/provider-env-vars.js";
import {
  canUpdateAgentLoopSettings,
  readAgentLoopSettings,
  resetAgentLoopSettings,
  validateMaxIterationsInput,
  writeAgentLoopSettings,
} from "../agent/loop-settings.js";
import {
  isAgentEngineSettingConfigured,
  getAgentEngineEntry,
  detectEngineFromEnv,
  detectEngineFromUserSecrets,
  isStoredEngineUsable,
} from "../agent/engine/registry.js";
import { getOrgContext } from "../org/context.js";

/**
 * The base path prefix for all framework-level routes.
 * All agent-native core routes live under this namespace to avoid
 * collisions with template-specific `/api/*` routes.
 */
export const FRAMEWORK_ROUTE_PREFIX = "/_agent-native";

/**
 * Whether deployment-wide `process.env` writes (and rehydration from the
 * unscoped `persisted-env-vars` settings row) are safe on this deployment.
 *
 * Allowed only when:
 *   - we're running against a local SQLite-only database in a development
 *     environment (no shared-tenant exposure), OR
 *   - the operator has explicitly opted in via
 *     `AGENT_NATIVE_ALLOW_ENV_VAR_WRITES=1` (single-tenant self-hosted).
 *
 * On any hosted multi-tenant deploy this returns false: env vars are
 * deployment-wide globals and one tenant could otherwise overwrite Stripe /
 * OpenAI / Sentry keys for every other tenant. Per-org credentials must use
 * the per-user/org `app_secrets` store via `saveCredential()` instead.
 */
function isEnvVarWriteAllowed(): boolean {
  if (process.env.AGENT_NATIVE_ALLOW_ENV_VAR_WRITES === "1") return true;
  return isDevEnvironment() && isLocalDatabase();
}

function trackBuilderLifecycle(
  name: string,
  userEmail: string | undefined | null,
  properties: Record<string, unknown> = {},
): void {
  if (!userEmail) return;
  track(
    name,
    {
      feature: "builder",
      ...properties,
    },
    { userId: userEmail },
  );
}

function normalizeAppBasePath(value: string | undefined): string {
  if (!value || value === "/") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function stripAppBasePath(pathname: string): string {
  const basePath = normalizeAppBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  );
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
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
  /** Disable the /_agent-native/application-state routes. */
  disableAppState?: boolean;
  /** Env key configuration. Enables env-status and env-vars routes. */
  envKeys?: EnvKeyConfig[];
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
 *   GET    /_agent-native/env-status                    — env key configuration status (when envKeys provided)
 *   POST   /_agent-native/env-vars                      — save env vars to .env (when envKeys provided)
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
    // No-op when called from inside the bootstrap (auto-mount path).
    // Otherwise wait so other default plugins finish mounting first.
    await awaitBootstrap(nitroApp);

    // Restore env vars from the settings table. On serverless, .env
    // writes don't persist across invocations — the DB is the durable
    // store. Only set keys that are currently empty so explicit env
    // vars (Netlify dashboard, process-level) always win.
    //
    // GATED: only rehydrate into `process.env` on local-dev SQLite (or
    // with the explicit single-tenant opt-in). On a shared-DB hosted
    // multi-tenant deploy the `persisted-env-vars` row is deployment-wide
    // global state — pushing user-supplied values into `process.env` from
    // it would let any one tenant's writes (or a stale dev seed) leak
    // into every other tenant's process. The opt-out scrub of legacy
    // BUILDER_* values still runs unconditionally so existing rows on
    // multi-tenant deploys self-heal, but new env-var writes never land
    // in `process.env` outside the allowed contexts.
    try {
      const persisted = (await getSetting("persisted-env-vars")) as Record<
        string,
        string
      > | null;
      if (persisted) {
        const builderKeys = new Set<string>(BUILDER_ENV_KEYS);
        const writesAllowed = isEnvVarWriteAllowed();
        let scrubbed = 0;
        for (const [k, v] of Object.entries(persisted)) {
          if (builderKeys.has(k)) {
            scrubbed++;
            continue;
          }
          if (writesAllowed && typeof v === "string" && !process.env[k]) {
            process.env[k] = v;
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

    const P = FRAMEWORK_ROUTE_PREFIX;

    // Security response headers — emitted on every framework response.
    // Mounted before route handlers so 4xx/5xx error pages also carry the
    // headers. Routes that need to relax a specific header (e.g. the tools
    // /render route allowing same-origin framing) override via setResponseHeader.
    const { createSecurityHeadersMiddleware } =
      await import("./security-headers.js");
    getH3App(nitroApp).use(createSecurityHeadersMiddleware());

    // CORS for framework routes. Desktop tray apps (Tauri/Electron) run on
    // their own dev origin (e.g. localhost:1420) and make credentialed
    // requests against the template's server at a different port. We echo
    // the exact origin + Allow-Credentials so same-site localhost ports
    // can cross-send cookies.
    const allowlist = (process.env.CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const isProduction = process.env.NODE_ENV === "production";
    const LOCALHOST_RE =
      /^https?:\/\/(localhost|127\.0\.0\.1|tauri\.localhost)(:\d+)?$/;
    getH3App(nitroApp).use(
      defineEventHandler((event) => {
        const pathname = stripAppBasePath(
          event.url?.pathname ??
            String(event.node?.req?.url ?? event.path ?? "/").split("?")[0],
        );
        if (!pathname.startsWith(P) && !pathname.startsWith("/api/")) return;
        const reqHeaders = (event.node?.req?.headers ?? {}) as Record<
          string,
          string | string[] | undefined
        >;
        const originRaw = reqHeaders["origin"];
        const origin = Array.isArray(originRaw) ? originRaw[0] : originRaw;
        const method = getMethod(event);

        // Decide whether this origin is allowed. We never fall back to the
        // first allowlist entry — that previously echoed `Access-Control-
        // Allow-Origin: <unrelated-allowed-origin>` for disallowed callers,
        // which is permissive enough that some clients followed through.
        let allowedOrigin: string | null = null;
        if (origin) {
          if (allowlist.length > 0) {
            if (allowlist.includes(origin)) allowedOrigin = origin;
          } else {
            // No allowlist configured. In production we only allow
            // localhost-style origins (desktop tray dev usage); in dev we
            // allow any origin echo. This prevents a fresh deploy without
            // CORS_ALLOWED_ORIGINS from accepting credentialed requests
            // from any origin.
            if (isProduction) {
              if (LOCALHOST_RE.test(origin)) allowedOrigin = origin;
            } else {
              if (LOCALHOST_RE.test(origin)) allowedOrigin = origin;
            }
          }
        }

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
            setResponseHeader(
              event,
              "Access-Control-Allow-Credentials",
              "true",
            );
            setResponseHeader(
              event,
              "Access-Control-Allow-Methods",
              "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
            );
            setResponseHeader(
              event,
              "Access-Control-Allow-Headers",
              "Content-Type,Authorization,X-Requested-With,X-Request-Source,X-Agent-Native-CSRF",
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
        setResponseHeader(event, "Access-Control-Allow-Origin", allowedOrigin);
        setResponseHeader(event, "Vary", "Origin");
        setResponseHeader(event, "Access-Control-Allow-Credentials", "true");
        setResponseHeader(
          event,
          "Access-Control-Allow-Methods",
          "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
        );
        setResponseHeader(
          event,
          "Access-Control-Allow-Headers",
          "Content-Type,Authorization,X-Requested-With,X-Request-Source,X-Agent-Native-CSRF",
        );
      }),
    );

    // Defense-in-depth CSRF check for state-changing /_agent-native/* routes.
    // Mounted AFTER the CORS layer so disallowed-origin OPTIONS preflights
    // 403 first (rather than being rejected on a stale cookie heuristic).
    // See `csrf.ts` for the threat model and allowlist.
    const { createCsrfMiddleware } = await import("./csrf.js");
    getH3App(nitroApp).use(createCsrfMiddleware(P));

    // Polling
    getH3App(nitroApp).use(`${P}/poll`, createPollHandler());

    // SSE
    if (!options.disableSSE) {
      const sseRoute = options.sseRoute ?? `${P}/events`;
      getH3App(nitroApp).use(sseRoute, createSSEHandler());
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

    getH3App(nitroApp).use(
      `${P}/builder/status`,
      defineEventHandler(async (event) => {
        const envStatus = getBuilderBrowserStatusForEvent(event);
        const session = await getSession(event).catch(() => null);
        const userEmail = session?.email;

        // Env-managed mode: BUILDER_PRIVATE_KEY is set at the deployment
        // level, so every user shares the operator's Builder identity.
        // Skip per-user lookups entirely — the env key is authoritative
        // and the UI must hide the connect/disconnect controls.
        if (envStatus.envManaged) {
          return envStatus;
        }

        return runWithRequestContext({ userEmail }, async () => {
          // Per-user OAuth mode: read the user's app_secrets-stored creds.
          try {
            const { resolveBuilderCredentials } =
              await import("./credential-provider.js");
            const creds = await resolveBuilderCredentials();
            if (creds.privateKey) {
              return {
                ...envStatus,
                configured: true,
                privateKeyConfigured: true,
                publicKeyConfigured: !!creds.publicKey,
                userId: creds.userId || envStatus.userId,
                orgName: creds.orgName || envStatus.orgName,
                orgKind: creds.orgKind || envStatus.orgKind,
              };
            }
          } catch {
            // Secrets table not ready — fall through to env status
          }
          // Surface a recent OAuth callback failure so the parent's polling
          // stops with a clear message instead of timing out at 5min. The
          // callback handler writes a `builder-connect-error:<email>` row
          // when `writeBuilderCredentials` throws; this read self-clears so
          // the message only fires once.
          try {
            if (userEmail) {
              const errKey = `builder-connect-error:${userEmail}`;
              const errRow = await getSetting(errKey);
              if (errRow && typeof errRow.message === "string") {
                await deleteSetting(errKey).catch(() => {});
                return {
                  ...envStatus,
                  configured: false,
                  privateKeyConfigured: false,
                  publicKeyConfigured: false,
                  userId: undefined,
                  orgName: undefined,
                  orgKind: undefined,
                  connectError: {
                    message: errRow.message as string,
                    at:
                      typeof errRow.at === "number"
                        ? (errRow.at as number)
                        : Date.now(),
                  },
                };
              }
            }
          } catch {
            // settings store unavailable — fall through
          }
          // Honor legacy disconnect flag for existing deployments.
          try {
            const disconnected = await getSetting("builder-disconnected");
            if (disconnected) {
              return {
                ...envStatus,
                configured: false,
                privateKeyConfigured: false,
                publicKeyConfigured: false,
                userId: undefined,
                orgName: undefined,
                orgKind: undefined,
              };
            }
          } catch {
            // DB not reachable
          }
          // No env, no per-user creds → not configured. Both authenticated
          // and unauthenticated callers see "not connected" so they can
          // run through the OAuth flow.
          return {
            ...envStatus,
            configured: false,
            privateKeyConfigured: false,
            publicKeyConfigured: false,
            userId: undefined,
            orgName: undefined,
            orgKind: undefined,
          };
        });
      }),
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
      const expected = getOrigin(event).replace(/\/+$/, "");
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
    // CSRF protection here is two-layer because session cookies are
    // SameSite=None;Secure (so the editor iframe can ride along) — that
    // means a session cookie alone does NOT prevent cross-origin
    // window.open from initiating a connect flow on the victim's behalf:
    //   1. Sec-Fetch-Site header — modern browsers stamp every request
    //      with the navigation context. We only allow `same-origin` or
    //      `none` (typed/bookmark/extension); cross-site / same-site are
    //      rejected. The previous "URL-embedded signed state" was dropped
    //      because Builder's /cli-auth strips arbitrary query params; this
    //      replaces that defense with a browser-native one.
    //   2. Pending row keyed by session email + bound nonce — the callback
    //      requires both a valid session and a one-time row that this
    //      handler wrote during the same flow. Without the same-origin
    //      check above, an attacker could prime the row from cross-site
    //      and then trick the victim into hitting a callback URL with
    //      attacker-controlled p-key/api-key, hijacking the victim's
    //      account. With the check, the attacker can't prime the row.
    getH3App(nitroApp).use(
      `${P}/builder/connect`,
      defineEventHandler(async (event) => {
        const session = await getSession(event).catch(() => null);
        if (!session?.email) {
          setResponseStatus(event, 401);
          return { error: "Authentication required" };
        }

        // Env-managed mode: per-user OAuth is disabled because the operator
        // already provided a deploy-level Builder identity. Reject the
        // connect attempt — any per-user keys we wrote would be ignored
        // by the resolver, so completing the OAuth flow would be a no-op
        // that misleads the user about the resulting connection state.
        const { isBuilderEnvManaged } =
          await import("./credential-provider.js");
        if (isBuilderEnvManaged()) {
          setResponseStatus(event, 409);
          return {
            error:
              "Builder is managed by the deployment (BUILDER_PRIVATE_KEY is set). Per-user connect is disabled.",
            envManaged: true,
          };
        }

        // Same-origin gate. Sec-Fetch-Site is the primary signal; fall
        // back to Origin/Referer for older browsers. Reject any context
        // that isn't this exact app's origin — including same-site
        // subdomains, since a compromised subdomain shouldn't be able
        // to mint Builder credential writes for users of the main app.
        if (!isSameOriginConnect(event)) {
          trackBuilderLifecycle("builder connect failed", session.email, {
            reason: "cross_origin",
            stage: "connect",
          });
          setResponseStatus(event, 403);
          return { error: "Cross-origin connect requests are not allowed" };
        }

        // Clear any prior failure row from a previous attempt — otherwise
        // useBuilderStatus polling sees the stale error and aborts the
        // new attempt before it can complete.
        try {
          await deleteSetting(`builder-connect-error:${session.email}`);
        } catch {
          // No prior error row — fine
        }

        // Store a short-lived pending row. If the DB is unavailable we
        // surface a popup-renderable error page that signals the parent
        // via BroadcastChannel, rather than letting the popup show raw
        // JSON and the parent poll for 5 minutes.
        try {
          await putSetting(`builder-pending-connect:${session.email}`, {
            expiresAt: Date.now() + BUILDER_CONNECT_PENDING_TTL_MS,
          });
        } catch (err) {
          trackBuilderLifecycle("builder connect failed", session.email, {
            reason: "pending_storage_unavailable",
            stage: "connect",
          });
          const msg =
            "Could not initiate Builder connect — storage unavailable. Try again.";
          console.error(
            "[builder] Could not store pending-connect state:",
            (err as Error)?.message ?? err,
          );
          // Best-effort: also write the error row so the parent's
          // /builder/status poll picks it up if BroadcastChannel doesn't.
          await putSetting(`builder-connect-error:${session.email}`, {
            message: msg,
            at: Date.now(),
          }).catch(() => {});
          setResponseStatus(event, 503);
          setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
          return createBuilderBrowserCallbackErrorPage(msg);
        }
        trackBuilderLifecycle("builder connect started", session.email, {
          stage: "connect",
        });
        // Build the cli-auth URL without embedding state in redirect_url:
        // Builder's /cli-auth appends params directly to redirect_url and
        // does not preserve any pre-existing query string we put there.
        const cliAuthUrl = buildBuilderCliAuthUrl(getOrigin(event), null);
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
        // `local@localhost` is the dev/local-mode bypass session. In a
        // hosted production deploy it means either AUTH_MODE=local was
        // misconfigured or AUTH_DISABLED=true is in use — either way the
        // caller isn't a named user we should spend a Builder private key
        // on. Allow it only when the environment explicitly opts into
        // local mode (dev, tests, or AUTH_MODE=local).
        if (
          session.email === DEV_MODE_USER_EMAIL &&
          process.env.NODE_ENV === "production" &&
          process.env.AUTH_MODE !== "local"
        ) {
          setResponseStatus(event, 401);
          return { error: "A signed-in user is required to run Builder" };
        }
        const userEmail = session.email;
        if (!isBuilderBranchingEnabled()) {
          setResponseStatus(event, 403);
          return {
            error:
              "Builder branch creation is not enabled for this deployment. Set ENABLE_BUILDER=true or BUILDER_BRANCH_PROJECT_ID.",
          };
        }
        // Wrap in runWithRequestContext so resolveBuilderCredential() inside
        // runBuilderAgent() resolves per-user app_secrets rather than falling
        // through to process.env — the same pattern the /builder/status endpoint
        // uses. Without this, per-user Builder keys stored in app_secrets are
        // invisible to the run path and the call throws "Builder keys are not
        // configured" even though the status endpoint correctly reports configured=true.
        return runWithRequestContext({ userEmail }, async () => {
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
              projectId: getBuilderBranchProjectId(),
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
        });
      }),
    );

    getH3App(nitroApp).use(
      `${P}/builder/callback`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }

        // Session blocks anonymous callers; the pending-row check below
        // (combined with the same-origin gate on /builder/connect) blocks
        // CSRF. Session cookies are SameSite=None;Secure for the iframe
        // editor, so they ride along on attacker-crafted top-level links —
        // the SameSite=None concession is exactly why the connect flow
        // can't rely on session-cookie identity alone.
        const session = await getSession(event).catch(() => null);
        if (!session?.email) {
          setResponseStatus(event, 401);
          return { error: "Authentication required" };
        }

        const requestUrl = new URL(
          `${event.url?.pathname || "/"}${event.url?.search || ""}`,
          getOrigin(event),
        );

        // Verify and consume the server-side pending-connect row that the
        // /builder/connect route stored. This replaces the old URL-embedded
        // signed CSRF state (_an_state) which Builder's /cli-auth page was
        // stripping from the redirect_url query string.
        //
        // The delete must succeed before we proceed — otherwise a DB blip
        // leaves the row in place and the same callback URL can be
        // replayed against the same session for up to 10 minutes (the
        // TTL window). Treat a delete failure as a hard failure: the
        // user retries, the next /builder/connect call rewrites the
        // pending row.
        let pendingValid = false;
        let pendingError: string | null = null;
        try {
          const pending = (await getSetting(
            `builder-pending-connect:${session.email}`,
          )) as { expiresAt?: number } | null;
          if (
            pending &&
            typeof pending.expiresAt === "number" &&
            Date.now() < pending.expiresAt
          ) {
            try {
              await deleteSetting(`builder-pending-connect:${session.email}`);
              pendingValid = true;
            } catch (err) {
              pendingError =
                "Could not consume pending-connect token (storage error). Please retry.";
              console.error(
                "[builder] deleteSetting failed for pending-connect — refusing to proceed (replay risk):",
                (err as Error)?.message ?? err,
              );
            }
          }
        } catch {
          // DB temporarily unavailable — treat as missing.
        }

        if (pendingError) {
          trackBuilderLifecycle("builder connect failed", session.email, {
            reason: "pending_consume_storage_error",
            stage: "callback",
          });
          // Best-effort signal to the parent's poll loop, then render the
          // popup-friendly error page so the BroadcastChannel notify fires.
          await putSetting(`builder-connect-error:${session.email}`, {
            message: pendingError,
            at: Date.now(),
          }).catch(() => {});
          setResponseStatus(event, 503);
          setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
          return createBuilderBrowserCallbackErrorPage(pendingError);
        }

        if (!pendingValid) {
          trackBuilderLifecycle("builder connect failed", session.email, {
            reason: "missing_pending_connect",
            stage: "callback",
          });
          const msg =
            "No active connect flow found. Restart the Builder connect flow from Settings.";
          // Write an error signal so the polling loop in the parent tab
          // terminates quickly instead of waiting 5 minutes for the timeout.
          try {
            await putSetting(`builder-connect-error:${session.email}`, {
              message: msg,
              at: Date.now(),
            });
          } catch {
            // DB unavailable — parent will time out naturally.
          }
          setResponseStatus(event, 403);
          setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
          return createBuilderBrowserCallbackErrorPage(msg);
        }

        const privateKey = requestUrl.searchParams.get("p-key");
        const publicKey = requestUrl.searchParams.get("api-key");

        if (!privateKey || !publicKey) {
          trackBuilderLifecycle("builder connect failed", session.email, {
            reason: "missing_credentials",
            stage: "callback",
          });
          // Render the popup-friendly error page (and write a status row)
          // instead of bare JSON, so the parent tab's poll loop terminates
          // immediately via BroadcastChannel rather than hanging until the
          // 5-minute timeout.
          const msg =
            "Builder didn't return credentials. Restart the connect flow from settings.";
          await putSetting(`builder-connect-error:${session.email}`, {
            message: msg,
            at: Date.now(),
          }).catch(() => {});
          setResponseStatus(event, 400);
          setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
          return createBuilderBrowserCallbackErrorPage(msg);
        }

        const userId = requestUrl.searchParams.get("user-id");
        const orgName = requestUrl.searchParams.get("org-name");
        const orgKind = requestUrl.searchParams.get("kind");

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
          await writeBuilderCredentials(session.email, {
            privateKey,
            publicKey,
            userId,
            orgName,
            orgKind,
          });
        } catch (err) {
          writeError = (err as Error)?.message ?? String(err);
          console.error(
            "[builder] Failed to persist per-user credentials:",
            writeError,
          );
        }

        if (writeError) {
          trackBuilderLifecycle("builder connect failed", session.email, {
            reason: "credential_write_failed",
            stage: "callback",
          });
          // Best-effort signal to /builder/status. If putSetting also fails
          // (entire DB unreachable) the popup's postMessage still notifies
          // the parent. If both fail the parent times out at 5min as today.
          try {
            await putSetting(`builder-connect-error:${session.email}`, {
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
          setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
          return createBuilderBrowserCallbackErrorPage(writeError);
        }

        // Clear any legacy disconnect flag and any prior connect-error row
        // (so a successful retry doesn't surface the previous failure).
        try {
          await deleteSetting("builder-disconnected");
        } catch {
          // DB not ready — proceed
        }
        try {
          await deleteSetting(`builder-connect-error:${session.email}`);
        } catch {
          // No prior error row — fine
        }

        const previewUrl = resolveSafePreviewUrl(
          requestUrl.searchParams.get("preview-url"),
          event,
        );
        trackBuilderLifecycle("builder connect succeeded", session.email, {
          stage: "callback",
          has_preview_url: Boolean(previewUrl),
          org_kind: orgKind || undefined,
        });
        setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
        return createBuilderBrowserCallbackPage(previewUrl);
      }),
    );

    // POST /_agent-native/builder/disconnect — revoke the user's per-user
    // Builder credentials in app_secrets. In env-managed mode (deploy-level
    // BUILDER_PRIVATE_KEY set) disconnection is operator-controlled — this
    // endpoint refuses with 409 so a stale UI button can't pretend to
    // disconnect a deploy-level identity it doesn't own.
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

        const { isBuilderEnvManaged, deleteBuilderCredentials } =
          await import("./credential-provider.js");
        if (isBuilderEnvManaged()) {
          setResponseStatus(event, 409);
          return {
            ok: false,
            error:
              "Builder is managed by deploy-level BUILDER_PRIVATE_KEY. To disconnect, the operator must remove the env var.",
            envManaged: true,
          };
        }

        // Delete per-user Builder credentials from app_secrets.
        try {
          await deleteBuilderCredentials(session.email);
        } catch (err) {
          trackBuilderLifecycle("builder disconnect failed", session.email, {
            reason: "credential_delete_failed",
          });
          setResponseStatus(event, 500);
          return {
            ok: false,
            error:
              "Could not remove Builder credentials — your connection is unchanged. Please retry.",
            cause: err instanceof Error ? err.message : String(err),
          };
        }

        trackBuilderLifecycle("builder disconnect succeeded", session.email);
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
              process.env.BUILDER_API_HOST || "https://ai-services.builder.io";
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
                  error: redactValues(err, [creds.privateKey, creds.publicKey]),
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
    const frameworkEnvKeys: EnvKeyConfig[] = [
      { key: "ENABLE_BUILDER", label: "Enable Builder.io features" },
      {
        key: "AGENT_ENGINE_PREFER_BYO_KEY",
        label:
          "Prefer BYO LLM key over Builder gateway (default: false — gateway wins)",
      },
      ...Object.values(PROVIDER_ENV_META).map(({ envVar, label }) => ({
        key: envVar,
        label,
      })),
    ];
    {
      const envKeys = [...frameworkEnvKeys, ...(options.envKeys ?? [])];

      // Onboarding form fields are resolved per-request so late-registered
      // steps (and template overrides) are picked up without a restart.
      const collectOnboardingKeys = (): Set<string> => {
        const keys = new Set<string>();
        for (const step of listOnboardingSteps()) {
          for (const method of step.methods) {
            if (method.kind === "form") {
              for (const field of method.payload.fields) {
                if (field?.key) keys.add(field.key);
              }
            }
            if (method.kind === "builder-cli-auth") {
              keys.add("BUILDER_PRIVATE_KEY");
              keys.add("BUILDER_PUBLIC_KEY");
            }
          }
        }
        return keys;
      };

      getH3App(nitroApp).use(
        `${P}/env-status`,
        defineEventHandler(() =>
          envKeys.map((cfg) => ({
            key: cfg.key,
            label: cfg.label,
            required: cfg.required ?? false,
            configured: !!process.env[cfg.key],
            ...(cfg.helpText ? { helpText: cfg.helpText } : {}),
          })),
        ),
      );

      getH3App(nitroApp).use(
        `${P}/env-vars`,
        defineEventHandler(async (event: H3Event) => {
          if (getMethod(event) !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }

          // Env vars are deployment-wide globals, not per-tenant. On any
          // shared-DB multi-tenant deploy, allowing authenticated users to
          // write here lets one tenant overwrite Stripe / OpenAI / Sentry
          // keys for every other tenant. Disable the endpoint outside of
          // local-dev SQLite or an explicit single-tenant opt-in, and
          // direct callers to the per-org credential store instead.
          if (!isEnvVarWriteAllowed()) {
            setResponseStatus(event, 403);
            return {
              error:
                "env-vars endpoint disabled on multi-tenant deployments. Use saveCredential(key, value, { userEmail, orgId, scope: 'org' }) to store per-org credentials.",
            };
          }

          const body = await readBody(event);
          const { vars } = body as {
            vars?: Array<{ key: string; value: string }>;
          };

          if (!Array.isArray(vars) || vars.length === 0) {
            setResponseStatus(event, 400);
            return { error: "vars array required" };
          }

          const allowedKeys = new Set<string>([
            ...envKeys.map((k) => k.key),
            ...collectOnboardingKeys(),
          ]);

          const filtered = vars.filter(
            (v) =>
              typeof v.key === "string" &&
              allowedKeys.has(v.key) &&
              typeof v.value === "string" &&
              v.value.trim().length > 0,
          );
          if (filtered.length === 0) {
            setResponseStatus(event, 400);
            const rejectedEmpty = vars.some(
              (v) =>
                typeof v.key === "string" &&
                allowedKeys.has(v.key) &&
                (typeof v.value !== "string" || v.value.trim().length === 0),
            );
            return {
              error: rejectedEmpty
                ? "Env values must be non-empty — refusing to clear a saved key"
                : "No recognized env keys in request",
            };
          }

          // Write to .env file. When inside a workspace, write to the
          // workspace root .env so keys are shared across every app. The
          // per-app .env still wins at load time if it also defines a key.
          try {
            const scope =
              (body as { scope?: "workspace" | "app" })?.scope ?? "auto";
            const workspaceRoot = findWorkspaceRoot(process.cwd());
            const envPath =
              scope === "app"
                ? path.join(process.cwd(), ".env")
                : workspaceRoot
                  ? path.join(workspaceRoot, ".env")
                  : path.join(process.cwd(), ".env");
            await upsertEnvFile(envPath, filtered);
          } catch {
            // Edge runtime — skip file write
          }

          // Update process.env immediately
          for (const { key, value } of filtered) {
            process.env[key] = value;
          }

          // Persist to settings table for serverless cold-start recovery.
          try {
            const envMap: Record<string, string> = {};
            for (const { key, value } of filtered) envMap[key] = value;
            const existing =
              ((await getSetting("persisted-env-vars")) as Record<
                string,
                string
              > | null) ?? {};
            await putSetting("persisted-env-vars", { ...existing, ...envMap });
          } catch {
            // DB not ready yet — skip
          }

          return { saved: filtered.map((v) => v.key) };
        }),
      );
    }

    // GET /_agent-native/agent-engine/status — reports whether an engine
    // is configured (settings row, settings+env, or auto-detected from env).
    // The agent-chat UI uses this to skip the onboarding gate for providers
    // not in the env-status list (OpenRouter, Groq, Ollama, …).
    getH3App(nitroApp).use(
      `${P}/agent-engine/status`,
      defineEventHandler(async () => {
        try {
          const stored = (await getSetting("agent-engine")) as {
            engine?: string;
          } | null;
          if (isAgentEngineSettingConfigured(stored)) {
            return {
              configured: true,
              engine: (stored as { engine: string }).engine,
              source: "settings" as const,
            };
          }
          if (stored && typeof stored.engine === "string") {
            const entry = getAgentEngineEntry(stored.engine);
            if (entry && isStoredEngineUsable(stored, entry)) {
              return {
                configured: true,
                engine: stored.engine,
                source: "env" as const,
                envVar: entry.requiredEnvVars[0],
              };
            }
          }
          // Per-user app_secrets — a user who connected Builder (or pasted
          // their own provider key) may not have any deploy-level env vars
          // set, so check their per-user secret store before reporting "no
          // engine configured" and re-showing the onboarding gate.
          const detectedFromUser = await detectEngineFromUserSecrets();
          if (detectedFromUser) {
            return {
              configured: true,
              engine: detectedFromUser.name,
              source: "app_secrets" as const,
              envVar: detectedFromUser.requiredEnvVars[0],
            };
          }
          const detected = detectEngineFromEnv();
          if (detected) {
            return {
              configured: true,
              engine: detected.name,
              source: "env" as const,
              envVar: detected.requiredEnvVars[0],
            };
          }
        } catch {}
        return { configured: false };
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
        const { getUsageSummary } = await import("../usage/store.js");
        return getUsageSummary({
          ownerEmail: session.email,
          sinceMs: Date.now() - sinceDays * 86_400_000,
        });
      }),
    );

    // ─── File upload primitive ──────────────────────────────────────
    // GET  /_agent-native/file-upload/status — report active provider
    // POST /_agent-native/file-upload        — upload a file, return { url }
    getH3App(nitroApp).use(
      `${P}/file-upload/status`,
      defineEventHandler(async (event) => {
        const active = getActiveFileUploadProvider();
        // resolveBuilderPrivateKey() reads per-user credentials from app_secrets
        // (DB), which requires request context (AsyncLocalStorage) to know which
        // user to scope by. Without runWithRequestContext() the ALS store is empty
        // and it falls back to process.env only — missing OAuth-connected users.
        const session = await getSession(event).catch(() => null);
        const userEmail = session?.email;
        let builderConfigured = !!process.env.BUILDER_PRIVATE_KEY;
        try {
          const { resolveBuilderPrivateKey } =
            await import("./credential-provider.js");
          const resolve = () => resolveBuilderPrivateKey().then((k) => !!k);
          builderConfigured = userEmail
            ? await runWithRequestContext({ userEmail }, resolve)
            : await resolve();
        } catch {
          // fall back to env check above
        }
        // When the builder builtin is selected via env var, its sync
        // isConfigured() doesn't reflect per-user OAuth credentials. Use the
        // async builderConfigured check so the status accurately represents
        // whether this specific user can actually upload (thread 7 fix).
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
          providers: listFileUploadProviders().map((p) => ({
            id: p.id,
            name: p.name,
            configured: p.isConfigured(),
          })),
          builderConfigured,
        };
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

        const session = await getSession(event);
        if (!session?.email) {
          setResponseStatus(event, 401);
          return { error: "Unauthorized" };
        }
        const userEmail = session.email;
        const result = await runWithRequestContext({ userEmail }, () =>
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
    getH3App(nitroApp).use(`${P}/notifications`, createNotificationsHandler());

    // ─── Tools (mini-app runtime + proxy) ───────────────────────────────
    try {
      const { ensureToolsTables, registerToolsShareable } =
        await import("../tools/store.js");
      const { createToolsHandler } = await import("../tools/routes.js");
      ensureToolsTables().catch(() => {});
      registerToolsShareable();
      getH3App(nitroApp).use(`${P}/tools`, createToolsHandler());

      // Tool extension-point slots — sub-system of tools.
      const { ensureSlotTables } = await import("../tools/slots/store.js");
      const { createSlotsHandler } = await import("../tools/slots/routes.js");
      ensureSlotTables().catch(() => {});
      getH3App(nitroApp).use(`${P}/slots`, createSlotsHandler());
    } catch {
      // Tools module not available — skip
    }

    // ─── Agent run progress ───────────────────────────────────────────
    // GET    /_agent-native/runs[?active&limit]
    // GET    /_agent-native/runs/:id
    // DELETE /_agent-native/runs/:id
    getH3App(nitroApp).use(`${P}/runs`, createProgressHandler());

    // ─── Automations API ──────────────────────────────────────────────
    // GET  /_agent-native/automations — list all automations (parsed triggers)
    // POST /_agent-native/automations/fire-test — emit test.event.fired
    getH3App(nitroApp).use(
      `${P}/automations`,
      defineEventHandler(async (event: H3Event) => {
        const method = getMethod(event);
        const pathname = (event.url?.pathname || "")
          .replace(/^\/+/, "")
          .replace(/\/+$/, "");

        // Auth check applies to every method. Without this, any anonymous
        // caller could `POST /fire-test` to emit unowned events that fan
        // out across every tenant's matching trigger (the dispatcher
        // short-circuits its owner check when `eventMeta.owner` is
        // undefined). See audit 12 / fire-test finding.
        const session = await getSession(event).catch(() => null);
        if (!session?.email) {
          setResponseStatus(event, 401);
          return { error: "Unauthenticated" };
        }

        if (pathname === "fire-test" && method === "POST") {
          try {
            const { emit } = await import("../event-bus/index.js");
            const body = (await readBody(event).catch(() => ({}))) as Record<
              string,
              unknown
            >;
            // Scope the test event to the current user so only their
            // automations fire, not those owned by other tenants.
            emit(
              "test.event.fired",
              { data: body.data ?? {} },
              {
                owner: session.email,
              },
            );
            return { ok: true };
          } catch (err: any) {
            setResponseStatus(event, 500);
            return { error: err?.message ?? "Failed to emit test event" };
          }
        }

        if (method !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }

        try {
          const owner = session.email;
          const { resourceListAllOwners, SHARED_OWNER } =
            await import("../resources/store.js");
          const allResources = await resourceListAllOwners("jobs/");
          const resources = allResources.filter(
            (r) => r.owner === owner || r.owner === SHARED_OWNER,
          );
          const FRONT_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
          const automations = resources
            .filter((r) => r.path.endsWith(".md") && !r.path.endsWith(".keep"))
            .map((r) => {
              const match = r.content.match(FRONT_RE);
              if (!match)
                return {
                  id: r.id,
                  name: r.path.replace(/^jobs\//, "").replace(/\.md$/, ""),
                  path: r.path,
                  owner: r.owner,
                  triggerType: "schedule" as const,
                  enabled: false,
                  mode: "agentic" as const,
                  body: r.content,
                };
              const yaml = match[1];
              const body = match[2].trim();
              const meta: Record<string, string> = {};
              for (const line of yaml.split("\n")) {
                const ci = line.indexOf(":");
                if (ci === -1) continue;
                const k = line.slice(0, ci).trim();
                let v = line.slice(ci + 1).trim();
                if (
                  (v.startsWith('"') && v.endsWith('"')) ||
                  (v.startsWith("'") && v.endsWith("'"))
                )
                  v = v.slice(1, -1);
                meta[k] = v;
              }
              return {
                id: r.id,
                name: r.path.replace(/^jobs\//, "").replace(/\.md$/, ""),
                path: r.path,
                owner: r.owner,
                triggerType: meta.triggerType || "schedule",
                event: meta.event,
                schedule: meta.schedule,
                condition: meta.condition,
                mode: meta.mode || "agentic",
                domain: meta.domain,
                enabled: meta.enabled !== "false",
                lastStatus: meta.lastStatus,
                lastRun: meta.lastRun,
                lastError: meta.lastError,
                createdBy: meta.createdBy,
                body,
              };
            });
          return automations;
        } catch (err: any) {
          setResponseStatus(event, 500);
          return { error: err?.message ?? "Failed to list automations" };
        }
      }),
    );

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
    getH3App(nitroApp).use(
      `${P}/avatar`,
      defineEventHandler(async (event: H3Event) => {
        const method = getMethod(event);
        const emailParam = (event.url?.pathname || "")
          .replace(/^\/+/, "")
          .split("/")[0];

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
          if (!image || !image.startsWith("data:image/")) {
            setResponseStatus(event, 400);
            return { error: "image (data URL) required" };
          }
          await putSetting(`avatar:${session.email}`, { image });
          return { ok: true };
        }

        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }),
    );

    if (!options.disableAppState) {
      // Compose draft routes (more specific path, mounted first so the
      // generic app-state matcher below doesn't shadow them). The framework
      // strips the mount prefix from event.url.pathname before calling us,
      // so we just see e.g. `/abc-123` (id) or `/` (collection root).
      getH3App(nitroApp).use(
        `${P}/application-state/compose`,
        defineEventHandler(async (event: H3Event) => {
          const id =
            (event.url?.pathname || "").replace(/^\/+/, "").split("/")[0] || "";
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
            (event.url?.pathname || "").replace(/^\/+/, "").split("/")[0] || "";
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
