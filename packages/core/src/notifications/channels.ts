import { createHmac } from "node:crypto";
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
  getKeyAllowlist,
  getResolvedKeyAllowlist,
  resolveKeyReferencesWithRequestScopes,
  validateUrlAllowlist,
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
  registerNotificationChannel(createPersonalSlackWebhookChannel());
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
      const overrideAuthTemplate = deliveryMetadataString(
        input.metadata,
        "webhookAuth",
      );
      const signatureTemplate = deliveryMetadataString(
        input.metadata,
        "webhookSignature",
      );
      // No-op when neither a per-notification nor workspace URL is set —
      // mirrors email's empty-recipients behavior so notify-all stays quiet.
      if (!urlTemplate) {
        return { status: "skipped", reason: "No webhook is configured." };
      }
      const { url, headers, assertUrlAllowed, resolvedAdditionalSecrets } =
        await resolveWebhookRequest(
          urlTemplate,
          overrideAuthTemplate ??
            (overrideUrlTemplate ? undefined : authTemplate),
          meta.owner,
          "webhook",
          signatureTemplate ? [signatureTemplate] : [],
        );
      if (meta.workflowEffectId) {
        headers["X-Agent-Native-Idempotency-Key"] = meta.workflowEffectId;
      }
      const body = JSON.stringify({
        severity: input.severity,
        title: input.title,
        body: input.body,
        metadata: scrubDeliveryMetadata(input.metadata),
        owner: meta.owner,
        emittedAt: new Date().toISOString(),
      });
      const signatureSecret = resolvedAdditionalSecrets[0];
      if (signatureSecret) {
        headers["X-Agent-Native-Signature"] = `sha256=${createHmac(
          "sha256",
          signatureSecret,
        )
          .update(body)
          .digest("hex")}`;
      }
      const res = await ssrfSafeFetch(
        url,
        {
          method: "POST",
          headers,
          body,
        },
        { maxRedirects: 3, assertUrlAllowed },
      );
      if (!res.ok) {
        throw new Error(
          `[notifications] webhook ${new URL(url).origin} returned ${res.status}${
            (await readErrorSnippet(res)) || ""
          }`,
        );
      }
      return {
        status: "unknown",
        evidence: { providerAccepted: true, httpStatus: res.status },
      };
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
      if (!urlTemplate) {
        return {
          status: "skipped",
          reason: "No team Slack webhook is configured.",
        };
      }
      const { url, headers, assertUrlAllowed } = await resolveWebhookRequest(
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
        { maxRedirects: 3, assertUrlAllowed },
      );
      if (!res.ok) {
        throw new Error(
          `[notifications] Slack webhook ${new URL(url).origin} returned ${res.status}${
            (await readErrorSnippet(res)) || ""
          }`,
        );
      }
      return {
        status: "unknown",
        evidence: { providerAccepted: true, httpStatus: res.status },
      };
    },
  };
}

function createPersonalSlackWebhookChannel(): NotificationChannel {
  return {
    name: "personal-slack",
    async deliver(input, meta) {
      const urlTemplate = deliveryMetadataString(
        input.metadata,
        "personalSlackWebhookUrl",
      );
      if (!urlTemplate) {
        return {
          status: "skipped",
          reason: "No personal Slack webhook is configured.",
        };
      }
      const { url, headers, assertUrlAllowed } = await resolveWebhookRequest(
        urlTemplate,
        undefined,
        meta.owner,
        "personal Slack webhook",
      );
      const res = await ssrfSafeFetch(
        url,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            text: slackText(input.severity, input.title, input.body),
          }),
        },
        { maxRedirects: 3, assertUrlAllowed },
      );
      if (!res.ok) {
        throw new Error(
          `[notifications] personal Slack webhook ${new URL(url).origin} returned ${res.status}${
            (await readErrorSnippet(res)) || ""
          }`,
        );
      }
      return {
        status: "unknown",
        evidence: { providerAccepted: true, httpStatus: res.status },
      };
    },
  };
}

function createEmailChannel(): NotificationChannel {
  return {
    name: "email",
    async deliver(input) {
      const recipients = notificationEmailRecipients(input.metadata);
      if (recipients.length === 0) {
        return {
          status: "skipped",
          reason: "No email recipient is configured.",
        };
      }
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
      return {
        status: "unknown",
        evidence: { providerAccepted: true, recipientCount: recipients.length },
      };
    },
  };
}

