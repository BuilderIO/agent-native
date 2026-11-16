import { describe, expect, it } from "vitest";

import { redactToolResultForHistory } from "./tool-result-redaction.js";

describe("redactToolResultForHistory", () => {
  it("redacts credential fields and text inside a JSON result and keeps it JSON", () => {
    const result = JSON.stringify({
      status: "ok",
      apiKey: "synthetic-api-key-value",
      nested: {
        token: "synthetic-token-value",
        nextPageToken: "cursor-123",
        note: "retry with Bearer synthetic-bearer-value later",
        link: "https://example.com/feed?token=synthetic-query-value&page=2",
      },
    });

    const redacted = redactToolResultForHistory(result);

    expect(redacted).not.toContain("synthetic-");
    const { nested, ...rest } = JSON.parse(redacted);
    expect(rest).toEqual({ status: "ok", apiKey: "[REDACTED]" });
    expect(nested).toMatchObject({
      token: "[REDACTED]",
      nextPageToken: "cursor-123",
      note: "retry with Bearer [REDACTED] later",
    });
    expect(nested.link).toContain("?token=[REDACTED]");
    expect(nested.link).toContain("&page=2");
  });

  it("redacts a plain-text result", () => {
    const redacted = redactToolResultForHistory(
      "Connected. Authorization: Bearer synthetic-bearer-value",
    );

    expect(redacted).not.toContain("synthetic-bearer-value");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts a JSON result that was truncated into text", () => {
    const redacted = redactToolResultForHistory(
      '{"rows":[{"password":"synthetic-password-value"},{"id":2\n\n...[truncated — full result was 99,999 chars; only first 30,000 shown]',
    );

    expect(redacted).not.toContain("synthetic-password-value");
    expect(redacted).toContain("...[truncated");
  });

  it.each([
    '{"count":12345678901234567890,"ratio":1.0,"items":[ 1, 2 ]}',
    '{"ticket":{"id":"T-1","title":"Printer"},"attemptToken":"step-1"}',
    "42",
    "true",
    "null",
    "plain text with nothing to redact",
  ])("returns %s byte for byte when nothing needs redacting", (result) => {
    expect(redactToolResultForHistory(result)).toBe(result);
  });
});
