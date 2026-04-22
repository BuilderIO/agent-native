/**
 * Built-in notification channels.
 *
 * Set environment variables to auto-register the webhook channel at startup.
 * Extra channels can be registered at any time via
 * `registerNotificationChannel()` from a server plugin.
 *
 * NOTIFICATIONS_WEBHOOK_URL  → POST notifications as JSON to this URL.
 *                              Supports `${keys.NAME}` substitution — the raw
 *                              value never enters the agent context.
 * NOTIFICATIONS_WEBHOOK_AUTH → optional `Authorization` header value (also
 *                              supports `${keys.NAME}`).
 */

import { registerNotificationChannel } from "./registry.js";
import type { NotificationChannel } from "./types.js";
import {
  resolveKeyReferences,
  validateUrlAllowlist,
  getKeyAllowlist,
} from "../secrets/substitution.js";

let _registered = false;

export function registerBuiltinNotificationChannels(): void {
  if (_registered) return;
  _registered = true;

  const url = process.env.NOTIFICATIONS_WEBHOOK_URL;
  if (url) {
    registerNotificationChannel(createWebhookChannel(url));
  }
}

function createWebhookChannel(urlTemplate: string): NotificationChannel {
  const authTemplate = process.env.NOTIFICATIONS_WEBHOOK_AUTH;
  return {
    name: "webhook",
    async deliver(input, meta) {
      // Resolve `${keys.NAME}` references against the owner's user-scope
      // secrets. Missing keys throw — the error surfaces in logs and the
      // channel is marked un-delivered, but other channels still run.
      const { resolved: url } = await resolveKeyReferences(
        urlTemplate,
        "user",
        meta.owner,
      );
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (authTemplate) {
        const { resolved: auth } = await resolveKeyReferences(
          authTemplate,
          "user",
          meta.owner,
        );
        headers.Authorization = auth;
      }

      // If the user set an allowlist on a referenced key, enforce it here.
      // Origin-level check — same rule the automations fetch-tool uses.
      for (const match of urlTemplate.matchAll(
        /\$\{keys\.([A-Za-z0-9_-]+)\}/g,
      )) {
        const allowlist = await getKeyAllowlist(match[1], "user", meta.owner);
        if (!validateUrlAllowlist(url, allowlist)) {
          throw new Error(
            `[notifications] webhook URL ${new URL(url).origin} is not in the allowlist for key "${match[1]}"`,
          );
        }
      }

      await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          severity: input.severity,
          title: input.title,
          body: input.body,
          metadata: input.metadata,
          owner: meta.owner,
          emittedAt: new Date().toISOString(),
        }),
      });
    },
  };
}
