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
import path from "path";
import { agentEnv } from "../shared/agent-env.js";
import { readBody } from "../server/h3-helpers.js";
import { isDevEnvironment } from "./auth.js";
import { isLocalDatabase } from "../db/client.js";

/**
 * Mirror of `isEnvVarWriteAllowed` in core-routes-plugin.ts. See the comment
 * there — env vars are deployment-wide globals and writes from authenticated
 * users would let one tenant overwrite shared Stripe / OpenAI / Sentry keys
 * for every other tenant on shared-DB hosted templates.
 */
function isEnvVarWriteAllowed(): boolean {
  if (process.env.AGENT_NATIVE_ALLOW_ENV_VAR_WRITES === "1") return true;
  return isDevEnvironment() && isLocalDatabase();
}

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
  /** Env key configuration for the settings UI. Enables /_agent-native/env-status and /_agent-native/env-vars routes. */
  envKeys?: EnvKeyConfig[];
}

/**
 * Parse a .env file into key-value pairs, preserving comments and empty lines for roundtrip.
 */
function parseEnvFile(content: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars.set(key, value);
  }
  return vars;
}

/**
 * Upsert vars into a .env file, preserving existing structure.
 */
export async function upsertEnvFile(
  envPath: string,
  vars: Array<{ key: string; value: string }>,
): Promise<void> {
  // Sanitize: reject values that could inject additional env vars
  for (const { key, value } of vars) {
    if (/[\n\r\0]/.test(value)) {
      throw new Error(
        `Invalid env var value for ${key}: must not contain newlines or control characters`,
      );
    }
  }

  const fs = await import("fs");

  let content = "";
  try {
    content = fs.readFileSync(envPath, "utf-8");
  } catch {
    // File doesn't exist yet
  }

  const lines = content.split("\n");
  const remaining = new Map(vars.map((v) => [v.key, v.value]));

  // Update existing lines in place
  const updated = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) return line;
    const key = trimmed.slice(0, eqIndex).trim();
    if (remaining.has(key)) {
      const value = remaining.get(key)!;
      remaining.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });

  // Append new vars
  for (const [key, value] of remaining) {
    updated.push(`${key}=${value}`);
  }

  // Ensure trailing newline
  let result = updated.join("\n");
  if (!result.endsWith("\n")) result += "\n";

  try {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, result);
  } catch {
    // Edge runtimes don't have writable filesystem — skip silently
  }
}

export interface CreateServerResult {
  app: ReturnType<typeof createApp>;
  router: ReturnType<typeof createRouter>;
}

/**
 * Create a pre-configured H3 app with standard agent-native setup:
 * - CORS headers via middleware
 * - /_agent-native/ping health check
 * - /_agent-native/env-status and /_agent-native/env-vars (when envKeys is provided)
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
    const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
      ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim())
      : null;
    const isProduction = process.env.NODE_ENV === "production";

    /**
     * Localhost-style origins that we treat as same-trust in development.
     * When CORS_ALLOWED_ORIGINS is unset we still allow these (desktop tray
     * windows on a sibling port, the docs site at localhost:5173, etc.) but
     * in production an unset allowlist means no cross-origin credentials.
     */
    const LOCALHOST_RE =
      /^https?:\/\/(localhost|127\.0\.0\.1|tauri\.localhost)(:\d+)?$/;

    app.use(
      defineEventHandler((event) => {
        const requestOrigin = getRequestHeader(event, "origin");
        const method = getMethod(event);

        /**
         * Decide whether the requesting origin is allowed. We never fall back
         * to "the first allowlist entry" when the origin isn't in the list —
         * that previously sent `Access-Control-Allow-Origin: <other-origin>`
         * with credentials enabled to attacker-controlled origins, which was
         * permissive enough that some clients followed through with the
         * credentialed request.
         */
        let allowedOrigin: string | null = null;
        if (allowedOrigins && allowedOrigins.length > 0) {
          if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
            allowedOrigin = requestOrigin;
          }
          // Origin not in the explicit allowlist — emit no ACAO header.
        } else if (requestOrigin) {
          // No allowlist configured. In production we refuse credentialed
          // cross-origin requests except from localhost (desktop tray app
          // dev usage); in dev we allow any origin echo.
          if (isProduction) {
            if (LOCALHOST_RE.test(requestOrigin)) {
              allowedOrigin = requestOrigin;
            }
            // else: production + no allowlist + non-localhost origin → no ACAO
          } else {
            allowedOrigin = requestOrigin;
          }
        }
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
          setResponseHeader(event, "Access-Control-Allow-Credentials", "true");
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
          "Content-Type,Authorization,X-Requested-With,X-Request-Source,X-Agent-Native-CSRF",
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
  app.use(router);

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

    router.get(
      "/_agent-native/env-status",
      defineEventHandler(() => {
        return envKeys.map((cfg) => ({
          key: cfg.key,
          label: cfg.label,
          required: cfg.required ?? false,
          configured: !!process.env[cfg.key],
          ...(cfg.helpText ? { helpText: cfg.helpText } : {}),
        }));
      }),
    );

    router.post(
      "/_agent-native/env-vars",
      defineEventHandler(async (event: H3Event) => {
        // Env vars are deployment-wide globals — see isEnvVarWriteAllowed
        // above. Disable the endpoint on any multi-tenant deploy.
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

        // Only allow keys that are in the env config
        const allowedKeys = new Set(envKeys.map((k) => k.key));
        const filtered = vars.filter((v) => allowedKeys.has(v.key));
        if (filtered.length === 0) {
          setResponseStatus(event, 400);
          return { error: "No recognized env keys in request" };
        }

        // Write to .env file
        const envPath = path.join(process.cwd(), ".env");
        await upsertEnvFile(envPath, filtered);

        // Update process.env so the app picks up the new values immediately
        for (const { key, value } of filtered) {
          process.env[key] = value;
        }

        // Notify parent (Builder or frame) via postMessage
        agentEnv.setVars(filtered);

        return { saved: filtered.map((v) => v.key) };
      }),
    );
  }

  return { app, router };
}
