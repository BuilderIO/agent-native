import {
  isBlockedToolUrl,
  ssrfSafeToolFetch,
} from "@agent-native/core/tools/url-safety";

import type {
  FormIntegration,
  FormField,
  FormSettings,
  IntegrationType,
} from "../../shared/types.js";

// ---------------------------------------------------------------------------
// Save-time validation
// ---------------------------------------------------------------------------

/**
 * Validate every integration URL on a FormSettings object before persistence.
 *
 * Rejects non-http(s) schemes, private IPs, cloud-metadata endpoints, and
 * known DNS-rebinding suffixes by routing each URL through `isBlockedToolUrl`.
 * Throws on the first violation so the form-author sees the reason
 * immediately. Defense-in-depth — `fireIntegrations` re-checks at fire time.
 */
export function assertIntegrationUrlsAllowed(settings: FormSettings): void {
  const list = settings.integrations ?? [];
  for (const integration of list) {
    if (!integration.url) continue;
    if (isBlockedToolUrl(integration.url)) {
      throw new Error(
        `Integration "${integration.name || integration.type}" URL is not allowed (private/internal/non-http(s) URL).`,
      );
    }
  }
}

interface SubmissionPayload {
  formId: string;
  formTitle: string;
  responseId: string;
  fields: FormField[];
  data: Record<string, unknown>;
  submittedAt: string;
  /** Email of the submitter, when known (claimed by the client, not verified). */
  submitterEmail?: string | null;
  /** Agent chat thread/session ids claimed by the client, when available. */
  chatSessionIds?: string[];
  /** Active agent run id claimed by the client, when available. */
  activeRunId?: string | null;
  /** Page URL where the feedback was submitted, when available. */
  pageUrl?: string | null;
  /** Client surface (web/electron/tauri) the feedback came from, when known. */
  clientSurface?: string | null;
}

/** Human-readable label for a client-surface token. */
function clientSurfaceLabel(surface: string): string {
  switch (surface) {
    case "electron":
      return "Desktop (Electron)";
    case "tauri":
      return "Desktop (Tauri)";
    case "web":
      return "Web";
    default:
      return surface;
  }
}

/**
 * Friendly app name derived from a feedback page URL, so a reviewer can tell at
 * a glance which app the feedback came from. `plan.agent-native.com` → "Plan",
 * `analytics.agent-native.com` → "Analytics". Returns null when the host isn't a
 * recognizable per-app subdomain (the full URL still carries the page).
 */
function appLabelFromUrl(pageUrl: string): string | null {
  try {
    const { hostname } = new URL(pageUrl);
    const match = hostname.match(/^([a-z0-9-]+)\.agent-native\.com$/i);
    const sub = match?.[1];
    if (!sub || sub === "www") return null;
    return sub
      .split("-")
      .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
      .join(" ");
  } catch {
    return null;
  }
}

/**
 * Readable host+path label for a feedback page URL, used as the visible text of
 * the Slack link so the app/page is legible inline instead of hidden behind a
 * bare "open". The full (already client-scrubbed) URL stays the link target.
 */
function pageLabelFromUrl(pageUrl: string): string {
  let label = pageUrl;
  try {
    const url = new URL(pageUrl);
    label = `${url.hostname}${url.pathname}`.replace(/\/$/, "") || url.hostname;
  } catch {
    // fall back to the raw string below
  }
  if (label.length > 80) label = `${label.slice(0, 79)}…`;
  // Escape Slack mrkdwn link-text control characters.
  return label
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/** Build a flat label→value object from field definitions and submission data */
function formatFields(
  fields: FormField[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (data[field.id] !== undefined) {
      out[field.label] = data[field.id];
    }
  }
  return out;
}

function formatDebugContext(submission: SubmissionPayload): string[] {
  const lines: string[] = [];
  const chatSessionIds = submission.chatSessionIds ?? [];
  if (chatSessionIds.length === 1) {
    lines.push(`Chat session: \`${chatSessionIds[0]}\``);
  } else if (chatSessionIds.length > 1) {
    lines.push(
      `Chat sessions: ${chatSessionIds.map((id) => `\`${id}\``).join(", ")}`,
    );
  }
  if (submission.activeRunId) {
    lines.push(`Run: \`${submission.activeRunId}\``);
  }
  if (submission.pageUrl) {
    const appLabel = appLabelFromUrl(submission.pageUrl);
    if (appLabel) lines.push(`App: ${appLabel}`);
    lines.push(
      `Page: <${submission.pageUrl}|${pageLabelFromUrl(submission.pageUrl)}>`,
    );
  }
  if (submission.clientSurface) {
    lines.push(`Source: ${clientSurfaceLabel(submission.clientSurface)}`);
  }
  return lines;
}

