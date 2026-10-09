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
        text: "api_key=[REDACTED] Authorization: [REDACTED]",
      },
    ]);
    expect(result.messages[0]?.text).not.toContain("example-value");
    expect(result.messages[0]?.text).not.toContain("sample-value");
    expect(result.messages[0]?.text).not.toContain("sample-token");
  });

  it("redacts JSON-quoted credential property names", () => {
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: '{"api_key":"example-value","access_token":"another-value"}',
      },
    ]);

    expect(result.messages[0]?.text).toContain("[REDACTED]");
    expect(result.messages[0]?.text).not.toContain("example-value");
    expect(result.messages[0]?.text).not.toContain("another-value");
    expect(JSON.parse(result.messages[0]!.text)).toEqual({
      api_key: "[REDACTED]",
      access_token: "[REDACTED]",
    });
  });

  it("redacts complete authorization values, including unknown schemes", () => {
    const result = sanitizePromptProvenanceCandidates([
      { role: "user", text: "Authorization: Basic fake-basic-value" },
      {
        role: "user",
        text: 'Authorization: Digest username="fake;user", realm="fake-realm", nonce="fake-nonce"',
      },
      { role: "user", text: "Authorization: Token fake-token-value" },
      { role: "user", text: "Authorization: ApiKey fake-api-key-value" },
      {
        role: "user",
        text: "Authorization: AWS4-HMAC-SHA256 Credential=fake-credential, SignedHeaders=host, Signature=fake-signature",
      },
      {
        role: "user",
        text: '{"authorization":"Bearer fake-json-token","next":"visible"}',
      },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "Authorization: [REDACTED]",
      "Authorization: [REDACTED]",
      "Authorization: [REDACTED]",
      "Authorization: [REDACTED]",
      "Authorization: [REDACTED]",
      '{"authorization":"[REDACTED]","next":"visible"}',
    ]);
    for (const value of [
      "fake-basic-value",
      "fake;user",
      "fake-realm",
      "fake-nonce",
      "fake-token-value",
      "fake-api-key-value",
      "fake-credential",
      "fake-signature",
      "fake-json-token",
    ]) {
      expect(JSON.stringify(result)).not.toContain(value);
    }
    expect(JSON.parse(result.messages[5]!.text)).toEqual({
      authorization: "[REDACTED]",
      next: "visible",
    });
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
      "[OMITTED_SQL]",
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

  it("omits inline SQL with no FROM clause and its surrounding message text", () => {
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: "Please inspect this statement: SELECT 'customer@example.com'; keep the result private.",
      },
      { role: "user", text: "SELECT 1" },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "[OMITTED_SQL]",
      "[OMITTED_SQL]",
    ]);
    expect(JSON.stringify(result)).not.toContain("customer@example.com");
    expect(JSON.stringify(result)).not.toContain("SELECT");
  });

  it("keeps natural language selection prompts and omits function SELECTs", () => {
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: "Please select one, then compare retention by plan.",
      },
      { role: "user", text: "SELECT decrypt(secret_column)" },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "Please select one, then compare retention by plan.",
      "[OMITTED_SQL]",
    ]);
    expect(JSON.stringify(result)).not.toContain("secret_column");
  });

  it("omits mid-sentence SQL while preserving ordinary selection instructions", () => {
    const result = sanitizePromptProvenanceCandidates([
      {
        role: "user",
        text: "Can you check this: SELECT user_id, email FROM users WHERE plan = 'pro'?",
      },
      {
        role: "user",
        text: "Can you check this: SELECT email FROM users WHERE id = 7?",
      },
      {
        role: "user",
        text: "Can you select one from the list, then compare retention by plan?",
      },
    ]);

    expect(result.messages.map(({ text }) => text)).toEqual([
      "[OMITTED_SQL]",
      "[OMITTED_SQL]",
      "Can you select one from the list, then compare retention by plan?",
    ]);
    expect(JSON.stringify(result)).not.toContain("user_id");
    expect(JSON.stringify(result)).not.toContain("pro");
    expect(JSON.stringify(result)).not.toContain("email FROM users");
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
