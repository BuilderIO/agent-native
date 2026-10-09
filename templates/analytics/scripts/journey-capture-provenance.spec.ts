import { describe, expect, it } from "vitest";

import { sanitizePromptProvenanceCandidates } from "./journey-capture-provenance";

describe("sanitizePromptProvenanceCandidates", () => {
  it("preserves user message order and returns text only", () => {
    expect(
      sanitizePromptProvenanceCandidates([
        { role: "user", text: "First prompt", eventId: "event-one" },
        { role: "user", text: "Second prompt", nodeId: 42 },
      ]),
    ).toEqual({
      messages: [
        { role: "user", text: "First prompt" },
        { role: "user", text: "Second prompt" },
      ],
      truncation: {
        messages: false,
        messageCharacters: false,
        totalCharacters: false,
      },
    });
  });

  it("rejects malformed or non-user candidates instead of coercing them", () => {
    expect(() => sanitizePromptProvenanceCandidates({})).toThrow(
      "Prompt provenance candidates must be an array",
    );
    expect(() =>
      sanitizePromptProvenanceCandidates([
        { role: "assistant", text: "Not a user prompt" },
      ]),
    ).toThrow("Invalid prompt provenance candidate at index 0");
    expect(() =>
      sanitizePromptProvenanceCandidates([{ role: "user", text: 7 }]),
    ).toThrow("Invalid prompt provenance candidate at index 0");
  });

  it("redacts credential assignments and bearer values", () => {
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: "api_key=example-value Authorization: Bearer sample-value Bearer sample-token",
      },
    ]);

    expect(result.messages).toEqual([
      {
        role: "user",
        text: "api_key=[REDACTED] Authorization: [REDACTED] Bearer [REDACTED]",
      },
    ]);
    expect(result.messages[0]?.text).not.toContain("example-value");
    expect(result.messages[0]?.text).not.toContain("sample-value");
    expect(result.messages[0]?.text).not.toContain("sample-token");
  });

  it("omits SQL and base64 payloads from extracted message text", () => {
    const query = "SELECT email, api_key FROM accounts WHERE id = 7;";
    const imageData = `data:image/png;base64,${"A".repeat(160)}`;
    const result = sanitizePromptProvenanceCandidates([
      { role: "user", text: `Query: ${query} Please keep the result private.` },
      { role: "user", text: `Attached image ${imageData}` },
      { role: "user", text: `Inline payload ${"B".repeat(160)}` },
      { role: "user", text: `URL-safe payload ${"A_b-".repeat(40)}` },
      { role: "user", text: `\`\`\`sql\n${query}\n\`\`\`` },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "Query: [OMITTED_SQL] Please keep the result private.",
      "Attached image [OMITTED_BASE64]",
      "Inline payload [OMITTED_BASE64]",
      "URL-safe payload [OMITTED_BASE64]",
      "[OMITTED_SQL]",
    ]);
    expect(JSON.stringify(result)).not.toContain("accounts");
    expect(JSON.stringify(result)).not.toContain("A".repeat(128));
    expect(JSON.stringify(result)).not.toContain("B".repeat(128));
    expect(JSON.stringify(result)).not.toContain("A_b-".repeat(30));
  });

  it("reports message and per-message character truncation", () => {
    const result = sanitizePromptProvenanceCandidates([
      { role: "user", text: "ordinary ".repeat(250) },
      ...Array.from({ length: 12 }, (_, index) => ({
        role: "user" as const,
        text: `prompt-${index}`,
      })),
    ]);

    expect(result.messages).toHaveLength(12);
    expect(result.messages[0]?.text).toHaveLength(2_000);
    expect(result.truncation).toEqual({
      messages: true,
      messageCharacters: true,
      totalCharacters: false,
    });
  });

  it("reports total character truncation without exceeding the aggregate cap", () => {
    const result = sanitizePromptProvenanceCandidates([
      ...Array.from({ length: 5 }, () => ({
        role: "user" as const,
        text: `${"ordinary ".repeat(222)}or`,
      })),
    ]);

    expect(result.messages).toHaveLength(4);
    expect(
      result.messages.reduce(
        (total, message) => total + message.text.length,
        0,
      ),
    ).toBe(8_000);
    expect(result.truncation).toEqual({
      messages: false,
      messageCharacters: false,
      totalCharacters: true,
    });
  });

  it("does not split a surrogate pair at a character limit", () => {
    const prefix = `${"x ".repeat(999)}x`;
    const result = sanitizePromptProvenanceCandidates([
      { role: "user", text: `${prefix}😀x` },
    ]);

    expect(result.messages[0]?.text).toBe(`${prefix}😀`);
    expect(result.truncation.messageCharacters).toBe(true);
  });
});
