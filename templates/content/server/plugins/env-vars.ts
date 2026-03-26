import { defineNitroPlugin } from "@agent-native/core";
import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { envKeys } from "../lib/env-config.js";

/**
 * Registers /api/env-status and /api/env-vars endpoints
 * so the UI can check and save Notion OAuth credentials.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.h3App.use(
    "/api/env-status",
    defineEventHandler(() =>
      envKeys.map((cfg) => ({
        key: cfg.key,
        label: cfg.label,
        required: cfg.required ?? false,
        configured: !!process.env[cfg.key],
      })),
    ),
  );

  nitroApp.h3App.use(
    "/api/env-vars",
    defineEventHandler(async (event) => {
      const { getMethod } = await import("h3");
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

      const allowedKeys = new Set(envKeys.map((k) => k.key));
      const filtered = vars.filter((v) => allowedKeys.has(v.key));
      if (filtered.length === 0) {
        setResponseStatus(event, 400);
        return { error: "No recognized env keys in request" };
      }

      // Write to .env file
      try {
        const path = await import("path");
        const { upsertEnvFile } = await import(
          "@agent-native/core/server" as string
        );
        const envPath = path.join(process.cwd(), ".env");
        (upsertEnvFile as Function)(envPath, filtered);
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
});
