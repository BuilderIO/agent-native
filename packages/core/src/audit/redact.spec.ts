import { describe, expect, it } from "vitest";

import { redactArgsToJson, redactTextToSummary, __test } from "./redact.js";

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
    expect(__test.looksSecret("abcdefghij".repeat(4))).toBe(true);
    expect(__test.looksSecret("sk" + "-" + "live01234567")).toBe(true);
    expect(__test.looksSecret("hello world")).toBe(false);
    expect(__test.looksSecret("short")).toBe(false);

    const json = redactArgsToJson({ note: "Bearer secret-token-value-here" });
    expect(JSON.parse(json!).note).toBe("[redacted]");
  });

  it("redacts webhook URLs under a generic field, regardless of key", () => {
    expect(
      __test.looksSecret(
        "https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXX",
      ),
    ).toBe(true);
    expect(
      __test.looksSecret("https://discord.com/api/webhooks/123/abcDEF"),
    ).toBe(true);
    // A vault-style payload puts the secret under a generic `value` key.
    const json = redactArgsToJson({
      value: "https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXX",
    });
    expect(JSON.parse(json!).value).toBe("[redacted]");
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

  it("keeps the output parseable when the whole payload is truncated", () => {
    // 10 fields × ~1000-char prose values → serialized JSON exceeds MAX_JSON,
    // but no single string hits the per-string limit and none look secret.
    const sentence = "word ".repeat(200);
    const big = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`f${i}`, sentence]),
    );
    const json = redactArgsToJson(big);
    expect(() => JSON.parse(json!)).not.toThrow(); // valid JSON, not a slice
    const parsed = JSON.parse(json!);
    expect(parsed._auditTruncated).toBe(true);
    expect(typeof parsed.preview).toBe("string");
  });

  it("honours a caller-supplied cap, envelope included", () => {
    // The A2A activity snapshot has a much tighter wire budget than the audit
    // log, and validates the exact stored length — the truncation envelope has
    // to fit inside the cap, not overhang it.
    const json = redactArgsToJson(
      { command: "echo hi; ".repeat(500), cwd: "/repo" },
      { maxJson: 256, maxString: 64 },
    );
    expect(json!.length).toBeLessThanOrEqual(256);
    expect(() => JSON.parse(json!)).not.toThrow();
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

describe("redactTextToSummary", () => {
  it("keeps short text verbatim and marks clipped text", () => {
    expect(redactTextToSummary("all good", 100)).toBe("all good");

    const long = "line of output\n".repeat(500);
    const summary = redactTextToSummary(long, 200)!;
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary).toContain("more chars");
  });

  it("redacts a result that is nothing but a credential", () => {
    expect(redactTextToSummary("sk-live-000000000000000000000000")).toBe(
      "[redacted]",
    );
    expect(redactTextToSummary("")).toBeNull();
  });

  it("redacts credentials embedded in text and JSON fields", () => {
    const summary = redactTextToSummary(
      'request failed: Authorization: Bearer fake-bearer-value token=fake-token-value body={"apiKey":"fake-api-key"}',
    );
    expect(summary).toContain("Authorization: Bearer [redacted]");
    expect(summary).toContain("token=[redacted]");
    expect(summary).toContain('"apiKey":"[redacted]"');
    expect(summary).not.toContain("fake-bearer-value");
    expect(summary).not.toContain("fake-token-value");
    expect(summary).not.toContain("fake-api-key");
  });
});