/** Slack Block Kit message */
export function buildSlackPayload(submission: SubmissionPayload) {
  const fieldLines = submission.fields
    .filter((f) => submission.data[f.id] !== undefined)
    .map((f) => {
      const val = submission.data[f.id];
      const display = Array.isArray(val) ? val.join(", ") : String(val);
      return `*${f.label}:* ${display}`;
    });

  const tsContext = `Submitted <!date^${Math.floor(new Date(submission.submittedAt).getTime() / 1000)}^{date_short_pretty} at {time}|${submission.submittedAt}>`;
  const contextText = submission.submitterEmail
    ? `${tsContext} by *${submission.submitterEmail}*`
    : tsContext;
  const debugContext = formatDebugContext(submission);

  return {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `New submission: ${submission.formTitle}`,
          emoji: false,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: fieldLines.join("\n") || "_No fields_",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: [contextText, ...debugContext].join("\n"),
          },
        ],
      },
    ],
  };
}

/** Discord webhook embed */
function buildDiscordPayload(submission: SubmissionPayload) {
  const discordFields = submission.fields
    .filter((f) => submission.data[f.id] !== undefined)
    .map((f) => {
      const val = submission.data[f.id];
      const display = Array.isArray(val) ? val.join(", ") : String(val);
      return { name: f.label, value: display, inline: true };
    });
  if (submission.submitterEmail) {
    discordFields.push({
      name: "Submitted by",
      value: submission.submitterEmail,
      inline: true,
    });
  }
  if (submission.chatSessionIds?.length) {
    discordFields.push({
      name: "Chat session",
      value: submission.chatSessionIds.join(", "),
      inline: false,
    });
  }
  if (submission.activeRunId) {
    discordFields.push({
      name: "Run",
      value: submission.activeRunId,
      inline: true,
    });
  }
  if (submission.pageUrl) {
    discordFields.push({
      name: "Page",
      value: submission.pageUrl,
      inline: false,
    });
  }
  if (submission.clientSurface) {
    discordFields.push({
      name: "Source",
      value: clientSurfaceLabel(submission.clientSurface),
      inline: true,
    });
  }

  return {
    embeds: [
      {
        title: `New submission: ${submission.formTitle}`,
        fields: discordFields,
        timestamp: submission.submittedAt,
        color: 0x2563eb,
      },
    ],
  };
}

/** Google Sheets (Apps Script web app) — flat key/value pairs */
function buildGoogleSheetsPayload(submission: SubmissionPayload) {
  return {
    formTitle: submission.formTitle,
    submittedAt: submission.submittedAt,
    submitterEmail: submission.submitterEmail ?? "",
    chatSessionIds: (submission.chatSessionIds ?? []).join(", "),
    activeRunId: submission.activeRunId ?? "",
    pageUrl: submission.pageUrl ?? "",
    clientSurface: submission.clientSurface ?? "",
    ...formatFields(submission.fields, submission.data),
  };
}

/** Generic webhook — full structured payload */
function buildWebhookPayload(submission: SubmissionPayload) {
  return {
    event: "form_submission",
    formId: submission.formId,
    formTitle: submission.formTitle,
    responseId: submission.responseId,
    submittedAt: submission.submittedAt,
    submitterEmail: submission.submitterEmail ?? null,
    chatSessionIds: submission.chatSessionIds ?? [],
    activeRunId: submission.activeRunId ?? null,
    pageUrl: submission.pageUrl ?? null,
    clientSurface: submission.clientSurface ?? null,
    data: formatFields(submission.fields, submission.data),
    rawData: submission.data,
  };
}

const payloadBuilders: Record<
  IntegrationType,
  (s: SubmissionPayload) => unknown
> = {
  slack: buildSlackPayload,
  discord: buildDiscordPayload,
  "google-sheets": buildGoogleSheetsPayload,
  webhook: buildWebhookPayload,
};

// ---------------------------------------------------------------------------
// Fire integrations
// ---------------------------------------------------------------------------

/** Fire all enabled integrations for a submission. Never throws. */
export async function fireIntegrations(
  integrations: FormIntegration[],
  submission: SubmissionPayload,
): Promise<void> {
  const enabled = integrations.filter((i) => i.enabled && i.url);
  if (enabled.length === 0) return;

  await Promise.allSettled(
    enabled.map(async (integration) => {
      // SSRF guard — a form-author can persist any URL in their integration
      // config. Anonymous submissions then trigger a server-side POST. Block
      // private IPs, cloud-metadata endpoints, and non-http(s) schemes
      // before the fetch fires.
      if (isBlockedToolUrl(integration.url)) {
        console.warn(
          `[integrations] ${integration.type} "${integration.name}" rejected: blocked URL`,
        );
        return;
      }

      const buildPayload =
        payloadBuilders[integration.type] ?? buildWebhookPayload;
      const payload = buildPayload(submission);

      try {
        const res = await ssrfSafeToolFetch(
          integration.url,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10_000),
          },
          { maxRedirects: 3 },
        );
        if (!res.ok) {
          console.warn(
            `[integrations] ${integration.type} "${integration.name}" returned ${res.status}`,
          );
        }
      } catch (err) {
        console.warn(
          `[integrations] ${integration.type} "${integration.name}" failed:`,
          err,
        );
      }
    }),
  );
}
