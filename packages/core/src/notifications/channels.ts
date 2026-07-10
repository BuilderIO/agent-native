/**
 * Built-in notification channels.
 *
 * Webhook and Slack are always registered. Delivery uses (in order):
 *   1. per-notification `metadata.webhookUrl` / `metadata.slackWebhookUrl`
 *   2. the matching `NOTIFICATIONS_*` env URL (workspace default)
 * If neither is set, that channel no-ops for the emission.
 *
 * Extra channels can be registered at any time via
 * `registerNotificationChannel()` from a server plugin.
 *
 * NOTIFICATIONS_WEBHOOK_URL  → default POST JSON URL when metadata omits one.
 *                              Supports `${keys.NAME}` substitution — the raw
 *                              value never enters the agent context.
 * NOTIFICATIONS_WEBHOOK_AUTH → optional `Authorization` header value (also
 *                              supports `${keys.NAME}`).
 * NOTIFICATIONS_SLACK_WEBHOOK_URL
 *                            → default Slack incoming webhook when metadata
 *                              omits `slackWebhookUrl`.
 *                              Supports `${keys.NAME}` substitution.
 * NOTIFICATIONS_EMAIL_CHANNEL=1
 *                            → enable the built-in email channel for
 *                              per-notification recipients.
 * NOTIFICATIONS_EMAIL_RECIPIENTS
 *                            → comma-separated fallback recipients for email
 *                              notifications that do not pass
 *                              `metadata.emailRecipients`.
 */

import { ssrfSafeFetch } from "../extensions/url-safety.js";
import {
  resolveKeyReferences,
  validateUrlAllowlist,
  getKeyAllowlist,
} from "../secrets/substitution.js";
import { sendEmail } from "../server/email.js";
import { registerNotificationChannel } from "./registry.js";
import type { NotificationChannel, NotificationInput } from "./types.js";

let _registered = false;

export function registerBuiltinNotificationChannels(): void {
  if (_registered) return;
  _registered = true;

  registerNotificationChannel(
    createWebhookChannel(process.env.NOTIFICATIONS_WEBHOOK_URL),
  );
  registerNotificationChannel(
    createSlackWebhookChannel(process.env.NOTIFICATIONS_SLACK_WEBHOOK_URL),
  );
  // Email is always registered so per-notification `metadata.emailRecipients`
  // work without a workspace-wide env flag (same pattern as webhook/slack).
  registerNotificationChannel(createEmailChannel());
}

function createWebhookChannel(
  envUrlTemplate: string | undefined,
): NotificationChannel {
  const authTemplate = process.env.NOTIFICATIONS_WEBHOOK_AUTH;
  return {
    name: "webhook",
    async deliver(input, meta) {
      const overrideUrlTemplate = deliveryMetadataString(
        input.metadata,
        "webhookUrl",
      );
      const urlTemplate =
        overrideUrlTemplate ??
        metadataString(input.metadata, "webhookUrl") ??
        envUrlTemplate?.trim();
      // No-op when neither a per-notification nor workspace URL is set —
      // mirrors email's empty-recipients behavior so notify-all stays quiet.
      if (!urlTemplate) return false;
      const { url, headers } = await resolveWebhookRequest(
        urlTemplate,
        overrideUrlTemplate ? undefined : authTemplate,
        meta.owner,
        "webhook",
      );
      const res = await ssrfSafeFetch(
        url,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            severity: input.severity,
            title: input.title,
            body: input.body,
            metadata: scrubDeliveryMetadata(input.metadata),
            owner: meta.owner,
            emittedAt: new Date().toISOString(),
          }),
        },
        { maxRedirects: 3 },
      );
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

