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
import { getSetting, putSetting } from "../settings/store.js";
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
export function createCoreRoutesPlugin(
  options: CoreRoutesPluginOptions = {},
): NitroPluginDef {
  return async (nitroApp: any) => {
    // No-op when called from inside the bootstrap (auto-mount path).
    // Otherwise wait so other default plugins finish mounting first.
    await awaitBootstrap(nitroApp);

    const P = FRAMEWORK_ROUTE_PREFIX;

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
      defineEventHandler((event) => getBuilderBrowserStatusForEvent(event)),
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

        const previewUrl = resolveSafePreviewUrl(
          requestUrl.searchParams.get("preview-url"),
          event,
        );
        setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
        return createBuilderBrowserCallbackPage(previewUrl);
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

          return { saved: filtered.map((v) => v.key) };
        }),
      );
    }

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
