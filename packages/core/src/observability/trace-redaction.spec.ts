import { describe, expect, it } from "vitest";

import { redactSensitiveFields } from "./trace-redaction.js";

const slackWebhookUrl =
  "https://hooks.slack.com/services/T_FAKE/B_FAKE/FAKE_TOKEN";
const providerWebhookUrl = "https://provider.example/hooks/FAKE_TOKEN";
const fakeAwsAccessKeyId = (prefix: "AKIA" | "ASIA") =>
  `${prefix}${"0".repeat(16)}`;

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

  it("redacts AWS access key IDs embedded in captured user input", () => {
    const accessKeys = `${fakeAwsAccessKeyId("AKIA")} and ${fakeAwsAccessKeyId("ASIA")}`;
    expect(
      redactSensitiveFields({
        prompt: `The user included ${accessKeys}.`,
      }),
    ).toEqual({ prompt: "The user included [REDACTED] and [REDACTED]." });
  });

  it("redacts provider tokens, signed URLs, and JWTs in prompt and tool-result strings", () => {
    const slackToken = ["x", "oxb-", "FAKE", "-", "0".repeat(8)].join("");
    const npmToken = ["n", "pm_", "FAKE", "_", "0".repeat(8)].join("");
    const sasSignature = ["FAKE", "SAS", "SIGNATURE"].join("-");
    const jwt = [
      ["ey", "J", "A".repeat(8)].join(""),
      "B".repeat(8),
      "C".repeat(8),
    ].join(".");

    expect(
      redactSensitiveFields({
        prompt: `Use ${slackToken} and ${npmToken} to authenticate.`,
        toolResult: `Request failed for https://blob.example/item?sig=${sasSignature}; token=${jwt}`,
      }),
    ).toEqual({
      prompt: "Use [REDACTED] and [REDACTED] to authenticate.",
      toolResult:
        "Request failed for https://blob.example/item?sig=[REDACTED]; token=[REDACTED]",
    });
  });
});
