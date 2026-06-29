import {
  createApp,
  createRouter,
  defineEventHandler,
  getMethod,
  getRequestHeader,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getOrgContext } from "../org/context.js";
import { readBody } from "../server/h3-helpers.js";
import { EMBED_TARGET_HEADER } from "../shared/embed-auth.js";
import {
  EMBED_TRANSPLANT_HEADER,
  isMcpEmbedCorsOrigin,
  MCP_EMBED_CORS_ALLOW_HEADERS,
  shouldAllowMcpEmbedCredentials,
} from "../shared/mcp-embed-headers.js";
import { getSession } from "./auth.js";
import {
  getAllowedCorsOrigin,
  readCorsAllowedOrigins,
} from "./cors-origins.js";
import { resolveSecret } from "./credential-provider.js";
import { runWithRequestContext } from "./request-context.js";
import {
  findUnsupportedScopedKeyNames,
  saveKeyValuesToScopedSecrets,
  ScopedKeyStorageError,
  type ScopedKeySaveRequestScope,
} from "./scoped-key-storage.js";

export interface EnvKeyConfig {
  /** Environment variable name (e.g. "HUBSPOT_ACCESS_TOKEN") */
  key: string;
  /** Human-readable label (e.g. "HubSpot") */
  label: string;
  /** Whether this key is required for the app to function */
  required?: boolean;
  /** Optional UI hint shown next to the field describing where to find this value. */
  helpText?: string;
}

export interface CreateServerOptions {
  /** CORS options. Ignored (H3 handles CORS via middleware). Default: enabled. */
  cors?: Record<string, unknown> | false;
  /** JSON body parser limit. Kept for API compatibility (H3 uses readBody). */
  jsonLimit?: string;
  /** Custom ping message. Default: reads PING_MESSAGE env var, falls back to "pong" */
  pingMessage?: string;
  /** Disable the /_agent-native/ping health check. Default: false */
  disablePing?: boolean;
  /** Key configuration for the settings UI. Enables status plus the scoped-secret compatibility save route. */
  envKeys?: EnvKeyConfig[];
}

export interface CreateServerResult {
  app: ReturnType<typeof createApp>;
  router: ReturnType<typeof createRouter>;
}

/**
 * Create a pre-configured H3 app with standard agent-native setup:
 * - CORS headers via middleware
 * - /_agent-native/ping health check
 * - /_agent-native/env-status and the scoped-secret compatibility save route
 *   at /_agent-native/env-vars (when envKeys is provided)
 *
 * Returns { app, router } — mount routes on `router`.
 */
