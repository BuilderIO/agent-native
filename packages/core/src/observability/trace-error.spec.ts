import { describe, expect, it } from "vitest";

import { toolErrorSignature } from "./trace-error.js";

describe("toolErrorSignature", () => {
  it("keeps the first line of a plain failure so the tool stays diagnosable", () => {
    expect(
      toolErrorSignature("Error running fetch: upstream said no\nstack line"),
    ).toBe("Error running fetch: upstream said no");
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
