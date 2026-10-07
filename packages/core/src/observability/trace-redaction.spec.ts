import { describe, expect, it } from "vitest";

import { redactSensitiveFields } from "./trace-redaction.js";

const slackWebhookUrl =
  "https://hooks.slack.com/services/T_FAKE/B_FAKE/FAKE_TOKEN";
const providerWebhookUrl = "https://provider.example/hooks/FAKE_TOKEN";

describe("redactSensitiveFields", () => {
  it("redacts structured webhook URL fields", () => {
    expect(
      redactSensitiveFields({
        webhookUrl: slackWebhookUrl,
        nested: { slackWebhookUrl },
        label: "Alert destination",
      }),
    ).toEqual({
      webhookUrl: "[REDACTED]",
      nested: { slackWebhookUrl: "[REDACTED]" },
      label: "Alert destination",
    });
  });

  it("redacts Slack incoming webhook URLs embedded in captured text", () => {
    expect(
      redactSensitiveFields({
        prompt: `Send the alert to ${slackWebhookUrl} after review.`,
      }),
    ).toEqual({
      prompt: "Send the alert to [REDACTED] after review.",
    });
  });

  it("redacts labeled provider webhook URLs embedded in captured text", () => {
    expect(
      redactSensitiveFields({
        prompt: `Retry posting to webhookUrl: ${providerWebhookUrl}.`,
      }),
    ).toEqual({
      prompt: "Retry posting to webhookUrl: [REDACTED].",
    });
  });
});
