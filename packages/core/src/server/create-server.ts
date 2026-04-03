import {
  createApp,
  createRouter,
  defineEventHandler,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import fs from "fs";
import path from "path";
import { agentEnv } from "../shared/agent-env.js";

export interface EnvKeyConfig {
  /** Environment variable name (e.g. "HUBSPOT_ACCESS_TOKEN") */
  key: string;
  /** Human-readable label (e.g. "HubSpot") */
  label: string;
  /** Whether this key is required for the app to function */
  required?: boolean;
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
export function upsertEnvFile(
  envPath: string,
  vars: Array<{ key: string; value: string }>,
): void {
  // Sanitize: reject values that could inject additional env vars
  for (const { key, value } of vars) {
    if (/[\n\r\0]/.test(value)) {
      throw new Error(
        `Invalid env var value for ${key}: must not contain newlines or control characters`,
      );
    }
  }

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

  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, result);
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
      console.error("[agent-native] Server error:", error);
    },
  });

  // CORS middleware
  if (options.cors !== false) {
    const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
      ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim())
      : null;

    app.use(
      defineEventHandler((event) => {
        const headers = event.node.res;
        const requestOrigin = event.node.req.headers.origin;

        // If allowlist is configured, validate origin; otherwise allow all (dev)
        const origin =
          allowedOrigins && requestOrigin
            ? allowedOrigins.includes(requestOrigin)
              ? requestOrigin
              : allowedOrigins[0]
            : requestOrigin || "*";
        headers.setHeader("Access-Control-Allow-Origin", origin);
        if (origin !== "*") {
          headers.setHeader("Vary", "Origin");
        }
        headers.setHeader(
          "Access-Control-Allow-Methods",
          "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        );
        headers.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type,Authorization,X-Requested-With",
        );

        if (event.node.req.method === "OPTIONS") {
          headers.writeHead(204);
          headers.end();
          return null;
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
        }));
      }),
    );

    router.post(
      "/_agent-native/env-vars",
      defineEventHandler(async (event: H3Event) => {
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
        upsertEnvFile(envPath, filtered);

        // Update process.env so the app picks up the new values immediately
        for (const { key, value } of filtered) {
          process.env[key] = value;
        }

        // Notify parent (Builder or harness) via postMessage
        agentEnv.setVars(filtered);

        return { saved: filtered.map((v) => v.key) };
      }),
    );
  }

  return { app, router };
}
