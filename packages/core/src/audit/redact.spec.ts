import { describe, expect, it } from "vitest";

import {
  redactArgsToJson,
  redactedArgsWereCut,
  redactTextToSummary,
  __test,
} from "./redact.js";

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

  it("redacts a credential inside an ordinary string, keeping the text around it", () => {
    const parsed = JSON.parse(
      redactArgsToJson({
        notes: "Call it with\nAuthorization: Bearer short-token\nthen run it",
        steps: ["export password=hunter2", "then run it"],
      })!,
    );
    expect(parsed.notes).toBe(
      "Call it with\nAuthorization: [redacted]\nthen run it",
    );
    expect(parsed.steps).toEqual(["export password=[redacted]", "then run it"]);
  });

  it.each([
    ["Authorization: Basic ZmFrZTpmYWtl", "Authorization: [redacted]"],
    ["Authorization: Bearer fake-token", "Authorization: [redacted]"],
    ["Use token=Bearer fake-credential", "Use token=[redacted]"],
    [
      String.raw`Use token="Bearer fake\"quoted\" phrase" next=visible`,
      'Use token="[redacted]" next=visible',
    ],
    [
      String.raw`Use token='Bearer fake\'quoted\' phrase' next=visible`,
      "Use token='[redacted]' next=visible",
    ],
    [
      'Use token=Bearer "fake phrase" next=visible',
      "Use token=[redacted] next=visible",
    ],
    [
      "Authorization:\n  Bearer fake-token\nBody: visible",
      "Authorization:\n  [redacted]\nBody: visible",
    ],
    [
      "Authorization: Bearer\nfake-token\nBody: visible",
      "Authorization: [redacted]\nBody: visible",
    ],
    [
      "Authorization: Basic\r\n  ZmFrZTpmYWtl\r\nBody: visible",
      "Authorization: [redacted]\r\nBody: visible",
    ],
    [
      "Authorization: fake-token\nBody: visible",
      "Authorization: [redacted]\nBody: visible",
    ],
    [
      "Authorization: Bearer-ish\nBody: visible",
      "Authorization: [redacted]\nBody: visible",
    ],
    [
      "Authorization: Api-Key\nfake-secret-value\nBody: visible",
      "Authorization: [redacted]\nBody: visible",
    ],
    [
      'Authorization: "Api-Key"\nfake-secret-value\nBody: visible',
      'Authorization: "[redacted]"\nBody: visible',
    ],
    [
      'Authorization: Api-Key\n"fake-secret-value"\nBody: visible',
      "Authorization: [redacted]\nBody: visible",
    ],
    [
      "Authorization: \"Api-Key\"\n  'fake-secret-value'\nBody: visible",
      'Authorization: "[redacted]"\nBody: visible',
    ],
    [
      'Authorization: Api-Key\n"fake-secret-value\nBody: visible',
      "Authorization: [redacted]\nBody: visible",
    ],
    [
      'Authorization: "Api-Key"\n\'fake-secret-value\nBody: visible',
      'Authorization: "[redacted]"\nBody: visible',
    ],
    [
      'Authorization: Digest\nusername="fake", response="fake"\nBody: visible',
      "Authorization: [redacted]\nBody: visible",
    ],
    [
      "Authorization: fake-token\nThis is ordinary text",
      "Authorization: [redacted]\nThis is ordinary text",
    ],
    [
      'Authorization: fake-token\n  "body": "visible"',
      'Authorization: [redacted]\n  "body": "visible"',
    ],
    [
      "Authorization:\nContent-Type: application/json\nBody: visible",
      "Authorization:\n[redacted]\nBody: visible",
    ],
    ["password:\nfake-phrase\nvisible", "password:\n[redacted]\nvisible"],
    ["token=\nfake-value next=visible", "token=\n[redacted] next=visible"],
    [
      'Authorization: Digest username="fake", realm="fake"',
      "Authorization: [redacted]",
    ],
    [
      '{"Authorization":"Basic ZmFrZTpmYWtl"}',
      '{"Authorization":"[redacted]"}',
    ],
    [
      'password="fake phrase with spaces" next=visible',
      'password="[redacted]" next=visible',
    ],
    [
      "password='fake phrase with spaces' next=visible",
      "password='[redacted]' next=visible",
    ],
    [
      String.raw`password="fake \"quoted\" phrase" next=visible`,
      'password="[redacted]" next=visible',
    ],
  ])("redacts complete embedded credentials in %s", (text, expected) => {
    expect(JSON.parse(redactArgsToJson({ notes: text })!).notes).toBe(expected);
    expect(redactTextToSummary(text)).toBe(expected);
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
    const json = redactArgsToJson({
      value: "https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXX",
    });
    expect(JSON.parse(json!).value).toBe("[redacted]");
  });

  it("truncates very long (non-secret) strings", () => {
    const long = "lorem ipsum ".repeat(500);
    const json = redactArgsToJson({ body: long });
    const parsed = JSON.parse(json!);
    expect(parsed.body.length).toBeLessThan(long.length);
    expect(parsed.body).toContain("more chars");
  });

  it("keeps the output parseable when the whole payload is truncated", () => {
    const sentence = "word ".repeat(200);
    const big = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`f${i}`, sentence]),
    );
    const json = redactArgsToJson(big);
    expect(() => JSON.parse(json!)).not.toThrow();
    const parsed = JSON.parse(json!);
    expect(parsed._auditTruncated).toBe(true);
    expect(typeof parsed.preview).toBe("string");
  });

  it("honours a caller-supplied cap, envelope included", () => {
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

  it("tells a cut from a redaction", () => {
    const parsed = (args: unknown, limits?: { maxString: number }) =>
      JSON.parse(redactArgsToJson(args, limits)!);
    expect(redactedArgsWereCut(parsed({ apiKey: "sk-live-1" }))).toBe(false);
    expect(redactedArgsWereCut(parsed({ to: ["a@x.com", "b@x.com"] }))).toBe(
      false,
    );
    expect(
      redactedArgsWereCut(
        parsed({ body: "word ".repeat(20) }, { maxString: 10 }),
      ),
    ).toBe(true);
    expect(
      redactedArgsWereCut(
        parsed({ to: Array.from({ length: 101 }, (_, i) => `p${i}@x.com`) }),
      ),
    ).toBe(true);
    expect(
      redactedArgsWereCut(
        parsed(
          Object.fromEntries(
            Array.from({ length: 101 }, (_, i) => [`k${i}`, i]),
          ),
        ),
      ),
    ).toBe(true);
    expect(
      redactedArgsWereCut(
        parsed({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }),
      ),
    ).toBe(true);
    expect(
      redactedArgsWereCut(
        parsed(
          Object.fromEntries(
            Array.from({ length: 10 }, (_, i) => [
              `f${i}`,
              "word ".repeat(200),
            ]),
          ),
        ),
      ),
    ).toBe(true);
  });
});

describe("redactTextToSummary", () => {
  it("redacts a quoted value when the summary boundary cuts an escape", () => {
    const text = 'password="' + "x".repeat(85) + '\\fake suffix"';
    const summary = redactTextToSummary(text, 64);
    expect(summary).toContain('password="[redacted]"');
    expect(summary).not.toContain("x".repeat(10));
  });

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
      'request failed:\nAuthorization: Bearer fake-bearer-value\ntoken=fake-token-value body={"apiKey":"fake-api-key"}',
    );
    expect(summary).toContain("Authorization: [redacted]");
    expect(summary).toContain("token=[redacted]");
    expect(summary).toContain('"apiKey":"[redacted]"');
    expect(summary).not.toContain("fake-bearer-value");
    expect(summary).not.toContain("fake-token-value");
    expect(summary).not.toContain("fake-api-key");
  });
});
