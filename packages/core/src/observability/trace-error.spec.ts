import { describe, expect, it } from "vitest";

import { redactToolErrorMessage, toolErrorSignature } from "./trace-error.js";

const fakeAwsAccessKeyId = (prefix: "AKIA" | "ASIA") =>
  `${prefix}${"0".repeat(16)}`;

const fakeProviderTokens = [
  ["x", "oxb-", "FAKE", "-", "0".repeat(8)].join(""),
  ["x", "app-", "1-", "FAKE", "-", "0".repeat(8)].join(""),
  ["S", "G.", "FAKE", ".", "TOKEN"].join(""),
  ["p", "at-", "na1-", "FAKE", "-", "0".repeat(8)].join(""),
  ["github", "_pat_", "FAKE", "_", "0".repeat(8)].join(""),
  ["n", "pm_", "FAKE", "_", "0".repeat(8)].join(""),
];

describe("redactToolErrorMessage", () => {
  it("redacts AWS access key IDs from captured user input and output", () => {
    const inputKey = fakeAwsAccessKeyId("AKIA");
    const outputKey = fakeAwsAccessKeyId("ASIA");
    expect(redactToolErrorMessage(`User input included ${inputKey}.`)).toBe(
      "User input included [REDACTED].",
    );
    expect(
      redactToolErrorMessage(`Assistant output included ${outputKey}.`),
    ).toBe("Assistant output included [REDACTED].");
  });

  it("redacts AWS access key IDs cut off at the end of captured text", () => {
    const inputKeyPrefix = `${"AKIA"}${"0".repeat(7)}`;
    const outputKeyPrefix = `${"ASIA"}${"0".repeat(7)}`;
    expect(
      redactToolErrorMessage(`User input ended at ${inputKeyPrefix}`),
    ).toBe("User input ended at [REDACTED]");
    expect(
      redactToolErrorMessage(`Assistant output ended at ${outputKeyPrefix}`),
    ).toBe("Assistant output ended at [REDACTED]");
  });

  it("redacts common provider tokens and their capture-boundary tails", () => {
    expect(
      redactToolErrorMessage(
        `Provider values: ${fakeProviderTokens.join(", ")}`,
      ),
    ).toBe(
      `Provider values: ${fakeProviderTokens.map(() => "[REDACTED]").join(", ")}`,
    );

    const tails = [
      ["x", "oxb-", "FAKE"].join(""),
      ["x", "app-", "1-", "FAKE"].join(""),
      ["S", "G.", "FAKE"].join(""),
      ["p", "at-", "na1-", "FAKE"].join(""),
      ["github", "_pat_", "FAKE"].join(""),
      ["n", "pm_", "FAKE"].join(""),
    ];
    for (const tail of tails) {
      expect(redactToolErrorMessage(`Provider output ended at ${tail}`)).toBe(
        "Provider output ended at [REDACTED]",
      );
    }
  });

  it("redacts standalone JWTs and prefixes cut off at the capture boundary", () => {
    const jwt = [
      ["ey", "J", "A".repeat(8)].join(""),
      "B".repeat(8),
      "C".repeat(8),
    ].join(".");
    const jwtPrefix = ["ey", "J", "A".repeat(3)].join("");

    expect(redactToolErrorMessage(`Provider returned ${jwt}.`)).toBe(
      "Provider returned [REDACTED].",
    );
    expect(
      redactToolErrorMessage(`Provider output ended at ${jwtPrefix}`),
    ).toBe("Provider output ended at [REDACTED]");
  });

  it("redacts signatures in signed URL query strings", () => {
    const sasSignature = ["FAKE", "SAS", "SIGNATURE"].join("-");
    const awsSignature = ["FAKE", "AWS", "SIGNATURE"].join("-");
    const googleSignature = ["FAKE", "GOOGLE", "SIGNATURE"].join("-");

    expect(
      redactToolErrorMessage(
        `Azure https://blob.example/object?sv=2024&sig=${sasSignature}, AWS https://s3.example/object?X-Amz-Signature=${awsSignature}&part=1, Google https://storage.example/object?X-Goog-Signature=${googleSignature}`,
      ),
    ).toBe(
      "Azure https://blob.example/object?sv=2024&sig=[REDACTED], AWS https://s3.example/object?X-Amz-Signature=[REDACTED]&part=1, Google https://storage.example/object?X-Goog-Signature=[REDACTED]",
    );
  });

  it("redacts a quoted credential when capture ends before its closing quote", () => {
    const redacted = redactToolErrorMessage(
      '{"client_secret": "partial secret value',
    );

    expect(redacted).toBe('{"client_secret": "[REDACTED]"');
    expect(redacted).not.toContain("partial secret value");
  });

  it("redacts camelCase secret-key fields in JSON-like output", () => {
    expect(
      redactToolErrorMessage(
        '{"secretKey":"actual-secret-value","workspaceSecretKey":"also-secret","signingKey":"signing-secret","encryptionKey":"encryption-secret","publicKey":"visible"}',
      ),
    ).toBe(
      '{"secretKey":"[REDACTED]","workspaceSecretKey":"[REDACTED]","signingKey":"[REDACTED]","encryptionKey":"[REDACTED]","publicKey":"visible"}',
    );
  });

  it("redacts connection-string fields and URI userinfo", () => {
    expect(
      redactToolErrorMessage(
        "DATABASE_URL=postgresql://alice:db-secret@db.example/app\npostgresql://bob:uri-secret@db.example/app",
      ),
    ).toBe("DATABASE_URL=[REDACTED]\npostgresql://[REDACTED]@db.example/app");
  });

  it("redacts URI userinfo through the final authority delimiter", () => {
    expect(
      redactToolErrorMessage("postgresql://alice:pa@ss@db.example/app"),
    ).toBe("postgresql://[REDACTED]@db.example/app");
  });

  it("leaves an authority without userinfo visible", () => {
    expect(redactToolErrorMessage("https://example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(redactToolErrorMessage("https://example.com:8443")).toBe(
      "https://example.com:8443",
    );
  });

  it("redacts an incomplete URI authority at a bounded trace capture", () => {
    expect(
      redactToolErrorMessage("postgresql://alice:partial-secret", {
        truncated: true,
      }),
    ).toBe("postgresql://[REDACTED]");
    expect(
      // guard:allow-secret-literal — fake password with @ verifies URI redaction
      redactToolErrorMessage("postgresql://alice:pa@ss", {
        truncated: true,
      }),
    ).toBe("postgresql://[REDACTED]");
  });

  it("redacts credential tails when a provider interrupts below the content limit", () => {
    const interruptedUri = redactToolErrorMessage(
      "postgresql://alice:partial-secret",
      {
        truncated: false,
      },
    );
    const interruptedKey = redactToolErrorMessage(
      "The provider reply ended at sk-ant-",
      { truncated: false },
    );

    expect(interruptedUri).toBe("postgresql://[REDACTED]");
    expect(interruptedUri).not.toContain("partial-secret");
    expect(interruptedKey).toBe("The provider reply ended at [REDACTED]");
    expect(interruptedKey).not.toContain("sk-ant-");
  });
});

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