async function resolveWebhookRequest(
  urlTemplate: string,
  authTemplate: string | undefined,
  owner: string,
  label: string,
  additionalSecretTemplates: string[] = [],
): Promise<{
  url: string;
  headers: Record<string, string>;
  assertUrlAllowed: (url: string) => void;
  resolvedAdditionalSecrets: string[];
}> {
  // Resolve `${keys.NAME}` references through the same request-scope
  // cascade already used by extension fetches (extensions/routes.ts) and
  // automation connector headers (automation/index.ts): user scope first
  // (a personal override always wins), then the active org scope — where
  // the Dispatch vault syncs workspace secrets — then workspace scope.
  // Org/workspace vault rows are write-gated (org-admin + Dispatch vault
  // UI), so reading them here is safe by default; this is unrelated to the
  // opt-in-only user→workspace fallback in resolveKeyReferences (audit 05
  // H2 in secrets/substitution.ts), which stays off. In headless contexts
  // (e.g. a scheduled monitor check) getRequestOrgId() may be unset, in
  // which case the cascade checks user + solo-workspace scopes only — a
  // strict superset of the previous user-scope-only behavior.
  // Missing keys throw — the error surfaces in logs and the channel is marked
  // un-delivered, but other channels still run.
  const urlResult = await resolveKeyReferencesWithRequestScopes(
    urlTemplate,
    owner,
  );
  const url = urlResult.resolved;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  let authResult:
    | Awaited<ReturnType<typeof resolveKeyReferencesWithRequestScopes>>
    | undefined;
  if (authTemplate) {
    authResult = await resolveKeyReferencesWithRequestScopes(
      authTemplate,
      owner,
    );
    headers.Authorization = authResult.resolved;
  }
  const additionalResults = await Promise.all(
    additionalSecretTemplates.map((template) =>
      resolveKeyReferencesWithRequestScopes(template, owner),
    ),
  );

  // If the user set an allowlist on a referenced key, enforce it here —
  // origin-level check, same rule the automations fetch-tool applies.
  // Validate URL and Authorization keys independently so an allowlisted auth
  // token cannot be sent to a metadata-provided destination. Keep scope in the
  // dedupe key because the same key name can resolve at a different scope if a
  // credential changes between the two substitutions.
  type ResolvedKey = NonNullable<typeof urlResult.resolvedKeys>[number];
  const keyUsages = new Map<
    string,
    { name: string; resolvedKey?: ResolvedKey }
  >();
  for (const result of [
    urlResult,
    ...(authResult ? [authResult] : []),
    ...additionalResults,
  ]) {
    for (const name of result.usedKeys) {
      const resolved = (result.resolvedKeys ?? []).filter(
        (ref) => ref.name === name,
      );
      if (resolved.length === 0) {
        keyUsages.set(`user:${owner}:${name}`, { name });
        continue;
      }
      for (const resolvedKey of resolved) {
        keyUsages.set(`${resolvedKey.scope}:${resolvedKey.scopeId}:${name}`, {
          name,
          resolvedKey,
        });
      }
    }
  }
  const usages = Array.from(keyUsages.values());
  const allowlists = await Promise.all(
    usages.map(({ name, resolvedKey }) =>
      resolvedKey
        ? getResolvedKeyAllowlist(resolvedKey)
        : getKeyAllowlist(name, "user", owner),
    ),
  );
  const assertUrlAllowed = (candidateUrl: string): void => {
    usages.forEach(({ name }, i) => {
      if (!validateUrlAllowlist(candidateUrl, allowlists[i])) {
        throw new Error(
          `[notifications] ${label} URL ${new URL(candidateUrl).origin} is not in the allowlist for key "${name}"`,
        );
      }
    });
  };
  assertUrlAllowed(url);
  return {
    url,
    headers,
    assertUrlAllowed,
    resolvedAdditionalSecrets: additionalResults.map(
      (result) => result.resolved,
    ),
  };
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
  const fromMetadata = [
    ...deliveryMetadataStringArray(metadata, "emailRecipients"),
    ...stringArray(metadata?.emailRecipients),
  ];
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

function deliveryMetadataStringArray(
  metadata: NotificationInput["metadata"],
  key: string,
): string[] {
  const delivery = metadata?.delivery;
  if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) {
    return [];
  }
  return stringArray((delivery as Record<string, unknown>)[key]);
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