export function createServer(
  options: CreateServerOptions = {},
): CreateServerResult {
  const app = createApp({
    onError(error, event) {
      // Suppress connection-reset errors — client disconnected mid-request (tab close, reload)
      const err = error as NodeJS.ErrnoException;
      const code = err?.code || (err?.cause as NodeJS.ErrnoException)?.code;
      if (code === "ECONNRESET" || code === "ECONNABORTED") return;
      if (err?.message === "aborted") return;
      console.error(
        `[agent-native] Server error: ${event.method} ${event.path}`,
        error,
      );
    },
  });

  // CORS middleware
  if (options.cors !== false) {
    const allowedOrigins = readCorsAllowedOrigins();
    const isProduction = process.env.NODE_ENV === "production";

    /**
     * When CORS_ALLOWED_ORIGINS is unset, production only allows trusted
     * localhost/native desktop origins. Development keeps the legacy "echo
     * any origin" behavior so local tools and docs previews keep working.
     */
    app.use(
      defineEventHandler((event) => {
        const requestOrigin = getRequestHeader(event, "origin");
        const method = getMethod(event);
        const requestedHeaders = String(
          getRequestHeader(event, "access-control-request-headers") ?? "",
        )
          .toLowerCase()
          .split(",")
          .map((header) => header.trim());
        const embedCorsRequest =
          isMcpEmbedCorsOrigin(requestOrigin) &&
          (requestedHeaders.includes(EMBED_TARGET_HEADER.toLowerCase()) ||
            requestedHeaders.includes(EMBED_TRANSPLANT_HEADER) ||
            Boolean(getRequestHeader(event, EMBED_TARGET_HEADER)) ||
            Boolean(getRequestHeader(event, EMBED_TRANSPLANT_HEADER)) ||
            Boolean(getRequestHeader(event, "authorization")));

        /**
         * Decide whether the requesting origin is allowed. We never fall back
         * to "the first allowlist entry" when the origin isn't in the list —
         * that previously sent `Access-Control-Allow-Origin: <other-origin>`
         * with credentials enabled to attacker-controlled origins, which was
         * permissive enough that some clients followed through with the
         * credentialed request.
         */
        const allowedOrigin = embedCorsRequest
          ? requestOrigin
          : getAllowedCorsOrigin(requestOrigin, {
              allowedOrigins,
              allowAnyOriginWhenNoAllowlist: !isProduction,
              // Let the cors-origins default apply (dev-only). Passing `true`
              // here unconditionally would re-open the production localhost gap.
            });
        // No origin header at all (same-origin fetch, server-to-server) and
        // no allowlist → fall through with `*`-equivalent behaviour: omit
        // ACAO entirely and let the browser apply its same-origin default.

        if (allowedOrigin) {
          setResponseHeader(
            event,
            "Access-Control-Allow-Origin",
            allowedOrigin,
          );
          setResponseHeader(event, "Vary", "Origin");
          // A specific origin means we can honor credentialed requests
          // (fetch with `credentials: "include"` — used by desktop tray
          // apps that share a same-site cookie with the web app). The
          // wildcard `*` is spec-incompatible with credentials, so only
          // set this when we're echoing a concrete origin.
          if (shouldAllowMcpEmbedCredentials(allowedOrigin)) {
            setResponseHeader(
              event,
              "Access-Control-Allow-Credentials",
              "true",
            );
          }
        } else if (!requestOrigin) {
          // No origin header — preserve the legacy permissive behaviour for
          // tools/scripts that hit the API directly (no credentialed CORS
          // semantics apply when there's no Origin).
          setResponseHeader(event, "Access-Control-Allow-Origin", "*");
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

        if (method === "OPTIONS") {
          // Reject preflights from disallowed cross-origin callers. We only
          // 204 if either (a) there was no Origin header (same-origin or
          // direct script invocation) or (b) the origin was in the allowlist
          // / dev fallback above. Otherwise we 403 so the browser surfaces
          // a hard CORS failure rather than blindly retrying with credentials.
          if (requestOrigin && !allowedOrigin) {
            return new Response(null, { status: 403 });
          }
          return new Response(null, { status: 204 });
        }
      }),
    );
  }

  const router = createRouter();

  // Health check
  if (!options.disablePing) {
    router.get(
      "/_agent-native/ping",
      defineEventHandler(() => {
        const message =
          options.pingMessage ?? process.env.PING_MESSAGE ?? "pong";
        return { message };
      }),
    );
  }

  // Env key management routes
  if (options.envKeys) {
    const envKeys = options.envKeys;
    const allowedEnvKeyNames = envKeys.map(({ key }) => key);

    router.get(
      "/_agent-native/env-status",
      defineEventHandler(async (event) => {
        const session = await getSession(event).catch(() => null);
        const userEmail = session?.email;
        let orgId: string | undefined;
        if (userEmail) {
          const orgCtx = await getOrgContext(event).catch(() => null);
          orgId = orgCtx?.orgId ?? undefined;
        }
        return Promise.all(
          envKeys.map(async (cfg) => ({
            key: cfg.key,
            label: cfg.label,
            required: cfg.required ?? false,
            configured:
              Boolean(process.env[cfg.key]) ||
              (await runWithRequestContext({ userEmail, orgId }, () =>
                resolveSecret(cfg.key).then(Boolean),
              )),
            ...(cfg.helpText ? { helpText: cfg.helpText } : {}),
          })),
        );
      }),
    );

    router.post(
      "/_agent-native/env-vars",
      defineEventHandler(async (event: H3Event) => {
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
          const result = await saveKeyValuesToScopedSecrets(event, vars, scope);
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

  app.use(router);
  return { app, router };
}
