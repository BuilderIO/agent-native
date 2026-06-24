import { describe, expect, it } from "vitest";
import { redactArgsToJson, __test } from "./redact.js";

describe("redactArgsToJson", () => {
  it("redacts credential-looking keys", () => {
    const json = redactArgsToJson({
      title: "My doc",
      apiKey: "abc123",
      password: "hunter2",
      nested: { authToken: "zzz", keep: "ok" },
    });
    const parsed = JSON.parse(json!);
    expect(parsed.title).toBe("My doc");
    expect(parsed.apiKey).toBe("[redacted]");
    expect(parsed.password).toBe("[redacted]");
    expect(parsed.nested.authToken).toBe("[redacted]");
    expect(parsed.nested.keep).toBe("ok");
  });

  it("redacts bearer tokens and long opaque strings by value", () => {
    expect(__test.looksSecret("Bearer abcdef....")).toBe(true);
    expect(__test.looksSecret("sk-1234567890abcdefghijABCDEFGHIJ")).toBe(true);
    expect(__test.looksSecret("hello world")).toBe(false);
    expect(__test.looksSecret("short")).toBe(false);

    const json = redactArgsToJson({ note: "Bearer secret-token-value-here" });
    expect(JSON.parse(json!).note).toBe("[redacted]");
  });

  it("truncates very long (non-secret) strings", () => {
    // Spaces make it clearly prose, not an opaque token, so it is truncated
    // rather than redacted as a secret.
    const long = "lorem ipsum ".repeat(500);
    const json = redactArgsToJson({ body: long });
    const parsed = JSON.parse(json!);
    expect(parsed.body.length).toBeLessThan(long.length);
    expect(parsed.body).toContain("more chars");
  });

  it("returns null for nullish input", () => {
    expect(redactArgsToJson(null)).toBeNull();
    expect(redactArgsToJson(undefined)).toBeNull();
  });

  it("never throws on circular structures", () => {
    const a: any = { name: "x" };
    a.self = a;
    expect(() => redactArgsToJson(a)).not.toThrow();
  });
});
