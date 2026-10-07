import { describe, expect, it } from "vitest";

import { toolErrorSignature } from "./trace-error.js";

describe("toolErrorSignature", () => {
  it("keeps the first line of a plain failure and groups by cause, not tool prefix", () => {
    expect(toolErrorSignature("upstream said no\nstack line")).toBe(
      "upstream said no",
    );
    expect(
      toolErrorSignature("Error running fetch: upstream said no\nstack line"),
    ).toBe("upstream said no");
    expect(
      toolErrorSignature("Error running other-tool: upstream said no"),
    ).toBe(toolErrorSignature("Error running fetch: upstream said no"));
    expect(toolErrorSignature("Error running fetch:   ")).toBe(
      "Tool failed with no error text",
    );
  });

  it("summarizes a JSON error result instead of returning its opening brace", () => {
    const bigquery = JSON.stringify(
      {
        error: "bigquery_not_configured",
        message: "BigQuery isn't connected",
        recoverable: false,
      },
      null,
      2,
    );
    expect(toolErrorSignature(bigquery)).toBe(
      "bigquery_not_configured: BigQuery isn't connected",
    );
    expect(toolErrorSignature(`Error running bigquery: ${bigquery}`)).toBe(
      "bigquery_not_configured: BigQuery isn't connected",
    );
    expect(
      toolErrorSignature(JSON.stringify({ error: "quota_exceeded" })),
    ).toBe("quota_exceeded");
  });

  it("falls back to the first line when JSON has no error code or does not parse", () => {
    expect(toolErrorSignature('{"message":"no code"}')).toBe(
      '{"message":"no code"}',
    );
    expect(toolErrorSignature('{\n  "error": "cut off')).toBe("{");
    expect(toolErrorSignature('{"error": {"code": 1}}')).toBe(
      '{"error": {"code": 1}}',
    );
  });

  it("still redacts and scrubs a JSON error message", () => {
    // Assembled at runtime so no credential-shaped literal sits in the source.
    const fakeKey = ["sk", "not", "a", "real", "key", "000000000"].join("-");
    expect(
      toolErrorSignature(
        JSON.stringify({
          error: "auth_failed",
          message: `bad key=${fakeKey} for a@b.co`,
        }),
      ),
    ).toBe("auth_failed: bad key=[REDACTED] for [email]");
    expect(
      toolErrorSignature(
        JSON.stringify({
          error: "failed",
          message: "x".repeat(2000),
          apiKey: fakeKey,
        }),
      ).length,
    ).toBe(501);
  });

  it("replaces emails in the first line", () => {
    expect(
      toolErrorSignature(
        "No mailbox for ada.lovelace@example.com or grace+ops@mail.example.org",
      ),
    ).toBe("No mailbox for [email] or [email]");
  });

  it("replaces long opaque ids and tokens, keeping readable identifiers", () => {
    expect(
      toolErrorSignature(
        "File 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms not found in getGoogleDocsAccessToken",
      ),
    ).toBe("File [id] not found in getGoogleDocsAccessToken");
    expect(
      toolErrorSignature(
        "Message 18c3a5b2f4d6e7a8 is gone (user 507f1f77bcf86cd799439011)",
      ),
    ).toBe("Message [id] is gone (user [id])");
    expect(
      toolErrorSignature(
        "Session 7d3b8f1e-52a4-4c0e-9b1a-0f6d2c8e4a31 expired",
      ),
    ).toBe("Session [id] expired");
  });

  it("leaves short numbers and timestamps alone", () => {
    expect(
      toolErrorSignature("HTTP 502 from api at 2026-09-30T12:34:56Z, retry 3"),
    ).toBe("HTTP 502 from api at 2026-09-30T12:34:56Z, retry 3");
  });

  it("still redacts credentials first and bounds the line", () => {
    expect(
      toolErrorSignature("bad key=sk-not-a-real-key-000000000 for a@b.co"),
    ).toBe("bad key=[REDACTED] for [email]");
    expect(toolErrorSignature(`Error: ${"x".repeat(2000)}`).length).toBe(501);
  });

  it("is never empty", () => {
    expect(toolErrorSignature("")).toBe("Tool failed with no error text");
    expect(toolErrorSignature(undefined)).toBe(
      "Tool failed with no error text",
    );
  });
});
