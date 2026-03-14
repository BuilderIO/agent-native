import express from "express";
import cors from "cors";
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
  /** CORS options. Pass false to disable. Default: enabled with defaults. */
  cors?: cors.CorsOptions | false;
  /** JSON body parser limit. Default: "50mb" */
  jsonLimit?: string;
  /** Custom ping message. Default: reads PING_MESSAGE env var, falls back to "pong" */
  pingMessage?: string;
  /** Disable the /api/ping health check. Default: false */
  disablePing?: boolean;
  /** Env key configuration for the settings UI. Enables /api/env-status and /api/env-vars routes. */
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
function upsertEnvFile(
  envPath: string,
  vars: Array<{ key: string; value: string }>,
): void {
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

/**
 * Create a pre-configured Express app with standard agent-native middleware:
 * - CORS
 * - JSON body parser (50mb limit)
 * - URL-encoded body parser
 * - /api/ping health check
 * - /api/env-status and /api/env-vars (when envKeys is provided)
 */
export function createServer(
  options: CreateServerOptions = {},
): express.Express {
  const app = express();

  // Middleware
  if (options.cors !== false) {
    app.use(cors(options.cors));
  }
  app.use(express.json({ limit: options.jsonLimit ?? "50mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Health check
  if (!options.disablePing) {
    app.get("/api/ping", (_req, res) => {
      const message = options.pingMessage ?? process.env.PING_MESSAGE ?? "pong";
      res.json({ message });
    });
  }

  // Env key management routes
  if (options.envKeys) {
    const envKeys = options.envKeys;

    app.get("/api/env-status", (_req, res) => {
      res.json(
        envKeys.map((cfg) => ({
          key: cfg.key,
          label: cfg.label,
          required: cfg.required ?? false,
          configured: !!process.env[cfg.key],
        })),
      );
    });

    app.post("/api/env-vars", (req, res) => {
      const { vars } = req.body as {
        vars?: Array<{ key: string; value: string }>;
      };
      if (!Array.isArray(vars) || vars.length === 0) {
        res.status(400).json({ error: "vars array required" });
        return;
      }

      // Only allow keys that are in the env config
      const allowedKeys = new Set(envKeys.map((k) => k.key));
      const filtered = vars.filter((v) => allowedKeys.has(v.key));
      if (filtered.length === 0) {
        res.status(400).json({ error: "No recognized env keys in request" });
        return;
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

      res.json({ saved: filtered.map((v) => v.key) });
    });
  }

  return app;
}
