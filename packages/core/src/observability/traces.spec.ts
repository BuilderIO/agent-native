import { describe, it, expect } from "vitest";
import { redactSensitiveFields } from "./traces.js";

// M14 in the MCP/A2A audit: tool inputs persisted into trace spans can
// include verbatim credentials (e.g. db-exec INSERTs that contain a raw
// secret value, fetchTool Authorization headers). The captureToolArgs
// path runs every input through `redactSensitiveFields` before writing
// the span — these tests pin down which keys are swapped for "[REDACTED]"
// and ensure the redaction is non-destructive (returns a copy, leaves
// the original input intact for runtime use).

describe("redactSensitiveFields", () => {
  it("redacts top-level sensitive keys", () => {
    const out = redactSensitiveFields({
      authorization: "Bearer xyz",
      cookie: "session=abc",
      apiKey: "sk-123",
      api_key: "sk-456",
      "api-key": "sk-789",
      password: "hunter2",
      secret: "shh",
      token: "tok",
      accessToken: "at",
      access_token: "at2",
      refreshToken: "rt",
      bearer: "br",
      benign: "keep me",
      url: "https://example.com",
    });
    expect(out).toEqual({
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      apiKey: "[REDACTED]",
      api_key: "[REDACTED]",
      "api-key": "[REDACTED]",
      password: "[REDACTED]",
      secret: "[REDACTED]",
      token: "[REDACTED]",
      accessToken: "[REDACTED]",
      access_token: "[REDACTED]",
      refreshToken: "[REDACTED]",
      bearer: "[REDACTED]",
      benign: "keep me",
      url: "https://example.com",
    });
  });

  it("matches case-insensitively", () => {
    const out = redactSensitiveFields({
      Authorization: "Bearer xyz",
      AUTHORIZATION: "Bearer abc",
      ApIkEy: "sk-mixed",
    });
    expect(out).toEqual({
      Authorization: "[REDACTED]",
      AUTHORIZATION: "[REDACTED]",
      ApIkEy: "[REDACTED]",
    });
  });

  it("recurses into nested objects and arrays", () => {
    const out = redactSensitiveFields({
      headers: { Authorization: "Bearer xyz", "X-Trace": "abc" },
      items: [
        { token: "t1", name: "alice" },
        { token: "t2", name: "bob" },
      ],
    });
    expect(out).toEqual({
      headers: { Authorization: "[REDACTED]", "X-Trace": "abc" },
      items: [
        { token: "[REDACTED]", name: "alice" },
        { token: "[REDACTED]", name: "bob" },
      ],
    });
  });

  it("does not mutate the original input", () => {
    const original = {
      authorization: "Bearer xyz",
      nested: { token: "tok" },
    };
    const out = redactSensitiveFields(original);
    expect(original.authorization).toBe("Bearer xyz");
    expect(original.nested.token).toBe("tok");
    expect(out).toEqual({
      authorization: "[REDACTED]",
      nested: { token: "[REDACTED]" },
    });
  });

  it("leaves non-matching keys with secret-shaped substrings alone", () => {
    // The pattern uses ^...$ anchors so partial matches like
    // "tokenizer" / "passwordHash" / "secretsCount" don't trigger.
    const out = redactSensitiveFields({
      tokenizer: "bert",
      passwordHash: "hashed",
      secretsCount: 3,
      mySecret: "still keep — substring match doesn't trigger",
    });
    expect(out).toEqual({
      tokenizer: "bert",
      passwordHash: "hashed",
      secretsCount: 3,
      mySecret: "still keep — substring match doesn't trigger",
    });
  });

  it("passes through primitives and null untouched", () => {
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields(42)).toBe(42);
    expect(redactSensitiveFields("plain string")).toBe("plain string");
    expect(redactSensitiveFields(true)).toBe(true);
    expect(redactSensitiveFields(undefined)).toBeUndefined();
  });

  it("tolerates circular references by emitting [Circular]", () => {
    const a: any = { token: "t1", name: "alice" };
    a.self = a;
    const out = redactSensitiveFields(a) as Record<string, unknown>;
    expect(out.token).toBe("[REDACTED]");
    expect(out.name).toBe("alice");
    expect(out.self).toBe("[Circular]");
  });
});
