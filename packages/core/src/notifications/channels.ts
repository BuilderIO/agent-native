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

      // If the user set an allowlist on a referenced key, enforce it here —
      // origin-level check, same rule the automations fetch-tool applies.
      const keyNames = Array.from(
        new Set(
          Array.from(
            urlTemplate.matchAll(/\$\{keys\.([A-Za-z0-9_-]+)\}/g),
            (m) => m[1],
          ),
        ),
      );
      const allowlists = await Promise.all(
        keyNames.map((name) => getKeyAllowlist(name, "user", meta.owner)),
      );
      keyNames.forEach((name, i) => {
        if (!validateUrlAllowlist(url, allowlists[i])) {
          throw new Error(
            `[notifications] webhook URL ${new URL(url).origin} is not in the allowlist for key "${name}"`,
          );
        }
      });

      const res = await fetch(url, {
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
      if (!res.ok) {
        throw new Error(
          `[notifications] webhook ${new URL(url).origin} returned ${res.status}${
            (await readErrorSnippet(res)) || ""
          }`,
        );
      }
    },
  };
}

/**
 * Read up to ~1 KB from the body for error context. Streams chunks so a
 * misbehaving endpoint returning a large error page doesn't pin that whole
 * payload in memory per failed webhook.
 */
async function readErrorSnippet(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  const MAX = 1024;
  let buf = "";
  try {
    while (buf.length < MAX) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
  } catch {
    return "";
  }
  if (!buf) return "";
  return `: ${buf.slice(0, 200)}`;
}
