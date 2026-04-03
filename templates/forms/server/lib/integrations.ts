import type {
  FormIntegration,
  FormField,
  IntegrationType,
} from "../../shared/types.js";

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
          text: `📋 New submission: ${submission.formTitle}`,
          emoji: true,
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
            text: `Submitted ${submission.submittedAt}`,
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
        title: `📋 New submission: ${submission.formTitle}`,
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
