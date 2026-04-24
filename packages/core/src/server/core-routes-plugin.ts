import { getH3App, awaitBootstrap } from "./framework-request-handler.js";
import {
  defineEventHandler,
  setResponseStatus,
  setResponseHeader,
  getMethod,
} from "h3";
import type { H3Event } from "h3";
import path from "node:path";
import { createPollHandler } from "./poll.js";
import { createSSEHandler } from "./sse.js";
import { upsertEnvFile } from "./create-server.js";
import type { EnvKeyConfig } from "./create-server.js";
import { readBody } from "./h3-helpers.js";
import {
  createBuilderBrowserCallbackPage,
  getBuilderBrowserStatusForEvent,
  getBuilderCallbackEnvVars,
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
import { getSession } from "./auth.js";
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
import { registerBuiltinNotificationChannels } from "../notifications/channels.js";
import { createNotificationsHandler } from "../notifications/routes.js";
import { createProgressHandler } from "../progress/routes.js";
import { createTranscribeVoiceHandler } from "./transcribe-voice.js";
import { PROVIDER_ENV_META } from "../agent/engine/provider-env-vars.js";
import {
  isAgentEngineSettingConfigured,
  getAgentEngineEntry,
  detectEngineFromEnv,
  isStoredEngineUsable,
} from "../agent/engine/registry.js";

/**
 * The base path prefix for all framework-level routes.
 * All agent-native core routes live under this namespace to avoid
 * collisions with template-specific `/api/*` routes.
 */
export const FRAMEWORK_ROUTE_PREFIX = "/_agent-native";

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
// All env vars written by the Builder CLI-auth callback. Listed once so
// the plugin-init scrub, the /builder/disconnect handler, and any future
// consumers stay in sync — drift here is how a disconnect silently leaves
// BUILDER_USER_ID or BUILDER_ORG_NAME behind.
const BUILDER_ENV_KEYS: readonly string[] = [
  "BUILDER_PRIVATE_KEY",
  "BUILDER_PUBLIC_KEY",
  "BUILDER_USER_ID",
  "BUILDER_ORG_NAME",
  "BUILDER_ORG_KIND",
];

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
    try {
      const persisted = (await getSetting("persisted-env-vars")) as Record<
        string,
        string
      > | null;
      if (persisted) {
        for (const [k, v] of Object.entries(persisted)) {
          if (typeof v === "string" && !process.env[k]) {
            process.env[k] = v;
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

    const P = FRAMEWORK_ROUTE_PREFIX;

    // CORS for framework routes. Desktop tray apps (Tauri/Electron) run on
    // their own dev origin (e.g. localhost:1420) and make credentialed
    // requests against the template's server at a different port. We echo
    // the exact origin + Allow-Credentials so same-site localhost ports
    // can cross-send cookies.
    const allowlist = (process.env.CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    getH3App(nitroApp).use(
      defineEventHandler((event) => {
        const url = event.node?.req?.url ?? event.path ?? "/";
        if (!url.startsWith(P) && !url.startsWith("/api/")) return;
        const reqHeaders = (event.node?.req?.headers ?? {}) as Record<
          string,
          string | string[] | undefined
        >;
        const originRaw = reqHeaders["origin"];
        const origin = Array.isArray(originRaw) ? originRaw[0] : originRaw;
        if (!origin) return;
        const allowed =
          allowlist.length === 0 ||
          allowlist.includes(origin) ||
          // Dev convenience: allow any localhost origin (tray windows,
          // frame, docs) without requiring an explicit allowlist.
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
        if (!allowed) return;
        setResponseHeader(event, "Access-Control-Allow-Origin", origin);
        setResponseHeader(event, "Vary", "Origin");
        setResponseHeader(event, "Access-Control-Allow-Credentials", "true");
        setResponseHeader(
          event,
          "Access-Control-Allow-Methods",
          "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        );
        setResponseHeader(
          event,
          "Access-Control-Allow-Headers",
          "Content-Type,Authorization,X-Requested-With",
        );
        if (getMethod(event) === "OPTIONS") {
          setResponseStatus(event, 204);
          return "";
        }
      }),
    );

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
        const status = getBuilderBrowserStatusForEvent(event);
        // Honor the SQL disconnect flag even when process.env still has
        // BUILDER_* (dev env-runner weirdness — see plugin init above).
        try {
          const disconnected = await getSetting("builder-disconnected");
          if (disconnected) {
            return {
              ...status,
              configured: false,
              privateKeyConfigured: false,
              publicKeyConfigured: false,
              userId: undefined,
              orgName: undefined,
              orgKind: undefined,
            };
          }
        } catch {
          // DB not reachable — fall back to env-only status.
        }
        return status;
      }),
    );

    // Lightweight 302 to the Builder CLI-auth URL. Lets clients do
    // `window.open('/_agent-native/builder/connect', '_blank')` synchronously
    // inside a click handler, avoiding the popup-blocker downgrade that
    // happens when an await sits before window.open.
    getH3App(nitroApp).use(
      `${P}/builder/connect`,
      defineEventHandler((event) => {
        const status = getBuilderBrowserStatusForEvent(event);
        setResponseStatus(event, 302);
        setResponseHeader(event, "Location", status.connectUrl);
        return "";
      }),
    );

    // Hardcoded for the early preview — later this will come from workspace/org
    // config so each team can point at its own Builder project.
    const DEFAULT_BUILDER_PROJECT_ID = "274d28fec94b48f2b2d68f2274d390eb";

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
          session.email === "local@localhost" &&
          process.env.NODE_ENV === "production" &&
          process.env.AUTH_MODE !== "local"
        ) {
          setResponseStatus(event, 401);
          return { error: "A signed-in user is required to run Builder" };
        }
        const userEmail = session.email;
        const builderUserId = process.env.BUILDER_USER_ID || undefined;
        // Server-controlled projectId — don't let clients target arbitrary
        // Builder projects with our private key. When this feature graduates
        // past the hardcoded preview, the projectId will come from
        // workspace/org config, still resolved server-side.
        try {
          const result = await runBuilderAgent({
            prompt,
            projectId: DEFAULT_BUILDER_PROJECT_ID,
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
      }),
    );

    getH3App(nitroApp).use(
      `${P}/builder/callback`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }

        const requestUrl = new URL(
          `${event.url?.pathname || "/"}${event.url?.search || ""}`,
          getOrigin(event),
        );
        const privateKey = requestUrl.searchParams.get("p-key");
        const publicKey = requestUrl.searchParams.get("api-key");

        if (!privateKey || !publicKey) {
          setResponseStatus(event, 400);
          return { error: "Missing Builder credentials in callback" };
        }

        const vars = getBuilderCallbackEnvVars({
          privateKey,
          publicKey,
          userId: requestUrl.searchParams.get("user-id"),
          orgName: requestUrl.searchParams.get("org-name"),
          orgKind: requestUrl.searchParams.get("kind"),
        });

        // Clear the disconnect flag first — a prior disconnect would
        // otherwise cause the plugin init to scrub these keys right back
        // out on the next env-runner reload.
        try {
          await deleteSetting("builder-disconnected");
        } catch {
          // DB not ready — proceed; the worst case is a stale disconnect
          // flag that gets cleared on the next reconnect attempt.
        }

        // Prefer the workspace root .env when in an enterprise workspace so
        // Builder credentials are shared across every app automatically.
        try {
          const workspaceRoot = findWorkspaceRoot(process.cwd());
          const envPath = workspaceRoot
            ? path.join(workspaceRoot, ".env")
            : path.join(process.cwd(), ".env");
          await upsertEnvFile(envPath, vars);
        } catch {
          // Edge runtime — skip file write
        }

        for (const { key, value } of vars) {
          process.env[key] = value;
        }

        // Persist to settings table so serverless cold starts can
        // restore credentials (.env writes don't survive on Netlify).
        try {
          const envMap: Record<string, string> = {};
          for (const { key, value } of vars) envMap[key] = value;
          const existing =
            ((await getSetting("persisted-env-vars")) as Record<
              string,
              string
            > | null) ?? {};
          await putSetting("persisted-env-vars", { ...existing, ...envMap });
        } catch {
          // DB not ready yet — skip
        }

        const previewUrl = resolveSafePreviewUrl(
          requestUrl.searchParams.get("preview-url"),
          event,
        );
        setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
        return createBuilderBrowserCallbackPage(previewUrl);
      }),
    );

    // POST /_agent-native/builder/disconnect — revoke the stored Builder
    // credentials so the next turn falls back to BYO / env detection. Mirrors
    // the callback handler's three write locations: the template `.env` file,
    // the in-process `process.env`, and the `persisted-env-vars` settings row
    // (rehydrated on serverless cold starts). All three must be cleared to
    // avoid a "still connected after disconnect" state on restart.
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

        // We intentionally do NOT rewrite the `.env` file on disconnect.
        // A `.env` write triggers nitro's file watcher → env-runner
        // restart, which tears down in-flight SSE / HMR connections and
        // surfaces as `read ECONNRESET` in the vite overlay. The
        // authoritative disconnect signal is the SQL `builder-disconnected`
        // flag (checked in plugin init, the status endpoint, and the
        // Builder engine before any gateway call). `.env` keys, if any
        // survive, are neutered by the flag-driven scrub in plugin init.

        // 1. Write the disconnect flag. This is load-bearing — every
        // subsequent check (plugin init scrub, /builder/status override,
        // BuilderEngine.stream short-circuit) reads this flag. If the
        // write fails, we FAIL HARD: clearing process.env without
        // persisting the flag means the next env-runner reload would
        // silently restore BUILDER_* from whatever inherited env the
        // worker was spawned with, and the user would see "Disconnected"
        // in the UI that flips back to "Connected" moments later.
        try {
          await putSetting("builder-disconnected", { at: Date.now() });
        } catch (err) {
          setResponseStatus(event, 500);
          return {
            ok: false,
            error:
              "Could not persist disconnect flag — your Builder connection is unchanged. Please retry.",
            cause: err instanceof Error ? err.message : String(err),
          };
        }

        // 2. Scrub the persisted-env-vars row so serverless cold starts
        // don't rehydrate BUILDER_* from SQL. Best-effort: the disconnect
        // flag above already prevents Builder from being used; this is
        // cleanup.
        let warnPersisted: string | undefined;
        try {
          const existing =
            ((await getSetting("persisted-env-vars")) as Record<
              string,
              string
            > | null) ?? {};
          const cleaned: Record<string, string> = {};
          for (const [k, v] of Object.entries(existing)) {
            if (!BUILDER_ENV_KEYS.includes(k)) cleaned[k] = v;
          }
          await putSetting("persisted-env-vars", cleaned);
        } catch (err) {
          warnPersisted = err instanceof Error ? err.message : String(err);
        }

        // 3. Clear in-process env vars so the current worker stops routing
        // through Builder immediately. Nitro's env-runner may re-populate
        // these across a module reload, but by then the `builder-disconnected`
        // flag will be enforced at the plugin-init scrub.
        for (const key of BUILDER_ENV_KEYS) {
          delete process.env[key];
        }

        return {
          ok: true,
          ...(warnPersisted
            ? { warnings: { persistedEnvVars: warnPersisted } }
            : {}),
        };
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
        const privateKey = process.env.BUILDER_PRIVATE_KEY;
        const publicKey = process.env.BUILDER_PUBLIC_KEY;
        if (!privateKey || !publicKey) {
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
            `${apiHost}/agents/run?apiKey=${encodeURIComponent(publicKey)}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${privateKey}`,
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
            return { error: err };
          }
          return await res.json();
        } catch (err: any) {
          setResponseStatus(event, 500);
          return {
            error: err?.message || "Failed to reach Builder agents-run API",
          };
        }
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
      defineEventHandler(() => {
        const active = getActiveFileUploadProvider();
        return {
          configured: !!active,
          activeProvider: active ? { id: active.id, name: active.name } : null,
          providers: listFileUploadProviders().map((p) => ({
            id: p.id,
            name: p.name,
            configured: p.isConfigured(),
          })),
          builderConfigured: !!process.env.BUILDER_PRIVATE_KEY,
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
        const result = await uploadFile({
          data: filePart.data,
          filename: filePart.filename,
          mimeType: filePart.type,
          ownerEmail: session?.email,
        });

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

        if (pathname === "fire-test" && method === "POST") {
          try {
            const { emit } = await import("../event-bus/index.js");
            const body = (await readBody(event).catch(() => ({}))) as Record<
              string,
              unknown
            >;
            emit("test.event.fired", { data: body.data ?? {} });
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
          const session = await getSession(event).catch(() => null);
          const owner = session?.email || "local@localhost";
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
