import { describe, expect, it } from "vitest";

import { extractAnalyticsMemoryCandidates } from "./analytics-memory-extractor";

describe("extractAnalyticsMemoryCandidates", () => {
  it("keeps explicit user guidance deterministic and ignores assistant and tool text", () => {
    const messages = [
      {
        role: "assistant" as const,
        text: "Remember that BigQuery requires GoogleSQL.",
      },
      {
        role: "tool" as const,
        text: "Correction: use the daily activity table for active users.",
      },
      {
        id: "user-guidance-1",
        role: "user" as const,
        text: "Please remember that BigQuery uses GoogleSQL, so use STRING rather than TEXT for casts.",
      },
    ];

    const [candidate] = extractAnalyticsMemoryCandidates(messages);
    expect(candidate).toMatchObject({
      type: "reference",
      name: expect.stringMatching(/^analytics-guidance-[a-f0-9]{12}$/),
      description: expect.stringContaining("GoogleSQL"),
      content:
        "For future Analytics work: BigQuery uses GoogleSQL, so use STRING rather than TEXT for casts.",
      sourceMessageIndex: 2,
      triggerMessageIndex: 2,
      sourceMessageId: "user-guidance-1",
      triggerMessageId: "user-guidance-1",
    });
    expect(extractAnalyticsMemoryCandidates(messages)).toEqual([candidate]);
  });

  it("captures a metric definition only after the user explicitly confirms a restatement", () => {
    const messages = [
      {
        id: "definition-1",
        role: "user" as const,
        text: "We define qualified signup as a new account that verifies its email within seven days.",
      },
      {
        id: "assistant-restatement-1",
        role: "assistant" as const,
        text: "So qualified signup means a new account verifies its email within seven days. Is that right?",
      },
      {
        id: "confirmation-1",
        role: "user" as const,
        text: "Yes, that's exactly right.",
      },
    ];

    expect(extractAnalyticsMemoryCandidates(messages)).toMatchObject([
      {
        type: "reference",
        content:
          "Metric definition: qualified signup: a new account that verifies its email within seven days",
        description: expect.stringContaining("qualified signup"),
        sourceMessageIndex: 0,
        triggerMessageIndex: 2,
        sourceMessageId: "definition-1",
        triggerMessageId: "confirmation-1",
      },
    ]);
  });

  it("does not treat a bare acknowledgment as confirmation of an assistant statement", () => {
    expect(
      extractAnalyticsMemoryCandidates([
        {
          role: "user",
          text: "We define trial conversion as accounts starting a paid plan within fourteen days.",
        },
        {
          role: "assistant",
          text: "Trial conversion uses a 14-day window.",
        },
        { role: "user", text: "Yes." },
      ]),
    ).toEqual([]);
  });

  it("requires the assistant to restate the metric definition before confirmation", () => {
    const definition = {
      role: "user" as const,
      text: "We define qualified signup as a new account that verifies its email within seven days.",
    };

    expect(
      extractAnalyticsMemoryCandidates([
        definition,
        { role: "assistant", text: "Qualified signup—is that right?" },
        { role: "user", text: "Yes." },
      ]),
    ).toEqual([]);
    expect(
      extractAnalyticsMemoryCandidates([
        definition,
        {
          role: "assistant",
          text: "Qualified signup does not mean a new account that verifies its email within seven days. Is that right?",
        },
        { role: "user", text: "Yes." },
      ]),
    ).toEqual([]);
    expect(
      extractAnalyticsMemoryCandidates([
        definition,
        {
          role: "assistant",
          text: "Qualified signup is a new account. Is that right?",
        },
        { role: "user", text: "Yes." },
      ]),
    ).toEqual([]);
    expect(
      extractAnalyticsMemoryCandidates([
        definition,
        {
          role: "assistant",
          text: "Qualified signup means a new account does not verify its email within seven days. Is that right?",
        },
        { role: "user", text: "Yes." },
      ]),
    ).toEqual([]);
  });

  it("requires an unqualified confirmation of the restated definition", () => {
    expect(
      extractAnalyticsMemoryCandidates([
        {
          role: "user",
          text: "We define paid activation as a new account that starts a paid plan within seven days.",
        },
        {
          role: "assistant",
          text: "Paid activation means a new account starts a paid plan within seven days. Is that right?",
        },
        { role: "user", text: "Yes, but only for enterprise accounts." },
      ]),
    ).toEqual([]);
  });

  it("captures a specific user correction as reusable guidance", () => {
    expect(
      extractAnalyticsMemoryCandidates([
        {
          role: "user",
          text: "I already told you that BigQuery casts identifiers with STRING, not TEXT.",
        },
      ]),
    ).toMatchObject([
      {
        type: "reference",
        content:
          "For future Analytics work: BigQuery casts identifiers with STRING, not TEXT.",
        description: expect.stringContaining("STRING"),
      },
    ]);
  });

  it("rejects unconfirmed definitions, vague notes, unsafe data, code, and long text", () => {
    const messages = [
      { role: "user" as const, text: "Remember this." },
      {
        role: "user" as const,
        text: "Remember that the API key should never be saved in a memory.",
      },
      {
        role: "user" as const,
        text: "Correction: run SELECT user_id FROM account_users WHERE active = true.",
      },
      {
        role: "user" as const,
        text: `Remember that ${"this important analytics rule ".repeat(20)}`,
      },
      {
        role: "user" as const,
        text: "We define trial conversion as accounts starting a paid plan within fourteen days.",
      },
      {
        role: "assistant" as const,
        text: "Trial conversion uses a 14-day window.",
      },
      { role: "user" as const, text: "Okay." },
    ];

    expect(extractAnalyticsMemoryCandidates(messages)).toEqual([]);
  });

  it("rejects direct identifiers and email addresses", () => {
    expect(
      extractAnalyticsMemoryCandidates([
        {
          role: "user",
          text: "Remember that my email is analyst@example.invalid for future reports.",
        },
        {
          role: "user",
          text: "Going forward, use the saved dashboard for customer 202-555-0100 reports.",
        },
      ]),
    ).toEqual([]);
  });

  it("rejects billing, mailing, and street addresses", () => {
    expect(
      extractAnalyticsMemoryCandidates([
        {
          role: "user",
          text: "Remember that the billing address is 123 Main Street, Springfield for future reports.",
        },
        {
          role: "user",
          text: "For future analytics work, use the mailing address at 1600 Pennsylvania Avenue NW, Washington, DC.",
        },
        {
          role: "user",
          text: "Correction: use 123 Main St, Springfield as the default location for reports.",
        },
        {
          role: "user",
          text: "Going forward, use PO Box 428 for monthly statements.",
        },
        {
          role: "user",
          text: "Going forward, use 12 rue Victor Hugo, Paris as the location for reports.",
        },
        {
          role: "user",
          text: "Correction: use 123-125 Main Street as the default location for reports.",
        },
        {
          role: "user",
          text: "Remember that the office address is 45 Calle de Alcalá, Madrid for weekly reports.",
        },
        {
          role: "user",
          text: "Correction: use Calle Mayor 12 as the default location for reports.",
        },
        {
          role: "user",
          text: "Correction: use Via Roma 12 as the default location for reports.",
        },
      ]),
    ).toEqual([]);
  });

  it("rejects customer names and identifier-bearing rules", () => {
    expect(
      extractAnalyticsMemoryCandidates([
        {
          role: "user",
          text: "Remember that customer ExampleCo uses the enterprise report for renewals.",
        },
        {
          role: "user",
          text: "Correction: filter account id 00000000 from renewal analysis.",
        },
      ]),
    ).toEqual([]);
  });

  it("rejects unlabelled and lowercase customer names and credential disclosures", () => {
    const token = `${"a".repeat(20)}${"B".repeat(20)}${"7".repeat(12)}`;
    expect(
      extractAnalyticsMemoryCandidates([
        {
          role: "user",
          text: "Correction: Acme should use the Enterprise Renewal dashboard for renewals.",
        },
        {
          role: "user",
          text: "Correction: Jane Doe should use the renewal dashboard for reporting.",
        },
        {
          role: "user",
          text: "Correction: customer acme should use the renewal dashboard for reporting.",
        },
        {
          role: "user",
          text: "Remember that the private key should be rotated before production reports.",
        },
        {
          role: "user",
          text: `Remember that ${token} is the right header value for production reports.`,
        },
      ]),
    ).toEqual([]);
  });

  it("rejects names after explicit guidance verbs and SSN-shaped values", () => {
    expect(
      extractAnalyticsMemoryCandidates([
        {
          role: "user",
          text: "Correction: exclude Jane Doe from the weekly retention report.",
        },
        {
          role: "user",
          text: "Remember that 123-45-6789 is the employee identifier for future reports.",
        },
        {
          role: "user",
          text: "Remember that 123456789 is the employee identifier for future reports.",
        },
      ]),
    ).toEqual([]);
  });
});
