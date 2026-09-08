import { describe, expect, it } from "vitest";

import {
  sanitizeToolErrorText,
  sanitizeToolErrorValue,
} from "./tool-error-redaction.js";

const fakeKey = (prefix: string) => `${prefix}${"x".repeat(24)}`;

describe("tool error redaction", () => {
  it("redacts bare sk-style secret placeholders in text", () => {
    const bare = fakeKey("sk-");
    const project = fakeKey("sk-proj-");
    const service = fakeKey("sk-svcacct-");
    const trailingHyphen = `${fakeKey("sk-")}-`;

    const redacted = sanitizeToolErrorText(
      `failed with ${bare}, ${project}, ${service}, and ${trailingHyphen}`,
    );

    expect(redacted).toBe(
      "failed with [REDACTED], [REDACTED], [REDACTED], and [REDACTED]",
    );
    expect(redacted).not.toContain(bare);
    expect(redacted).not.toContain(project);
    expect(redacted).not.toContain(service);
    expect(redacted).not.toContain(trailingHyphen);
  });

  it("redacts bare sk-style values inside structured error values", () => {
    const project = fakeKey("sk-proj-");

    const redacted = sanitizeToolErrorValue({
      message: `provider rejected ${project}`,
    });

    expect(redacted).toContain("[REDACTED]");
    expect(redacted).not.toContain(project);
  });

  it("preserves short placeholders and non-sensitive field names", () => {
    const redacted = sanitizeToolErrorValue({
      message: "use sk-example as a placeholder",
      tokenizer: "keep",
      passwordHash: "keep",
      secretsCount: 2,
      mySecret: "keep",
    });

    expect(redacted).toContain("sk-example");
    expect(redacted).toContain('"tokenizer": "keep"');
    expect(redacted).toContain('"passwordHash": "keep"');
    expect(redacted).toContain('"secretsCount": 2');
    expect(redacted).toContain('"mySecret": "keep"');
  });
});