function createSlackWebhookChannel(
  envUrlTemplate: string | undefined,
): NotificationChannel {
  const authTemplate = process.env.NOTIFICATIONS_SLACK_WEBHOOK_AUTH;
  return {
    name: "slack",
    async deliver(input, meta) {
      const overrideUrlTemplate = deliveryMetadataString(
        input.metadata,
        "slackWebhookUrl",
      );
      const urlTemplate =
        overrideUrlTemplate ??
        metadataString(input.metadata, "slackWebhookUrl") ??
        envUrlTemplate?.trim();
      if (!urlTemplate) return false;
      const { url, headers } = await resolveWebhookRequest(
        urlTemplate,
        overrideUrlTemplate ? undefined : authTemplate,
        meta.owner,
        "Slack webhook",
      );
      const res = await ssrfSafeFetch(
        url,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            text: slackText(input.severity, input.title, input.body),
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*${escapeSlack(input.title)}*`,
                },
              },
              ...(input.body
                ? [
                    {
                      type: "section",
                      text: {
                        type: "mrkdwn",
                        text: escapeSlack(input.body),
                      },
                    },
                  ]
                : []),
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `Severity: \`${input.severity}\`  Owner: ${escapeSlack(meta.owner)}`,
                  },
                ],
              },
            ],
          }),
        },
        { maxRedirects: 3 },
      );
      if (!res.ok) {
        throw new Error(
          `[notifications] Slack webhook ${new URL(url).origin} returned ${res.status}${
            (await readErrorSnippet(res)) || ""
          }`,
        );
      }
    },
  };
}

function createEmailChannel(): NotificationChannel {
  return {
    name: "email",
    async deliver(input) {
      const recipients = notificationEmailRecipients(input.metadata);
      if (recipients.length === 0) return false;
      const subject =
        typeof input.metadata?.emailSubject === "string" &&
        input.metadata.emailSubject.trim()
          ? input.metadata.emailSubject.trim()
          : `[${input.severity}] ${input.title}`;
      const text = `${input.title}\n\n${input.body ?? ""}`;
      const html = [
        `<p><strong>${escapeHtml(input.title)}</strong></p>`,
        input.body ? `<p>${escapeHtml(input.body)}</p>` : "",
      ].join("");

      await Promise.all(
        recipients.map((to) =>
          sendEmail({
            to,
            subject,
            text,
            html,
          }),
        ),
      );
    },
  };
}

async function resolveWebhookRequest(
  urlTemplate: string,
  authTemplate: string | undefined,
  owner: string,
  label: string,
): Promise<{ url: string; headers: Record<string, string> }> {
  // Resolve `${keys.NAME}` references against the owner's user-scope secrets.
  // Missing keys throw — the error surfaces in logs and the channel is marked
  // un-delivered, but other channels still run.
  const { resolved: url } = await resolveKeyReferences(
    urlTemplate,
    "user",
    owner,
  );
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authTemplate) {
    const { resolved: auth } = await resolveKeyReferences(
      authTemplate,
      "user",
      owner,
    );
    headers.Authorization = auth;
  }

  // If the user set an allowlist on a referenced key, enforce it here —
  // origin-level check, same rule the automations fetch-tool applies.
  const keyNames = Array.from(
    new Set(
      Array.from(urlTemplate.matchAll(/\$\{keys\.([A-Za-z0-9_-]+)\}/g), (m) =>
        String(m[1]),
      ),
    ),
  );
  const allowlists = await Promise.all(
    keyNames.map((name) => getKeyAllowlist(name, "user", owner)),
  );
  keyNames.forEach((name, i) => {
    if (!validateUrlAllowlist(url, allowlists[i])) {
      throw new Error(
        `[notifications] ${label} URL ${new URL(url).origin} is not in the allowlist for key "${name}"`,
      );
    }
  });
  return { url, headers };
}

function metadataString(
  metadata: NotificationInput["metadata"],
  key: string,
): string | undefined {
  const value = metadata?.[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function deliveryMetadataString(
  metadata: NotificationInput["metadata"],
  key: string,
): string | undefined {
  const delivery = metadata?.delivery;
  if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) {
    return undefined;
  }
  const value = (delivery as Record<string, unknown>)[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function scrubDeliveryMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata).filter(
    ([key]) =>
      key !== "delivery" && key !== "webhookUrl" && key !== "slackWebhookUrl",
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function notificationEmailRecipients(
  metadata: Record<string, unknown> | undefined,
): string[] {
  const fromMetadata = stringArray(metadata?.emailRecipients);
  const fromEnv = commaList(process.env.NOTIFICATIONS_EMAIL_RECIPIENTS);
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const raw of [...fromMetadata, ...fromEnv]) {
    const email = raw.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    recipients.push(email);
  }
  return recipients;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function commaList(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function slackText(
  severity: string,
  title: string,
  body: string | undefined,
): string {
  return `[${severity}] ${title}${body ? `\n${body}` : ""}`;
}

function escapeSlack(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
