import { isBlockedToolUrl } from "@agent-native/core/tools/url-safety";
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

/** Slack Block Kit message */
function buildSlackPayload(submission: SubmissionPayload) {
  const fieldLines = submission.fields
    .filter((f) => submission.data[f.id] !== undefined)
    .map((f) => {
      const val = submission.data[f.id];
      const display = Array.isArray(val) ? val.join(", ") : String(val);
      return `*${f.label}:* ${display}`;
    });

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
            text: `Submitted <!date^${Math.floor(new Date(submission.submittedAt).getTime() / 1000)}^{date_short_pretty} at {time}|${submission.submittedAt}>`,
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
        const res = await fetch(integration.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
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
