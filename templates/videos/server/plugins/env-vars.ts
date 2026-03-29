import { defineNitroPlugin } from "@agent-native/core/server";
import { defineEventHandler, readBody, setResponseStatus, getMethod } from "h3";

const ALLOWED_KEYS = new Set([
  "DATABASE_URL",
  "DATABASE_AUTH_TOKEN",
  "TURNSTILE_SECRET_KEY",
  "VITE_TURNSTILE_SITE_KEY",
]);

/**
 * Registers /api/env-vars endpoint so the CloudUpgrade UI
 * can save database credentials to .env and process.env.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.h3App.use(
    "/api/env-vars",
    defineEventHandler(async (event) => {
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

      const filtered = vars.filter((v) => ALLOWED_KEYS.has(v.key));
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
